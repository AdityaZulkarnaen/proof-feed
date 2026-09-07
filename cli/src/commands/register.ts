/**
 * `pf register --proxy <address> [--chain-key 3] [--all-phases] [--dry-run]` — FR-21.
 *
 * Reads `aggregator()`, `phaseId()`, `decimals()` and `description()` off the live Chainlink proxy
 * and registers the feed. An aggregator address is NEVER typed by hand (CLAUDE.md rule 3): if it is
 * not in this output, it does not go on chain.
 *
 * `--all-phases` also registers historical phase aggregators, which is what lets a 2023 round be
 * proven under the same feed id as a 2026 one (D-04).
 */
import { Contract } from 'ethers';
import { formatAnswer, phaseAggregator, resolveFeed } from '../lib/chainlink.js';
import { loadConfig, proxyForFeed, requirePrivateKey } from '../lib/config.js';
import {
  attach,
  ccWallet,
  ethProvider,
  explorerTx,
  gasLine,
  loadArtifact,
} from '../lib/creditcoin.js';
import { log } from '../lib/log.js';
import { errMessage } from '../lib/retry.js';
import { flag, has, numberFlag } from '../lib/args.js';

export async function register(argv: readonly string[]): Promise<number> {
  const cfg = loadConfig();
  const dryRun = has(argv, '--dry-run');
  const allPhases = has(argv, '--all-phases');
  const chainKey = numberFlag(argv, '--chain-key', cfg.sourceChainKey);
  const proxyArg = flag(argv, '--proxy') ?? flag(argv, '--feed') ?? 'USDC/USD';
  const proxy = proxyForFeed(cfg, proxyArg);

  const eth = ethProvider(cfg.ethMainnetRpcUrl);

  log.step(`resolving ${proxy} on chain key ${chainKey}`);
  const feed = await resolveFeed(eth, proxy);

  log.info(`description   "${feed.description}"`);
  log.info(`feedId        ${feed.feedId}   (keccak256 of the description above)`);
  log.info(`decimals      ${feed.decimals}`);
  log.info(`phaseId       ${feed.phaseId}`);
  log.info(`aggregator    ${feed.aggregator}   (current phase)`);

  // Every phase aggregator, so historical rounds can be proven under the same feed id.
  const phases: { phaseId: number; aggregator: string }[] = [
    { phaseId: feed.phaseId, aggregator: feed.aggregator },
  ];
  if (allPhases) {
    for (let p = 1; p < feed.phaseId; p++) {
      const agg = await phaseAggregator(eth, proxy, p);
      if (/^0x0{40}$/i.test(agg)) continue;
      phases.push({ phaseId: p, aggregator: agg });
      log.info(`phase ${p}       ${agg}`);
    }
    phases.sort((a, b) => a.phaseId - b.phaseId);
  }

  process.stdout.write('\n# .env lines for contracts/script/Deploy.s.sol\n');
  process.stdout.write(`FEED_DESCRIPTION="${feed.description}"\n`);
  process.stdout.write(`FEED_CHAIN_KEY=${chainKey}\n`);
  process.stdout.write(`FEED_EMITTER="${feed.aggregator}"\n`);
  process.stdout.write(`FEED_PHASE_ID=${feed.phaseId}\n`);
  process.stdout.write(`FEED_DECIMALS=${feed.decimals}\n`);
  // The most recent PREVIOUS phase: that is the one holding the interesting recent history
  // (for USDC/USD it is phase 2, which emitted the 2023-03-11 depeg round).
  const older = [...phases].reverse().find((p) => p.phaseId !== feed.phaseId);
  if (older) {
    process.stdout.write(`FEED_EMITTER_PHASE2="${older.aggregator}"\n`);
    process.stdout.write(`FEED_PHASE_ID_PHASE2=${older.phaseId}\n`);
  }
  process.stdout.write('\n');

  if (dryRun) {
    log.ok('--dry-run: nothing sent');
    return 0;
  }

  if (!cfg.registryAddress) {
    log.error('REGISTRY_ADDRESS is empty — deploy first, or re-run with --dry-run.');
    return 1;
  }

  const wallet = ccWallet(cfg, requirePrivateKey(cfg));
  const artifact = loadArtifact('ProvenFeedRegistry');
  const registry = attach(artifact, cfg.registryAddress, wallet);

  for (const p of phases) {
    const existing = (await (registry as Contract).feedOf!(chainKey, p.aggregator)) as string;
    if (existing !== '0x'.padEnd(66, '0')) {
      log.info(`phase ${p.phaseId} ${p.aggregator} already registered under ${existing}`);
      continue;
    }
    try {
      const tx = await (registry as Contract).registerFeed!(
        feed.feedId,
        chainKey,
        p.aggregator,
        p.phaseId,
        feed.decimals,
        feed.description,
      );
      const receipt = await tx.wait();
      log.ok(
        `registered phase ${p.phaseId} ${p.aggregator} — ${explorerTx(cfg, receipt.hash)} (${gasLine(receipt.gasUsed)})`,
      );
    } catch (err) {
      log.error(`registerFeed(phase ${p.phaseId}) failed: ${errMessage(err)}`);
      return 3;
    }
  }

  // Show what the registry now believes, so the operator can eyeball it.
  const stored = await (registry as Contract).getFeed!(feed.feedId);
  log.info(
    `registry.getFeed(${feed.feedId.slice(0, 10)}…) -> "${stored.description}" ${stored.decimals} decimals, canonical emitter ${stored.emitter}`,
  );
  const latest = await (registry as Contract).latestRoundId!(feed.feedId);
  log.info(
    latest === 0n
      ? 'no round proven yet — run: npm run pf -- prove --feed USDC/USD --latest'
      : `latest proven round ${latest}`,
  );
  void formatAnswer;
  return 0;
}
