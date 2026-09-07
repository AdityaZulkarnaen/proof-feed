/**
 * `pf claim --policy <id> [--tx <hash> | --latest]` — FR-15.
 *
 * Settles a PegGuard policy by PROVING the breaching round in the same Creditcoin transaction
 * (`proveAndClaim`). The round id is derived from the source transaction's own `AnswerUpdated` log
 * plus the registry's phase — nothing about the price is supplied by the caller.
 *
 * If the round is already in the registry, falls back to plain `claim` rather than paying to prove
 * it twice.
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
} from '../lib/attestcoin.js';
import {
  composeRoundId,
  findAnswerUpdatedLogs,
  formatAnswer,
  resolveFeed,
  type AnswerUpdatedRecord,
} from '../lib/chainlink.js';
import { loadConfig, proxyForFeed, requirePrivateKey } from '../lib/config.js';
import {
  attach,
  ccProvider,
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
import { flag, numberFlag } from '../lib/args.js';

const STATUS = ['NONE', 'ACTIVE', 'CLAIMED', 'EXPIRED'] as const;

export async function claim(argv: readonly string[]): Promise<number> {
  const cfg = loadConfig();
  if (!cfg.pegguardAddress || !cfg.registryAddress) {
    log.error('PEGGUARD_ADDRESS / REGISTRY_ADDRESS must be set.');
    return 1;
  }

  const policyId = numberFlag(argv, '--policy', -1);
  if (policyId < 0) {
    log.error('usage: pf claim --policy <id> [--tx <hash> | --latest]');
    return 1;
  }
  const txArg = flag(argv, '--tx');
  const chainKey = numberFlag(argv, '--chain-key', cfg.sourceChainKey);
  const lookback = numberFlag(argv, '--lookback', 20_000);

  const cc = ccProvider(cfg);
  const eth = ethProvider(cfg.ethMainnetRpcUrl);
  const prover = makeBlockProver(cc);
  const ci = makeChainInfo(cc);
  const pb = makeProofBuilder(chainKey, cfg.proofBuilderUrl, 180_000);

  const guardArtifact = loadArtifact('PegGuard');
  const registryArtifact = loadArtifact('ProvenFeedRegistry');
  const guardRead = attach(guardArtifact, cfg.pegguardAddress, cc);
  const registry = attach(registryArtifact, cfg.registryAddress, cc);

  log.step(`claim policy ${policyId}`);
  const policy = await (guardRead as Contract).getPolicy!(policyId);
  const feedId = policy.feedId as string;
  const feedMeta = await (registry as Contract).getFeed!(feedId);
  const decimals = Number(feedMeta.decimals);

  log.info(`feed        "${feedMeta.description}" (${feedId})`);
  log.info(`holder      ${policy.holder}`);
  log.info(`strike      ${formatAnswer(policy.strike as bigint, decimals)}`);
  log.info(`notional    ${(Number(policy.notional) / 1e18).toFixed(6)} CTC`);
  log.info(
    `window      ${new Date(Number(policy.start) * 1000).toISOString()} .. ${new Date(Number(policy.expiry) * 1000).toISOString()}`,
  );
  log.info(`status      ${STATUS[Number(policy.status)] ?? '?'}`);

  if (Number(policy.status) !== 1) {
    log.error(`policy ${policyId} is ${STATUS[Number(policy.status)] ?? 'unknown'}, not ACTIVE`);
    return 3;
  }

  // Which mainnet round breached the strike?
  const proxy = proxyForFeed(cfg, feedMeta.description as string);
  const feed = await resolveFeed(eth, proxy);
  let round: AnswerUpdatedRecord | undefined;

  if (txArg) {
    const receipt = await eth.getTransactionReceipt(txArg);
    if (!receipt) {
      log.error(`source transaction ${txArg} not found`);
      return 1;
    }
    const logs = await findAnswerUpdatedLogs(eth, feed.aggregator, receipt.blockNumber, receipt.blockNumber);
    round = logs.find((l) => l.txHash.toLowerCase() === txArg.toLowerCase());
    if (!round) {
      log.error(`no AnswerUpdated log from ${feed.aggregator} in ${txArg}`);
      return 1;
    }
  } else {
    const head = await eth.getBlockNumber();
    const logs = await findAnswerUpdatedLogs(eth, feed.aggregator, Math.max(0, head - lookback), head, {
      limit: 50,
    });
    // The claim needs: inside the window, and below the strike.
    round = logs.find(
      (l) =>
        l.updatedAt >= BigInt(policy.start) &&
        l.updatedAt <= BigInt(policy.expiry) &&
        l.answer < (policy.strike as bigint),
    );
    if (!round) {
      log.error(
        `no round in the last ${lookback} blocks is both inside the coverage window and below the strike. ` +
          `The newest round is ${logs[0] ? `${formatAnswer(logs[0].answer, decimals)} at ${new Date(Number(logs[0].updatedAt) * 1000).toISOString()}` : 'unavailable'}.`,
      );
      return 1;
    }
  }

  const roundId = composeRoundId(feed.phaseId, round.aggregatorRoundId);
  log.ok(
    `breaching round: ${formatAnswer(round.answer, decimals)} at ${new Date(Number(round.updatedAt) * 1000).toISOString()} ` +
      `(roundId ${roundId}, block ${round.blockNumber.toLocaleString()}, tx ${round.txHash})`,
  );

  const wallet = ccWallet(cfg, requirePrivateKey(cfg));
  await requireFunded(wallet);
  const guard = attach(guardArtifact, cfg.pegguardAddress, wallet);
  const guardIface = new Interface(guardArtifact.abi as never);
  const registryIface = new Interface(registryArtifact.abi as never);

  const holderBefore = await cc.getBalance(policy.holder as string);

  // If the round is already proven, plain `claim` is cheaper than proving it again.
  const stored = await (registry as Contract).getRound!(feedId, roundId);
  let receipt: ContractTransactionReceipt;

  if (stored.exists) {
    log.info('round already proven — calling claim() directly');
    const tx = await (guard as Contract).claim!(policyId, roundId);
    log.info(`submitted ${tx.hash} — ${explorerTx(cfg, tx.hash)}`);
    receipt = (await tx.wait()) as ContractTransactionReceipt;
    log.surface('PegGuard.claim (on-chain)', `status ${receipt.status}`);
  } else {
    await waitAttested(pb, chainKey, round.blockNumber);
    void ci;
    const proof = await fetchProof(pb, round.txHash);
    const ok = await dryRun(prover, proof);
    if (!ok) {
      log.error('verifySingle dry-run returned FALSE — refusing to submit');
      return 2;
    }

    const args = toProofArgs(proof);
    const data = guardIface.encodeFunctionData('proveAndClaim', [policyId, roundId, ...args]);
    const gas = await computeGasLimit(
      wallet.provider as never,
      { to: cfg.pegguardAddress, data, from: wallet.address },
      proof.continuityProof.roots.length,
    );
    log.info(`gas policy: ${gas.note}`);

    try {
      const tx = await (guard as Contract).proveAndClaim!(policyId, roundId, ...args, {
        gasLimit: gas.gasLimit,
      });
      log.info(`submitted ${tx.hash} — ${explorerTx(cfg, tx.hash)}`);
      receipt = (await tx.wait()) as ContractTransactionReceipt;
    } catch (err) {
      log.error(`proveAndClaim reverted: ${errMessage(err)}`);
      return 3;
    }
    log.surface('PegGuard.proveAndClaim (on-chain)', 'recordRound + claim in one transaction');
    log.surface('INativeQueryVerifier.verifyAndEmit (on-chain, 0xFD2)', 'inside recordRound');
  }

  log.ok(`status ${receipt.status} — ${gasLine(receipt.gasUsed)}`);
  for (const e of parseReceiptEvents(receipt, [guardIface, registryIface])) {
    log.info(`  ${e.name} from ${e.address}: ${JSON.stringify(e.args)}`);
  }

  const holderAfter = await cc.getBalance(policy.holder as string);
  const delta = holderAfter - holderBefore;
  log.ok(
    `holder ${policy.holder} balance ${(Number(holderBefore) / 1e18).toFixed(6)} -> ` +
      `${(Number(holderAfter) / 1e18).toFixed(6)} CTC (delta ${(Number(delta) / 1e18).toFixed(6)})`,
  );

  const after = await (guardRead as Contract).getPolicy!(policyId);
  log.info(`policy ${policyId} is now ${STATUS[Number(after.status)]} on round ${after.claimRoundId}`);
  return 0;
}
