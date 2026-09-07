# 04 — Relayer / CLI Specification (`cli/`)

Package name `proof-feed-cli`, binary alias `pf` (`npm run pf -- <command>`), TypeScript strict,
`tsx` runtime, `ethers@6`, `@gluwa/usc-sdk@0.18.0`, `dotenv`, `commander` (or a tiny hand-rolled
arg parser — no other deps). Node 20+.

## 1. Environment (`.env` at repo root; `.env.example` is committed)

| Var | Required | Notes |
|---|---|---|
| `CREDITCOIN_RPC_URL` | yes | `https://rpc.cc3-testnet.creditcoin.network` |
| `CREDITCOIN_WALLET_PRIVATE_KEY` | for tx commands | 0x-prefixed, 66 chars. Fund via testnet faucet (docs/05 §1). |
| `PROOF_BUILDER_URL` | yes | `https://prover.cc3-testnet.creditcoin.network` (Day-1 health check; alt in docs/05) |
| `ETH_MAINNET_RPC_URL` | yes | any archive-capable public RPC is fine for logs ≤ 50-block ranges |
| `ETH_SEPOLIA_RPC_URL` | Branch S only | |
| `SOURCE_CHAIN_KEY` | default 3 | 3 = Ethereum mainnet, 1 = Sepolia (on CC3 testnet) |
| `REGISTRY_ADDRESS`, `PEGGUARD_ADDRESS`, `ADAPTER_ADDRESS` | after deploy | |
| `FEED_PROXY_USDC_USD` | default `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | mainnet proxy |
| `FEED_PROXY_ETH_USD` | default `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | mainnet proxy |
| `LOG_LEVEL` | default `info` | |

Config loading mirrors the official examples: shell env > `.env`. Fail fast with a clear message
naming the missing variable.

## 2. Shared library (`src/lib/`)

### `attestcoin.ts` — the only file that touches `@gluwa/usc-sdk`
```ts
import { chainInfo, proofProvider, blockProver, utils } from '@gluwa/usc-sdk';
import { JsonRpcProvider } from 'ethers';

export function makeChainInfo(cc: JsonRpcProvider)  { return new chainInfo.PrecompileChainInfoProvider(cc); }
export function makeProofBuilder(chainKey: number, url: string) { return new proofProvider.service.ProofBuilder(chainKey, url, 15_000); }
export function makeBlockProver(cc: JsonRpcProvider) { return new blockProver.PrecompileBlockProver(cc); }

export async function waitAttested(pb, chainKey, height, log) {
  // poll 15 s, timeout 20 min (official example uses 1_200_000). Print latest attested height each poll.
  await pb.waitUntilHeightAttested(chainKey, height, 15_000, 1_200_000);
}
export async function fetchProof(pb, txHash): Promise<proofProvider.ContinuityResponse> {
  const r = await pb.getProof(txHash); if (!r.success || !r.data) throw new Error(`proof failed: ${r.error}`); return r.data;
}
export async function dryRun(prover, d: proofProvider.ContinuityResponse): Promise<boolean> {
  return prover.verifySingle(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
}
export function toProofArgs(d) {
  return [d.chainKey, d.headerNumber, d.txBytes, d.merkleProof.root, d.merkleProof.siblings,
          d.continuityProof.lowerEndpointDigest, d.continuityProof.roots] as const;
}
export const MAX_GAS_CAP = utils.gas.MAX_GAS_CAP;
```
`ContinuityResponse` fields (verified from SDK typings): `chainKey, headerNumber, txIndex, txHash,
txBytes, continuityProof{lowerEndpointDigest, roots[]}, merkleProof{root, siblings[{hash,isLeft}]}, cached, generatedAt`.

### `chainlink.ts`
```ts
export const ANSWER_UPDATED_TOPIC = '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f';
const PROXY_ABI = ['function aggregator() view returns (address)','function phaseId() view returns (uint16)',
                   'function decimals() view returns (uint8)','function description() view returns (string)',
                   'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'];
export async function resolveFeed(eth, proxy) -> { proxy, aggregator, phaseId, decimals, description, feedId: keccak256(toUtf8Bytes(description)) }
export async function findAnswerUpdatedLogs(eth, aggregator, fromBlock, toBlock) // chunked ≤ 50 blocks (public RPC limits), returns [{txHash, blockNumber, answer, aggRoundId, updatedAt}]
export function decodeAnswerUpdated(log) // topics[1] int256, topics[2] uint256, data uint256
```

### `creditcoin.ts`
- Contract factories for `ProvenFeedRegistry`, `PegGuard`, `ProbeASC` from ABIs exported by `forge build` (copy `contracts/out/*.json` ABI into `cli/src/abi/` via `npm run abi`).
- `submitRecordRound(registry, d, wallet)`: build calldata, compute gas (see §5), send, wait, parse `RoundProven` + precompile `TransactionVerified` logs from the receipt (filter by `address == 0x…0FD2`).
- `explorerTx(hash)` → `https://creditcoin-testnet.blockscout.com/tx/${hash}`.

### `log.ts` — structured logger; every step prints the **Attestcoin surface** it exercised, e.g.
`[surface] chainInfo.getLatestAttestedHeightAndHash(3) -> 25,9xx,xxx`. Used to build the README table honestly.

## 3. Commands

