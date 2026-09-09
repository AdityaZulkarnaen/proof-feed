/**
 * The ONLY file that touches `@gluwa/usc-sdk` (docs/04 §2).
 * Every exported helper logs the exact Attestcoin surface it exercises.
 */
import { blockProver, chainInfo, proofProvider, utils } from '@gluwa/usc-sdk';
import type { JsonRpcProvider } from 'ethers';
import { log } from './log.js';
import { errMessage, retry } from './retry.js';

export type ContinuityResponse = proofProvider.ContinuityResponse;
export type ChainInfoEntry = chainInfo.ChainInfo;
export type HeightHash = chainInfo.HeightHash;

/** Block Prover / Native Query Verifier precompile (`0xFD2`, docs/05 §1). */
export const BLOCK_PROVER_PRECOMPILE = blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS;
/** ChainInfo precompile (`0xfd3`). */
export const CHAIN_INFO_PRECOMPILE = chainInfo.CHAIN_INFO_PRECOMPILE_ADDRESS;
/** Creditcoin block gas cap (75,000,000). */
export const MAX_GAS_CAP = utils.gas.MAX_GAS_CAP;

export function gasPercentOfMax(gas: bigint): number {
  return utils.gas.gasAsPercentageOfMax(gas);
}

export function makeChainInfo(cc: JsonRpcProvider): chainInfo.PrecompileChainInfoProvider {
  return new chainInfo.PrecompileChainInfoProvider(cc);
}

export function makeProofBuilder(
  chainKey: number,
  url: string,
  timeoutMs = 30_000,
): proofProvider.service.ProofBuilder {
  return new proofProvider.service.ProofBuilder(chainKey, url, timeoutMs);
}

export function makeBlockProver(cc: JsonRpcProvider): blockProver.PrecompileBlockProver {
  return new blockProver.PrecompileBlockProver(cc);
}

