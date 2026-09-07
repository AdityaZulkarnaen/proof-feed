/**
 * `pf prove --feed <F> [--tx <hash> | --latest]` — FR-13.
 *
 * The whole pipeline, in the order the contract will re-check it:
 *   resolve feed -> pick a round -> idempotency check -> wait for attestation -> fetch proof ->
 *   dry-run `verifySingle` (never submit on false) -> `recordRound` -> read the events back.
 */
import { Contract, Interface, type ContractTransactionReceipt } from 'ethers';
import {
  dryRun,
  fetchProof,
  makeBlockProver,
  makeChainInfo,
  makeProofBuilder,
  toProofArgs,
  waitAttested,
  type ContinuityResponse,
} from '../lib/attestcoin.js';
import {
  composeRoundId,
  decomposeRoundId,
  findAnswerUpdatedLogs,
  formatAnswer,
  phaseAggregator,
  resolveFeed,
  type AnswerUpdatedRecord,
  type ResolvedFeed,
} from '../lib/chainlink.js';
import { loadConfig, proxyForFeed, requirePrivateKey, type Config } from '../lib/config.js';
import {
  attach,
  ccWallet,
  computeGasLimit,
  ethProvider,
  explorerTx,
  gasLine,
  loadArtifact,
  parseReceiptEvents,
  requireFunded,
} from '../lib/creditcoin.js';
import { log } from '../lib/log.js';
import { errMessage } from '../lib/retry.js';
import { flag, has, numberFlag } from '../lib/args.js';

export interface ProveResult {
  status: 'proven' | 'already-proven' | 'failed';
  txHash?: string;
  gasUsed?: bigint;
  roundIds: string[];
}

/** Find the newest `AnswerUpdated` transaction of a feed, at or below the attested tip. */
export async function findLatestProvableRound(
  cfg: Config,
  feed: ResolvedFeed,
  attestedHeight: number,
  lookback = 20_000,
): Promise<AnswerUpdatedRecord | null> {
  const eth = ethProvider(cfg.ethMainnetRpcUrl);
  const head = await eth.getBlockNumber();
  const logs = await findAnswerUpdatedLogs(eth, feed.aggregator, Math.max(0, head - lookback), head, {
    limit: 25,
  });
  // Prefer a round already inside the attested range so the wait is a no-op.
  return logs.find((l) => l.blockNumber <= attestedHeight) ?? logs[0] ?? null;
}

/**
 * Submit one proof to `recordRound` and report everything a judge would want to see.
 * Exported so `pf watch` and `pf demo` reuse exactly the same path.
 */
export async function submitRecordRound(
  cfg: Config,
  proof: ContinuityResponse,
): Promise<{ receipt: ContractTransactionReceipt; roundIds: string[] }> {
  const wallet = ccWallet(cfg, requirePrivateKey(cfg));
  await requireFunded(wallet);

  const artifact = loadArtifact('ProvenFeedRegistry');
  const registry = attach(artifact, cfg.registryAddress, wallet);
  const iface = new Interface(artifact.abi as never);
  const args = toProofArgs(proof);

  const data = iface.encodeFunctionData('recordRound', [...args]);
  const gas = await computeGasLimit(
    wallet.provider as never,
    { to: cfg.registryAddress, data, from: wallet.address },
    proof.continuityProof.roots.length,
  );
  log.info(`gas policy: ${gas.note}`);

  const tx = await (registry as Contract).recordRound!(...args, { gasLimit: gas.gasLimit });
  log.info(`submitted ${tx.hash} — ${explorerTx(cfg, tx.hash)}`);
  const receipt = (await tx.wait()) as ContractTransactionReceipt;
  if (!receipt) throw new Error('no receipt');

  log.surface('ProvenFeedRegistry.recordRound (on-chain)', `status ${receipt.status}`);
  log.surface(
    'INativeQueryVerifier.verifyAndEmit (on-chain, 0xFD2)',
    'inclusion + continuity verified inside recordRound',
  );
  log.surface(
    'EvmV1Decoder.{getTransactionType,decodeReceiptFields,getLogsByEventSignature} (on-chain)',
    'round decoded from the verified bytes',
  );
  log.ok(`recordRound status ${receipt.status} — ${gasLine(receipt.gasUsed)}`);

  const events = parseReceiptEvents(receipt, [iface]);
  const roundIds: string[] = [];
  for (const e of events) {
    log.info(`  ${e.name} from ${e.address}: ${JSON.stringify(e.args)}`);
    if (e.name === 'RoundProven' && e.args['roundId']) roundIds.push(e.args['roundId']);
  }
  if (!events.some((e) => e.name === 'TransactionVerified')) {
    log.warn('no TransactionVerified log from 0xFD2 in the receipt — check the precompile address');
  }
  return { receipt, roundIds };
}

