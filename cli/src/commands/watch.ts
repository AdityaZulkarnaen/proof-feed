/**
 * `pf watch --feed <F> [--from <block>] [--interval 30] [--once]` — FR-14.
 *
 * The permissionless keeper. Polls the source aggregator for new `AnswerUpdated` logs and runs the
 * `prove` pipeline for each. Idempotent in two independent ways: it skips rounds the registry
 * already holds, and it treats "Query already processed" as success. The cursor is persisted so a
 * restart does not re-scan from scratch.
 *
 * The keeper has no privileges. It pays gas; the contract decides what is true.
 */
import { Contract } from 'ethers';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  dryRun,
  fetchProof,
  makeBlockProver,
  makeChainInfo,
  makeProofBuilder,
} from '../lib/attestcoin.js';
import {
  composeRoundId,
  findAnswerUpdatedLogs,
  formatAnswer,
  resolveFeed,
  type AnswerUpdatedRecord,
} from '../lib/chainlink.js';
import { REPO_ROOT, loadConfig, proxyForFeed } from '../lib/config.js';
import { attach, ccProvider, ethProvider, loadArtifact } from '../lib/creditcoin.js';
import { log } from '../lib/log.js';
import { errMessage, sleep } from '../lib/retry.js';
import { flag, has, numberFlag } from '../lib/args.js';
import { submitRecordRound } from './prove.js';

interface Cursor {
  feedId: string;
  description: string;
  lastScannedBlock: number;
  provenRounds: string[];
  updatedAt: string;
}

function cursorPath(feedId: string): string {
  return resolve(REPO_ROOT, 'cli', '.state', `${feedId.slice(2, 18)}.json`);
}

function readCursor(feedId: string): Cursor | null {
  const p = cursorPath(feedId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Cursor;
  } catch {
    return null;
  }
}

function writeCursor(c: Cursor): void {
  const p = cursorPath(c.feedId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
}

export async function watch(argv: readonly string[]): Promise<number> {
  const cfg = loadConfig();
  if (!cfg.registryAddress) {
    log.error('REGISTRY_ADDRESS is empty — deploy the registry first.');
    return 1;
  }

  const feedArg = flag(argv, '--feed') ?? 'USDC/USD';
  const intervalSec = numberFlag(argv, '--interval', 30);
  const once = has(argv, '--once');
  const chainKey = numberFlag(argv, '--chain-key', cfg.sourceChainKey);
  // On a COLD start (no cursor, no --from) only look at the recent past. Defaulting to a wide
  // window here would make a fresh keeper back-fill every historical round it can see and spend
  // real gas doing it — ~300 blocks is about an hour of Ethereum, enough to catch the current
  // round without replaying history. Use --backfill to opt into a deeper sweep deliberately.
  const backfill = numberFlag(argv, '--backfill', 300);

  const proxy = proxyForFeed(cfg, feedArg);
  const eth = ethProvider(cfg.ethMainnetRpcUrl);
  const cc = ccProvider(cfg);
  const ci = makeChainInfo(cc);
  const prover = makeBlockProver(cc);
  const pb = makeProofBuilder(chainKey, cfg.proofBuilderUrl, 180_000);

  const feed = await resolveFeed(eth, proxy);
  const artifact = loadArtifact('ProvenFeedRegistry');
  const registry = attach(artifact, cfg.registryAddress, cc);

  let cursor = readCursor(feed.feedId);
  const fromFlag = flag(argv, '--from');
  if (fromFlag) {
    cursor = {
      feedId: feed.feedId,
      description: feed.description,
      lastScannedBlock: Number(fromFlag),
      provenRounds: [],
      updatedAt: new Date().toISOString(),
    };
  }

  let stopping = false;
  const onSignal = (): void => {
    log.warn('signal received — finishing the current round, then stopping');
    stopping = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  log.step(`watching "${feed.description}" aggregator ${feed.aggregator} every ${intervalSec}s`);
  log.info('this keeper has no privileges: it pays gas, the contract decides what is true');

  let iteration = 0;
  while (!stopping) {
    iteration++;
    try {
      const head = await eth.getBlockNumber();
      const from = cursor ? Math.max(0, cursor.lastScannedBlock + 1) : Math.max(0, head - backfill);
      if (from > head) {
        log.debug(`no new blocks (head ${head.toLocaleString()})`);
      } else {
        const logs = await findAnswerUpdatedLogs(eth, feed.aggregator, from, head, { limit: 50 });
        const fresh: AnswerUpdatedRecord[] = [];

        for (const l of logs) {
          const roundId = composeRoundId(feed.phaseId, l.aggregatorRoundId);
          const stored = await (registry as Contract).getRound!(feed.feedId, roundId);
          if (stored.exists) {
            log.debug(`round ${roundId} already proven — skipping`);
            continue;
          }
          fresh.push(l);
        }

        if (fresh.length === 0) {
          log.info(
            `[${iteration}] blocks ${from.toLocaleString()}-${head.toLocaleString()}: nothing new to prove`,
          );
        }

        // Oldest first, so `latestRoundId` advances in the natural order.
        for (const l of fresh.reverse()) {
          const roundId = composeRoundId(feed.phaseId, l.aggregatorRoundId);
          log.step(
            `proving round ${roundId} — ${formatAnswer(l.answer, feed.decimals)} at ` +
              `${new Date(Number(l.updatedAt) * 1000).toISOString()}`,
          );
          try {
            const attested = await ci.getLatestAttestedHeightAndHash(chainKey);
            if (l.blockNumber > attested.height) {
              log.info(
                `block ${l.blockNumber.toLocaleString()} not attested yet (tip ${attested.height.toLocaleString()}) — waiting`,
              );
              await pb.waitUntilHeightAttested(chainKey, l.blockNumber, 15_000, 1_200_000);
            }
            const proof = await fetchProof(pb, l.txHash);
            if (!(await dryRun(prover, proof))) {
              log.error('dry-run false — skipping this round');
              continue;
            }
            const { receipt } = await submitRecordRound(cfg, proof);
            log.ok(`round ${roundId} proven in ${receipt.hash}`);
          } catch (err) {
            const msg = errMessage(err);
            if (msg.includes('Query already processed')) {
              log.ok(`round ${roundId}: query already processed — idempotent success`);
            } else {
              log.error(`round ${roundId} failed: ${msg}`);
            }
          }
        }

        cursor = {
          feedId: feed.feedId,
          description: feed.description,
          lastScannedBlock: head,
          provenRounds: [
            ...(cursor?.provenRounds ?? []),
            ...fresh.map((l) => composeRoundId(feed.phaseId, l.aggregatorRoundId).toString()),
          ].slice(-200),
          updatedAt: new Date().toISOString(),
        };
        writeCursor(cursor);
      }
    } catch (err) {
      log.error(`watch iteration failed: ${errMessage(err)}`);
    }

    if (once || stopping) break;
    await sleep(intervalSec * 1000);
  }

  log.ok('watcher stopped');
  return 0;
}