/** `GET {host}/api/v1/health` — Day-1 gate G1 / open question Q1. */
export async function proverHealth(
  host: string,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${host.replace(/\/+$/, '')}/api/v1/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = (await res.text()).slice(0, 300);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: errMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** `GET {host}/api/v1/attested-height/{chainKey}` — the prover's own view of the attested tip. */
export async function proverAttestedHeight(
  host: string,
  chainKey: number,
  timeoutMs = 15_000,
): Promise<number | null> {
  const url = `${host.replace(/\/+$/, '')}/api/v1/attested-height/${chainKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const h = extractHeight(json);
    if (h !== null) {
      log.surface(
        'prover GET /api/v1/attested-height/{chainKey}',
        `chainKey ${chainKey} -> ${h.toLocaleString()}`,
      );
    }
    return h;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractHeight(json: unknown): number | null {
  if (typeof json === 'number') return json;
  if (json && typeof json === 'object') {
    for (const key of ['height', 'attestedHeight', 'attested_height', 'blockNumber', 'headerNumber']) {
      const v = (json as Record<string, unknown>)[key];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    }
    const data = (json as Record<string, unknown>)['data'];
    if (data && data !== json) return extractHeight(data);
  }
  return null;
}

export async function getSupportedChains(ci: chainInfo.ChainInfoProvider): Promise<ChainInfoEntry[]> {
  const chains = await retry('chainInfo.getSupportedChains', () => ci.getSupportedChains());
  log.surface('chainInfo.getSupportedChains', `${chains.length} source chains`);
  return chains;
}

export async function getSupportedChainByKey(
  ci: chainInfo.ChainInfoProvider,
  chainKey: number,
): Promise<ChainInfoEntry | null> {
  const c = await retry('chainInfo.getSupportedChainByKey', () => ci.getSupportedChainByKey(chainKey));
  log.surface(
    'chainInfo.getSupportedChainByKey',
    `key ${chainKey} -> ${c ? `${c.chainName} (chainId ${c.chainId})` : 'null'}`,
  );
  return c;
}

export async function getAttestationGenesisHeight(
  ci: chainInfo.ChainInfoProvider,
  chainKey: number,
): Promise<number> {
  const h = await retry('chainInfo.getAttestationGenesisHeight', () =>
    ci.getAttestationGenesisHeight(chainKey),
  );
  log.surface('chainInfo.getAttestationGenesisHeight', `key ${chainKey} -> ${h.toLocaleString()}`);
  return h;
}

export async function getLatestAttested(
  ci: chainInfo.ChainInfoProvider,
  chainKey: number,
): Promise<HeightHash> {
  const r = await retry('chainInfo.getLatestAttestedHeightAndHash', () =>
    ci.getLatestAttestedHeightAndHash(chainKey),
  );
  log.surface(
    'chainInfo.getLatestAttestedHeightAndHash',
    `key ${chainKey} -> height ${r.height.toLocaleString()} (${r.isAttestation ? 'attestation' : 'checkpoint'}, exists=${r.exists})`,
  );
  return r;
}

export async function getContinuityBounds(
  ci: chainInfo.ChainInfoProvider,
  chainKey: number,
  height: number,
): Promise<chainInfo.ContinuityBounds> {
  const b = await retry('chainInfo.getContinuityBounds', () => ci.getContinuityBounds(chainKey, height));
  log.surface(
    'chainInfo.getContinuityBounds',
    `key ${chainKey} height ${height.toLocaleString()} -> isAttested=${b.isAttested}`,
  );
  return b;
}

/** Poll the prover until `height` is attested. 15 s poll, 20 min timeout (docs/02 §7). */
export async function waitAttested(
  pb: proofProvider.service.ProofBuilder,
  chainKey: number,
  height: number,
  pollMs = 15_000,
  timeoutMs = 1_200_000,
): Promise<void> {
  log.surface(
    'ProofBuilder.waitUntilHeightAttested',
    `waiting for key ${chainKey} height ${height.toLocaleString()}`,
  );
  await pb.waitUntilHeightAttested(chainKey, height, pollMs, timeoutMs);
}

/** `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` via the SDK. Throws on `success == false`. */
export async function fetchProof(
  pb: proofProvider.service.ProofBuilder,
  txHash: string,
): Promise<ContinuityResponse> {
  const r = await retry(
    'ProofBuilder.getProof',
    async () => {
      const res = await pb.getProof(txHash);
      if (!res.success || !res.data) throw new Error(`proof failed: ${res.error ?? 'unknown error'}`);
      return res.data;
    },
    { timeoutMs: 120_000, attempts: 3 },
  );
  log.surface(
    'ProofBuilder.getProof',
    `tx ${txHash.slice(0, 10)}... -> header ${r.headerNumber.toLocaleString()}, txIndex ${r.txIndex}, ` +
      `${r.merkleProof.siblings.length} siblings, ${r.continuityProof.roots.length} continuity roots, cached=${r.cached}`,
  );
  return r;
}

/** Pre-flight `eth_call` against the precompile — never submit a tx when this is false. */
export async function dryRun(
  prover: blockProver.PrecompileBlockProver,
  d: ContinuityResponse,
): Promise<boolean> {
  const ok = await retry(
    'PrecompileBlockProver.verifySingle',
    () => prover.verifySingle(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof),
    { timeoutMs: 60_000, attempts: 3 },
  );
  log.surface('PrecompileBlockProver.verifySingle', `dry-run (eth_call, 0xFD2) -> ${ok}`);
  return ok;
}

/** Off-chain twin of `INativeQueryVerifier.calculateTxIndex` — sanity-checks the queryId inputs. */
export async function computeTxIndex(
  prover: blockProver.PrecompileBlockProver,
  d: ContinuityResponse,
): Promise<number> {
  const i = await retry('PrecompileBlockProver.computeTransactionIndex', () =>
    prover.computeTransactionIndex(d.merkleProof),
  );
  log.surface(
    'PrecompileBlockProver.computeTransactionIndex',
    `-> ${i} (prover-reported txIndex ${d.txIndex})`,
  );
  return i;
}

/** Argument tuple for `ProvenFeedRegistry.recordRound` / `ASCBase.execute` (docs/04 §2). */
export type ProofArgs = readonly [
  chainKey: number,
  blockHeight: number,
  encodedTransaction: string,
  merkleRoot: string,
  siblings: { hash: string; isLeft: boolean }[],
  lowerEndpointDigest: string,
  continuityRoots: string[],
];

export function toProofArgs(d: ContinuityResponse): ProofArgs {
  return [
    d.chainKey,
    d.headerNumber,
    d.txBytes,
    d.merkleProof.root,
    d.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    d.continuityProof.lowerEndpointDigest,
    d.continuityProof.roots,
  ] as const;
}

/** One transaction's slot in a batch proof, flattened out of the SDK's nested maps. */
export interface BatchElement {
  height: number;
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] };
}

/** A batch proof: one continuity proof, many transactions (FR-32). */
export interface BatchProof {
  chainKey: number;
  fromHeader: number;
  toHeader: number;
  lowerEndpointDigest: string;
  continuityRoots: string[];
  elements: BatchElement[];
  cached: boolean;
}

/**
 * `POST /api/v1/proof-batch-by-tx/{chainKey}` via the SDK — FR-32.
 *
 * The response nests Merkle proofs as `header -> txIndex -> entry`; this flattens them into the
 * index-aligned arrays `recordRoundBatch` takes, sorted by header so the order is deterministic
 * rather than dependent on map iteration.
 */
export async function fetchBatchProof(
  pb: proofProvider.service.ProofBuilder,
  txHashes: readonly string[],
): Promise<BatchProof> {
  const d = await retry(
    'ProofBuilder.getBatchProof',
    async () => {
      const res = await pb.getBatchProof([...txHashes]);
      if (!res.success || !res.data) throw new Error(`batch proof failed: ${res.error ?? 'unknown error'}`);
      return res.data;
    },
    { timeoutMs: 180_000, attempts: 3 },
  );

  const elements: BatchElement[] = [];
  for (const [height, byIndex] of [...d.merkleProofs.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [, e] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
      elements.push({
        height,
        txHash: e.txHash,
        txBytes: e.txBytes,
        merkleProof: {
          root: e.merkleProof.root,
          siblings: e.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
        },
      });
    }
  }

  log.surface(
    'ProofBuilder.getBatchProof',
    `${txHashes.length} tx -> headers ${d.fromHeader.toLocaleString()}-${d.toHeader.toLocaleString()}, ` +
      `${elements.length} merkle proofs, ONE continuity proof of ${d.continuityProof.roots.length} roots, ` +
      `cached=${d.cached}`,
  );

  return {
    chainKey: d.chainKey,
    fromHeader: d.fromHeader,
    toHeader: d.toHeader,
    lowerEndpointDigest: d.continuityProof.lowerEndpointDigest,
    continuityRoots: d.continuityProof.roots,
    elements,
    cached: d.cached,
  };
}

/** Pre-flight `eth_call` against the precompile's BATCH overload — never submit on false. */
export async function dryRunBatch(
  prover: blockProver.PrecompileBlockProver,
  b: BatchProof,
): Promise<boolean> {
  const ok = await retry(
    'PrecompileBlockProver.verifyBatch',
    () =>
      prover.verifyBatch(
        b.chainKey,
        b.elements.map((e) => e.height),
        b.elements.map((e) => e.txBytes),
        b.elements.map((e) => e.merkleProof) as never,
        { lowerEndpointDigest: b.lowerEndpointDigest, roots: b.continuityRoots },
      ),
    { timeoutMs: 60_000, attempts: 3 },
  );
  log.surface(
    'PrecompileBlockProver.verifyBatch',
    `dry-run (eth_call, 0xFD2, ${b.elements.length} tx, 1 shared continuity proof) -> ${ok}`,
  );
  return ok;
}

/** Argument tuple for `ProvenFeedRegistry.recordRoundBatch` (FR-32). */
export type BatchProofArgs = readonly [
  chainKey: number,
  blockHeights: number[],
  encodedTransactions: string[],
  merkleProofs: { root: string; siblings: { hash: string; isLeft: boolean }[] }[],
  lowerEndpointDigest: string,
  continuityRoots: string[],
];

export function toBatchProofArgs(b: BatchProof): BatchProofArgs {
  return [
    b.chainKey,
    b.elements.map((e) => e.height),
    b.elements.map((e) => e.txBytes),
    b.elements.map((e) => e.merkleProof),
    b.lowerEndpointDigest,
    b.continuityRoots,
  ] as const;
}