### `pf spike` (FR-12) — Day-1 gates, no product code required
Steps and outputs (write `docs/spike-output.json` + human table):
1. `GET {PROOF_BUILDER_URL}/api/v1/health` for both candidate hosts → pick the first 200.
2. `chainInfo.getSupportedChains()`; assert an entry with `chainKey==SOURCE_CHAIN_KEY` and `chainId==1` (mainnet) → **G1**.
3. `getAttestationGenesisHeight(3)` → print; compare to `HIST_USDC_DEPEG_BLOCK` (docs/05 §4) → **G5 (Branch H/L decision)**.
4. `getLatestAttestedHeightAndHash(3)` vs `eth.getBlockNumber()` → attestation lag in blocks and minutes → **G2** (pass if lag < 120 min).
5. `resolveFeed(USDC/USD)`; fetch last `AnswerUpdated` logs from the aggregator over the last ~20,000 blocks (chunked); assert ≥1 → **G3a** (if zero: see docs/09 Q2 — check `NewTransmission`).
6. Take the most recent log's tx: `waitAttested` (should be instant if lag is fine) → `getProof` → `dryRun` → **G3b** (pass if true).
7. If `CREDITCOIN_WALLET_PRIVATE_KEY` set and `--submit`: deploy `ProbeASC` (via `forge create` beforehand, address in env `PROBE_ADDRESS`) and call `execute(0, …)`; print Blockscout tx, gas used, decoded `Probe` events → **G4**.
8. Print gate table; exit 0 if G1–G3 pass, else exit 1 with the failing gate.

### `pf prove --feed <F> [--tx <hash> | --latest]` (FR-13)
- Resolve feed via proxy; if `--latest`, scan recent blocks for the newest `AnswerUpdated` tx of the aggregator.
- Idempotency check: compute expected `roundId = phaseId<<64 | aggRound`; if `registry.getRound(feedId, roundId).exists` → print "already proven" + exit 0.
- `waitAttested → fetchProof → dryRun (must be true) → submitRecordRound`.
- Print: Blockscout link, gas used, `RoundProven` args, `TransactionVerified(chainKey,height,txIndex)`, and `latestRoundData(feedId)` after.

### `pf watch --feed <F> [--from <block>] [--interval 30]` (FR-14)
Loop: `findAnswerUpdatedLogs` in ≤50-block chunks from last processed block → for each new log, run the
`prove` pipeline (skip if already proven; treat `"Query already processed"` as success). Persist cursor in
`cli/.state/<feedId>.json`. Graceful SIGINT.

### `pf claim --policy <id> --tx <hash>` (FR-15)
`fetchProof → dryRun → PegGuard.proveAndClaim(policyId, roundId, ...proofArgs)`; `roundId` derived from the
tx's `AnswerUpdated` log + registry phaseId. Print `ClaimPaid` and holder balance before/after.

### `pf capture --tx <hash> --out <file>` (FR-16)
Writes `{ capturedAt, sourceChainKey, txHash, proof: ContinuityResponse, decoded: {emitter, answer, aggRound, updatedAt} }`.
Fixtures are committed under `contracts/test/fixtures/` and read by Foundry via `vm.readFile` + `vm.parseJson`.
Keep hex strings 0x-prefixed; `siblings` as an array of `{hash, isLeft}` so `abi.decode` in tests is trivial —
also emit a second file `<name>.abi.hex` containing `abi.encode(chainKey, headerNumber, txBytes, root, siblings, lowerEndpointDigest, roots)` for direct decoding in Solidity.

### `pf demo --branch H|L|S` (docs/08)
Orchestrates the chosen demo script end-to-end with pauses and prints every tx link. No hidden steps.

## 4. Registration helper (P1 FR-21, but trivial — do it in P0 if time allows)
`pf register --proxy <address> --chain-key 3` → reads `aggregator(), phaseId(), decimals(), description()` and
calls `registry.registerFeed(keccak256(description), chainKey, aggregator, phaseId, decimals, description)`.
Print the exact args. **Never type an aggregator address by hand.**

## 5. Gas handling (copy the official examples' approach)
```
try { gas = await provider.estimateGas({to, data, from}) * 135n / 100n }
catch { gas = BigInt(21_000 + continuityRoots.length * 5_000 + 20_000) * 8n }   // fallback ×8 safety for decode-heavy recordRound; cap at MAX_GAS_CAP/10
```
Rationale: pallet-evm may drop precompile revert reasons during estimation (official examples note).
Always log `gasUsed` from the receipt and `gasAsPercentageOfMax` for the README.

## 6. Error handling and retries
- Every RPC / HTTP call: 15 s timeout, 5 retries with exponential backoff (1,2,4,8,16 s), except `waitUntilHeightAttested` which has its own polling.
- Non-retriable: proof `success=false` with non-retriable error body; dry-run false; contract revert with a custom error (decode and print the error name via the ABI).
- Exit codes: 0 ok, 1 configuration/gate failure, 2 verification failed, 3 contract revert.

## 7. Output for judges
Each command ends with a compact block:
```
SURFACES EXERCISED: chainInfo.getLatestAttestedHeightAndHash, ProofBuilder.waitUntilHeightAttested,
ProofBuilder.getProof, PrecompileBlockProver.verifySingle, INativeQueryVerifier.verifyAndEmit (on-chain),
EvmV1Decoder.decodeReceiptFields (on-chain)
```
