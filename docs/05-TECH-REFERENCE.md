# 05 — Technical Reference (ground truth)

Legend: **[OK]** verified from source code / official docs on 2026-09-07. **[VERIFY]** plausible but must be
confirmed during the Day-1 spike; write the evidence back here. **[D1]** verified by the Day-1 spike on
**2026-09-08**; evidence in `docs/spike-output.json` (reproduce with `npm run pf -- spike`).

## 1. Creditcoin CC3 Testnet [OK]

| Item | Value |
|---|---|
| chainId | `102031` |
| RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| Explorer | `https://creditcoin-testnet.blockscout.com` |
| Native token | CTC (testnet) |
| Faucet | `https://docs.creditcoin.org/wallets/using-testnet-faucet` — **[D1] works**; funded `0x259559fA11C2247f3fD5E1D87be9BFA816Fd97D7` with 10,000 CTC |
| Block Prover / Native Query Verifier precompile | `0x0000000000000000000000000000000000000FD2` (4050) |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` |
| Block gas cap (`utils.gas.MAX_GAS_CAP`) | `75_000_000` — **[D1] confirmed**: live block `gasLimit` is exactly 75,000,000 |
| Block time | **[D1] measured 15.15 s** average over 200 blocks |
| Precompile note | precompiles have no bytecode (`extcodesize == 0`) but accept calls; `NativeQueryVerifierLib.hasPrecompile()` special-cases chainIds 102030/102031/102032 |

## 2. Attestcoin Protocol on CC3 Testnet [OK unless tagged]

| Item | Value |
|---|---|
| Supported source chains | **[D1]** `getSupportedChains()` returns exactly 2: key **3** = `"Ethereum"` (chainId 1, encoding 1), key **1** = `"Sepolia ethereum"` (chainId 11155111, encoding 1). `chainName` comes back hex-encoded (`0x457468657265756d`). Confirms D-01. |
| Prover (proof builder) URL — candidate A | `https://prover.cc3-testnet.creditcoin.network` — **[D1] live**, `GET /api/v1/health` 200. **Selected.** |
| Prover URL — candidate B | `https://proof-gen-api.cc3-testnet.creditcoin.network` — **[D1] live**, byte-identical health payload and identical uptime counter, so both hostnames front the same service. **Q1 resolved: use candidate A.** |
| Prover health caveat | **[D1]** the health payload is `{"status":"degraded","cc3_rpc_connected":false,"eth_rpc_connected":true}`. This is the steady state and does **not** block proving — `getProof` returned valid proofs for both a fresh and a 2023 transaction while "degraded". Do not read it as a NO-GO. |
| Prover endpoints | `GET /api/v1/health`, `GET /api/v1/attested-height/{chainKey}`, `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` (used by `ProofBuilder.getProof`), `POST /api/v1/proof-batch/{chainKey}` (undocumented, used by index41) |
| Attestation lag | **[D1] measured 37–41 blocks ≈ 7.4–8.2 min** behind the mainnet head over three consecutive runs (e.g. attested 25,927,050 vs head 25,927,087). Matches the official "~8 min". Gate G2 allows 120 min, so ~15× headroom. |
| Attestation genesis height, chain key 3 | **[D1] returns `0`.** The SDK documents 0 as "chain unsupported **or** no configured genesis height" — **ambiguous, and it must not be used to decide Branch H/L.** Settled by direct probe instead (next two rows). |
| Deep-history coverage, chain key 3 | **[D1] `getContinuityBounds(3, h).isAttested == true`** at h = 16,810,000 / 20,000,000 / 25,000,000 / 25,500,000 / 25,800,000 / 25,900,000 — checkpoints reach back past the March-2023 depeg. Bound spacing widens with age (1,000-block gaps in 2023, 100-block gaps near the tip). |
| Deep-history proving | **[D1] CONFIRMED end-to-end.** `getProof` on the 2023-03-11 depeg tx returned in ~18 s (`cached=true`) and `PrecompileBlockProver.verifySingle` returned **true**. **Q4 resolved ⇒ Branch H is viable.** |
| Historical evidence mainnet works | index41 (BUIDL 47994) verified mainnet block `25,764,741` on CC3 testnet in tx `0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810` (status 1, 1,092,100 gas for 3 verifications + decode) |
| What is proven | `abiEncode(tx, receipt)` — transaction fields + receipt (status, gasUsed, logs, bloom). **Not state. Not block timestamp.** |
| Writability | not available on testnet (under third-party audit). One-directional only. |