export async function prove(argv: readonly string[]): Promise<number> {
  const cfg = loadConfig();
  if (!cfg.registryAddress) {
    log.error('REGISTRY_ADDRESS is empty — deploy the registry first.');
    return 1;
  }

  const feedArg = flag(argv, '--feed') ?? 'USDC/USD';
  const txArg = flag(argv, '--tx');
  const wantLatest = has(argv, '--latest') || !txArg;
  const lookback = numberFlag(argv, '--lookback', 20_000);
  const chainKey = numberFlag(argv, '--chain-key', cfg.sourceChainKey);

  const proxy = proxyForFeed(cfg, feedArg);
  const eth = ethProvider(cfg.ethMainnetRpcUrl);
  const cc = (await import('../lib/creditcoin.js')).ccProvider(cfg);
  const ci = makeChainInfo(cc);
  const prover = makeBlockProver(cc);
  const pb = makeProofBuilder(chainKey, cfg.proofBuilderUrl, 180_000);

  log.step(`prove ${feedArg}`);
  const feed = await resolveFeed(eth, proxy);

  const artifact = loadArtifact('ProvenFeedRegistry');
  const registry = attach(artifact, cfg.registryAddress, cc);

  // Which mainnet transaction are we proving?
  let txHash: string;
  let expectedRound: AnswerUpdatedRecord | null = null;
  if (txArg && !has(argv, '--latest')) {
    txHash = txArg;
    log.info(`using explicit tx ${txHash}`);
  } else {
    const attested = await ci.getLatestAttestedHeightAndHash(chainKey);
    expectedRound = await findLatestProvableRound(cfg, feed, attested.height, lookback);
    if (!expectedRound) {
      log.error(`no AnswerUpdated log found for ${feed.aggregator} in the last ${lookback} blocks`);
      return 1;
    }
    txHash = expectedRound.txHash;
    log.info(
      `latest provable round: ${formatAnswer(expectedRound.answer, feed.decimals)} ` +
        `(agg round ${expectedRound.aggregatorRoundId}, block ${expectedRound.blockNumber.toLocaleString()})`,
    );
    void wantLatest;
  }

  // Idempotency (FR-13): if the round is already stored, do not spend gas re-proving it.
  if (expectedRound) {
    const roundId = composeRoundId(feed.phaseId, expectedRound.aggregatorRoundId);
    const stored = await (registry as Contract).getRound!(feed.feedId, roundId);
    if (stored.exists) {
      log.ok(
        `round ${roundId} already proven (answer ${formatAnswer(stored.answer, feed.decimals)}, ` +
          `provenAt ${new Date(Number(stored.provenAt) * 1000).toISOString()}) — nothing to do`,
      );
      return 0;
    }
  }

  // Proof pipeline.
  let proof: ContinuityResponse;
  try {
    const height = expectedRound?.blockNumber;
    if (height !== undefined) await waitAttested(pb, chainKey, height);
    proof = await fetchProof(pb, txHash);
    if (expectedRound === undefined || expectedRound === null) {
      log.info(`proof header ${proof.headerNumber.toLocaleString()}, txIndex ${proof.txIndex}`);
    }
  } catch (err) {
    log.error(`could not obtain a proof: ${errMessage(err)}`);
    return 2;
  }

  const ok = await dryRun(prover, proof);
  if (!ok) {
    log.error('verifySingle dry-run returned FALSE — refusing to submit');
    return 2;
  }

  // Submit.
  try {
    const { receipt, roundIds } = await submitRecordRound(cfg, proof);
    if (roundIds.length === 0) log.warn('no RoundProven event decoded from the receipt');

    const latestId = (await (registry as Contract).latestRoundId!(feed.feedId)) as bigint;
    if (latestId > 0n) {
      const latest = await (registry as Contract).latestRoundData!(feed.feedId);
      const { phaseId, aggregatorRoundId } = decomposeRoundId(latest[0] as bigint);
      log.ok(
        `registry.latestRoundData("${feed.description}") -> roundId ${latest[0]} ` +
          `(phase ${phaseId}, agg round ${aggregatorRoundId}), answer ${formatAnswer(latest[1] as bigint, feed.decimals)}, ` +
          `updatedAt ${new Date(Number(latest[2]) * 1000).toISOString()}`,
      );
    }
    log.info(`explorer: ${explorerTx(cfg, receipt.hash)}`);
    return 0;
  } catch (err) {
    const msg = errMessage(err);
    if (msg.includes('Query already processed')) {
      log.ok('this proof was already processed by the registry — treating as success (idempotent)');
      return 0;
    }
    log.error(`recordRound reverted: ${msg}`);
    return 3;
  }
}

export { phaseAggregator };
