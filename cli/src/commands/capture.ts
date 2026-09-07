/**
 * `pf capture --tx <hash> --out <file>` — FR-16.
 *
 * Freezes a REAL Attestcoin proof of a REAL Ethereum mainnet transaction into a Foundry fixture, so
 * the decode path is tested against reality without any network access at test time (NFR-04, D-09).
 *
 * Writes two files next to each other:
 *   <out>.json      the full ContinuityResponse plus the off-chain decode, for humans and provenance
 *   <out>.abi.hex   abi.encode(chainKey, headerNumber, txBytes, root, siblings, lowerEndpointDigest,
 *                   roots) — one `abi.decode` away from `recordRound`'s argument list in Solidity
 */
import { AbiCoder, Interface } from 'ethers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  dryRun,
  fetchProof,
  makeBlockProver,
  makeChainInfo,
  makeProofBuilder,
  type ContinuityResponse,
} from '../lib/attestcoin.js';
import { ANSWER_UPDATED_TOPIC, composeRoundId, formatAnswer } from '../lib/chainlink.js';
import { REPO_ROOT, loadConfig } from '../lib/config.js';
import { ccProvider } from '../lib/creditcoin.js';
import { log } from '../lib/log.js';
import { flag } from '../lib/args.js';

/** The tuple `recordRound` takes, in order — kept in one place so the fixture can never drift. */
const PROOF_ARG_TYPES = [
  'uint64',
  'uint64',
  'bytes',
  'bytes32',
  'tuple(bytes32 hash, bool isLeft)[]',
  'bytes32',
  'bytes32[]',
] as const;

/** Minimal decode of the AnswerUpdated logs inside the proven bytes, for the fixture's `decoded`. */
export interface DecodedRound {
  emitter: string;
  answer: string;
  answerFormatted: string;
  aggregatorRoundId: string;
  updatedAt: string;
  updatedAtIso: string;
}

const RECEIPT_LOG_IFACE = new Interface([
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
]);

/**
 * Decode the source-chain receipt logs from the raw transaction of the proof.
 * We re-read the logs from the SOURCE chain rather than decoding the EvmV1 blob here: the point of
 * the fixture is that Solidity does the EvmV1 decoding, and this JSON is only provenance.
 */
async function decodeRoundsFromSource(
  txHash: string,
  ethRpcUrl: string,
  decimals: number,
): Promise<DecodedRound[]> {
  const { JsonRpcProvider } = await import('ethers');
  const eth = new JsonRpcProvider(ethRpcUrl, undefined, { staticNetwork: true });
  const receipt = await eth.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`source transaction ${txHash} not found`);
  const out: DecodedRound[] = [];
  for (const l of receipt.logs) {
    if (l.topics[0] !== ANSWER_UPDATED_TOPIC) continue;
    const parsed = RECEIPT_LOG_IFACE.parseLog({ topics: [...l.topics], data: l.data });
    if (!parsed) continue;
    const answer = parsed.args[0] as bigint;
    const updatedAt = parsed.args[2] as bigint;
    out.push({
      emitter: l.address,
      answer: answer.toString(),
      answerFormatted: formatAnswer(answer, decimals),
      aggregatorRoundId: (parsed.args[1] as bigint).toString(),
      updatedAt: updatedAt.toString(),
      updatedAtIso: new Date(Number(updatedAt) * 1000).toISOString(),
    });
  }
  return out;
}

export function encodeProofArgs(d: ContinuityResponse): string {
  return AbiCoder.defaultAbiCoder().encode([...PROOF_ARG_TYPES], [
    d.chainKey,
    d.headerNumber,
    d.txBytes,
    d.merkleProof.root,
    d.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    d.continuityProof.lowerEndpointDigest,
    d.continuityProof.roots,
  ]);
}

export async function capture(argv: readonly string[]): Promise<number> {
  const txHash = flag(argv, '--tx');
  const out = flag(argv, '--out');
  const decimals = Number(flag(argv, '--decimals') ?? 8);
  const phaseId = flag(argv, '--phase-id');

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    log.error('usage: pf capture --tx <0x…64 hex> --out <path> [--decimals 8] [--phase-id 3]');
    return 1;
  }
  if (!out) {
    log.error('usage: pf capture --tx <hash> --out <path>');
    return 1;
  }

  const cfg = loadConfig();
  const cc = ccProvider(cfg);
  const prover = makeBlockProver(cc);
  const ci = makeChainInfo(cc);
  void ci;

  log.step(`capturing proof for ${txHash}`);
  const pb = makeProofBuilder(cfg.sourceChainKey, cfg.proofBuilderUrl, 180_000);
  const proof = await fetchProof(pb, txHash);

  // A fixture that does not verify is worse than no fixture: it would bake a broken proof into CI.
  const ok = await dryRun(prover, proof);
  if (!ok) {
    log.error('verifySingle dry-run returned false — refusing to write a fixture for an unverifiable proof');
    return 2;
  }

  const decoded = await decodeRoundsFromSource(txHash, cfg.ethMainnetRpcUrl, decimals);
  if (decoded.length === 0) log.warn('no AnswerUpdated logs in this transaction — fixture will be a negative case');
  for (const d of decoded) {
    const composed =
      phaseId !== undefined ? composeRoundId(Number(phaseId), BigInt(d.aggregatorRoundId)).toString() : null;
    log.info(
      `  ${d.emitter} answer ${d.answerFormatted} aggRound ${d.aggregatorRoundId} ` +
        `updatedAt ${d.updatedAtIso}${composed ? ` proxyRoundId ${composed}` : ''}`,
    );
  }

  const jsonPath = resolve(REPO_ROOT, out.endsWith('.json') ? out : `${out}.json`);
  const hexPath = jsonPath.replace(/\.json$/, '.abi.hex');
  mkdirSync(dirname(jsonPath), { recursive: true });

  const fixture = {
    capturedAt: new Date().toISOString(),
    sourceChainKey: proof.chainKey,
    txHash: proof.txHash,
    proverUrl: cfg.proofBuilderUrl,
    phaseId: phaseId !== undefined ? Number(phaseId) : null,
    decimals,
    proof: {
      chainKey: proof.chainKey,
      headerNumber: proof.headerNumber,
      txIndex: proof.txIndex,
      txHash: proof.txHash,
      txBytes: proof.txBytes,
      continuityProof: proof.continuityProof,
      merkleProof: proof.merkleProof,
      cached: proof.cached,
      generatedAt: proof.generatedAt,
    },
    decoded,
  };

  writeFileSync(jsonPath, JSON.stringify(fixture, null, 2) + '\n');
  writeFileSync(hexPath, encodeProofArgs(proof) + '\n');

  log.ok(`wrote ${jsonPath}`);
  log.ok(`wrote ${hexPath} (${proof.merkleProof.siblings.length} siblings, ${proof.continuityProof.roots.length} continuity roots)`);
  return 0;
}