## 3. Packages and APIs [OK — read from the installed packages]

### `@gluwa/asc-contracts@0.2.1` (Solidity, source distribution for Foundry)
- `contracts/readability/ASCBase.sol` — `abstract contract ASCBase`:
  - `INativeQueryVerifier public immutable VERIFIER;` `mapping(bytes32 => bool) public processedQueries;`
  - `function execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction, bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] calldata siblings, bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots) external returns (bool)` — NOT virtual.
  - `function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction) internal virtual;` — receives no chainKey.
  - `function _verifyProof(uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction, bytes32 merkleRoot, MerkleProofEntry[] calldata siblings, bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots) internal returns (bool)` — calls `VERIFIER.verifyAndEmit`.
  - `function _computeQueryId(uint64 chainKey, uint64 blockHeight, bytes32 merkleRoot, MerkleProofEntry[] calldata siblings) internal view returns (bytes32)` — `keccak256(chainKey ‖ blockHeight ‖ VERIFIER.calculateTxIndex(proof))`.
- `contracts/common/EvmV1Decoder.sol` — `library EvmV1Decoder` (all functions `internal pure` → inlined, **no linking**):
  - `getTransactionType(bytes) → uint8`, `isValidTransactionType(uint8) → bool` (types 0–4)
  - `decodeCommonTxFields(bytes) → CommonTxFields{nonce,gasLimit,from,toIsNull,to,value,data}`
  - `decodeReceiptFields(bytes) → ReceiptFields{receiptStatus,receiptGasUsed,receiptLogs[],receiptLogsBloom}`
  - `getLogsByEventSignature(ReceiptFields, bytes32) → LogEntry[]`; `LogEntry{address address_; bytes32[] topics; bytes data;}`
- `contracts/write-ability/common/INativeQueryVerifier.sol`:
  - structs `MerkleProofEntry{bytes32 hash; bool isLeft;}`, `MerkleProof{bytes32 root; MerkleProofEntry[] siblings;}`, `ContinuityProof{bytes32 lowerEndpointDigest; bytes32[] roots;}`
  - `event TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex)`
  - `verifyAndEmit(single)`, `verifyAndEmit(batch)`, `verify(single) view`, `verify(batch) view`, `calculateTxIndex(MerkleProof) view returns (uint64)`
  - `NativeQueryVerifierLib.PRECOMPILE = 0x…0FD2`, `getVerifier()`.
- Also present (not used): `write-ability/TWAPReader.sol` — Creditcoin's ATTEST/CTC TWAP fed by a single `oracleService` pusher (cite in README as the trusted-push status quo).

### `@gluwa/usc-sdk@0.18.0` (TypeScript; peer `ethers@6`)
Namespaces: `encoding, queryBuilder, proofProvider, chainInfo, blockProver, utils`.
- `chainInfo.PrecompileChainInfoProvider(rpc: JsonRpcApiProvider)`: `getSupportedChains(): ChainInfo[]{chainKey,chainId,chainName,chainEncoding}`, `getSupportedChainByKey(k)`, `getLatestAttestedHeightAndHash(k): {height,hash,isAttestation,exists}`, `getAttestationGenesisHeight(k): number`, `getContinuityBounds(k,h)`, `waitUntilHeightAttested(k,h,pollMs?,timeoutMs?,extraDelayMs?)`, `getCheckpointForHeight(k,h)`.
- `proofProvider.service.ProofBuilder(chainKey, builderUrl, timeoutMs?)`: `getProof(txHash): ProofResult{success,data?:ContinuityResponse,error?}`, `getBatchProof(hashes)`, `waitUntilHeightAttested(k,h,pollMs=15000,timeoutMs=900000,extraDelayMs?)` (polls the prover's `/attested-height`).
- `proofProvider.ContinuityResponse{chainKey, headerNumber, txIndex, txHash, txBytes, continuityProof{lowerEndpointDigest, roots}, merkleProof{root, siblings[{hash,isLeft}]}, cached, generatedAt}`.
- `blockProver.PrecompileBlockProver(rpc, precompile?)`: `verifySingle(chainKey, height, txBytes, merkleProof, continuityProof): boolean` (eth_call), `verifyBatch(...)`, `computeTransactionIndex(merkleProof)`; `BLOCK_PROVER_PRECOMPILE_ADDRESS`.
- `utils.gas.{computeGasLimit(provider, contract, data, from, continuityLength), MAX_GAS_CAP, gasAsPercentageOfMax}`; `utils.decoder` (off-chain EvmV1 decode).

### Official example repo (pattern source) [OK]
`https://github.com/gluwa/usc-testnet-bridge-examples` — `bridge/contracts/sol/ASCMinter.sol` (extends `ASCBase`, decodes a burn log), `shared/utils/index.ts` (`generateProofFor`, `computeGasLimit` with fallback, `contract.execute(action, chainKey, height, txBytes, root, siblings, lowerEndpointDigest, roots, {gasLimit})`), `bridge/foundry.toml` (solc 0.8.30, via_ir, shanghai, remappings). Its `.env.example` sets `PROOF_BUILDER_URL=https://prover.cc3-testnet.creditcoin.network`, `SOURCE_CHAIN_KEY=1` for Sepolia.

## 4. Chainlink on Ethereum mainnet

| Item | Value | Status |
|---|---|---|
| USDC/USD proxy | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | [OK] Etherscan "Chainlink: USDC/USD Price Feed" |
| ETH/USD proxy | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | [OK] Etherscan "Chainlink: ETH/USD Price Feed" |
| USDT/USD proxy | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` | [VERIFY] |
| Decimals | 8 (USD feeds) | [OK] general; confirm via `decimals()` |
| Current aggregator | `proxy.aggregator()`; phase via `proxy.phaseId()`; past aggregators via `proxy.phaseAggregators(uint16)` | [OK] AggregatorProxy ABI |
| Event we consume | `AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)` emitted **by the aggregator contract, not the proxy** | **[D1]** the *current* USDC/USD aggregator emitted **6** of them in the last 20,000 blocks. **Q2 resolved: `AnswerUpdated` only — no `NewTransmission` decoder path is needed.** |
| Current USDC/USD aggregator | `proxy.aggregator()` = `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7`; `phaseId()` = 3; `decimals()` = 8; `description()` = `"USDC / USD"` | **[D1]** read at runtime — never hardcode (CLAUDE.md rule 3) |
| `feedId` for USDC/USD | `keccak256("USDC / USD")` = `0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256` | **[D1]** |
| Phase aggregators, USDC/USD | `phaseAggregators(1)` = `0x3B15a92872435C01c27201AAe0968839fB45217D`; `(2)` = `0x789190466E21a8b78b8027866CBBDc151542A26C`; `(3)` = `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7` | **[D1]** enumerated at runtime |
| Observed cadence | the 6 recent rounds arrived roughly 2/day, in ~1 h-apart pairs — consistent with a 24 h heartbeat plus deviation triggers | **[D1]** |
| topic0 | `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f` | [OK] computed `keccak256("AnswerUpdated(int256,uint256,uint256)")` |
| Log layout | `topics[1] = int256 current` (as bytes32), `topics[2] = uint256 aggregatorRoundId`, `data = abi.encode(uint256 updatedAt)` | [OK] from signature (2 indexed + 1 non-indexed) |
| Sibling events (not consumed) | `NewRound(uint256,address,uint256)` topic0 `0x0109fc6f55cf40689f02fbaad7af7fe7bbac8a3d2186600afc7d3e10cac60271`; `NewTransmission(uint32,int192,address,uint32,bytes,bytes,bytes32,uint40)` topic0 `0xab70da5573104158dc13ef16d8871863903098c07de08b26b6318bb68cbf4a03` | [OK] computed |
| Proxy round id | `(phaseId << 64) | aggregatorRoundId` (uint80) | **[D1] CONFIRMED against live mainnet**: `proxy.latestRoundData().roundId` = `55340232221128656026`, and `(3 << 64) | 1178` = `55340232221128656026` exactly. Validates D-04 and test T-R15. |
| Update triggers | USDC/USD: deviation 0.25%, heartbeat 24 h; ETH/USD: deviation 0.5%, heartbeat 1 h | [VERIFY on data.chain.link] |
| Historical depeg (Branch H) | **[D1] EXACT TX LOCATED** — the low print came from the **phase-2** aggregator. Full details in §4a below. | **[D1]** |
| Sepolia (Branch S) | ETH/USD `0x694AA1769357215DE4FAC081bf1f309aDC325306` [VERIFY]; but Branch S uses our own `MockAggregator` emitting `AnswerUpdated`, registered with chain key 1. | |
| Tx type | Chainlink `transmit` txs are typically type 2 (EIP-1559); `EvmV1Decoder` supports types 0–4 | [OK] |

## 4a. The Branch H demo round — Day-1 verified [D1]

The lowest Chainlink USDC/USD print of the SVB depeg day, found by scanning every phase aggregator
across the UTC day 2023-03-11 (295 `AnswerUpdated` logs in phase 2; 0 in phase 3 — it did not exist yet).

| Field | Value |
|---|---|
| Answer | `88000000` = **$0.88000000** (8 decimals) |
| `updatedAt` | `1678521083` = 2023-03-11T07:51:23Z |
| Ethereum block | `16,803,472` |
| Transaction | `0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8` |
| Emitter (phase-2 aggregator) | `0x789190466E21a8b78b8027866CBBDc151542A26C` |
| Aggregator round id | `983` |
| Proxy round id, `(2 << 64) \| 983` | `36893488147419104215` |
| `getProof` | success in ~18 s, `cached=true`, txIndex `61`, **7** merkle siblings, **529** continuity roots, `txBytes` **4,192** bytes |
| `verifySingle` dry-run | **true** |

Alternates the same day, if the primary is ever unusable: $0.88160660 (round 970, block 16,803,291),
$0.88216168 (round 968, block 16,803,286), $0.88310000 (round 982, block 16,803,458).

> **Gas warning.** 529 continuity roots is ~9× the 57 roots of a fresh transaction, and the on-chain
> cost of `_verifyProof` scales with that array. `recordRound` on the historical proof will be much
> more expensive than on a live round. Measure **both** before quoting a number in the README, and
> check the historical one against the NFR-01 cap of 2,000,000 gas. This is the main open risk in
> Branch H (Q6).

## 4b. Source-chain RPC access — Day-1 verified [D1] (docs/09 Q7)

`eth_getLogs` support across free public mainnet RPCs varies enough to decide how the CLI scans.

| Endpoint | `eth_getLogs` verdict |
|---|---|
| `https://gateway.tenderly.co/public/mainnet` | **20,000-block ranges OK — selected, and now the CLI default** |
| `https://rpc.mevblocker.io` | max 10,000 blocks |
| `https://cloudflare-eth.com` | max 800 blocks; also rejects `eth_blockNumber` ("Cannot fulfill request") |
| `https://1rpc.io/eth` / `https://eth-pokt.nodies.app` | max 50 / 10 blocks |
| `https://ethereum-rpc.publicnode.com` | **403 Forbidden on `eth_getLogs` at any range** (other methods work) — this was the original `.env.example` suggestion |
| `https://rpc.ankr.com/eth` | API key required |
| `https://eth.llamarpc.com`, `blockpi`, `flashbots` | 5xx at the time of testing |

The CLI starts at a 20,000-block chunk and quarters it on rejection down to 50 blocks, so a
restrictive endpoint still works — it just costs more requests.

## 5. Hackathon facts [OK from DoraHacks page / press]

- Name: BUIDL CTC 2026 Fall — "BUIDL For The Real World"; sponsors Creditcoin & Credit Labs.
- Submission window opened 2026-08-13; original deadline 2026-09-06 04:59; **extended to 2026-09-14 03:59** (timezone as displayed on DoraHacks — verify).
- Winner announcement 2026-09-18; awards at CTC Ignition 2026, Seoul, 2026-09-28. Prizes $10k / $3k / $2k; top 3 → CEIP fast-track.
- Requirements: original work created during the hackathon; deployed on testnet; Attestcoin Protocol as a core feature; no third-party IP infringement.
- Tracks: DeFi, RWA, DePIN, Gaming, AI. We submit **DeFi**.
- Help: `team@creditcoin.org`, Discord `#buidl-ctc-qna`.
- Known submissions to differentiate from: Oracle-Free Council (AI treasury), CovenantX (Aave borrow/repay covenants → freeze credit facility), index41 (tx ordering / sandwich court). None imports Chainlink rounds or offers parametric cover.

## 6. Naming conventions

- `feedId = keccak256(bytes(description))` with `description` exactly as returned by the proxy (e.g. `"USDC / USD"` — note the spaces; do not normalize).
- `emitterKey = keccak256(abi.encode(uint64 chainKey, address emitter))`.
- Prices in feed decimals: `0.97 USD` on an 8-decimal feed is `97_000_000`.
