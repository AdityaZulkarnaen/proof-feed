# 02 — Architecture

## 1. Components

```
ETHEREUM MAINNET (Attestcoin chain key 3)            CREDITCOIN CC3 TESTNET (chainId 102031)
────────────────────────────────────────            ─────────────────────────────────────────────
Chainlink USDC/USD proxy 0x8fFf…18f6                 ┌──────────────────────────────────────────┐
   └─ aggregator() = 0x…(phase N)   ──emits──►       │ ProvenFeedRegistry (extends ASCBase)     │
        AnswerUpdated(current, roundId, updatedAt)   │  recordRound(proof) ─► 0xFD2 precompile  │
                                                     │    verifyAndEmit ─► TransactionVerified  │
             │                                       │  EvmV1Decoder ─► receipt.logs            │
             │ (1) tx hash                           │  emitter == feeds[chainKey][emitter]?    │
             ▼                                       │  rounds[feedId][roundId] = {answer,…}    │
┌──────────────────────────────┐                     │  emit RoundProven                         │
│ pf CLI / keeper (TypeScript) │                     └───────────────┬──────────────────────────┘
│  @gluwa/usc-sdk 0.18.0       │                                     │ read
│  (2) waitUntilHeightAttested │                     ┌───────────────▼──────────────────────────┐
│  (3) getProof(txHash)        │                     │ ProvenFeedAdapter (Chainlink-shaped view) │
│  (4) verifySingle dry-run    │                     │  latestRoundData(), getRoundData(id)      │
│  (5) recordRound/proveAndClaim│──── tx ──────────► └──────────────────────────────────────────┘
└──────────────────────────────┘                     ┌──────────────────────────────────────────┐
             ▲                                       │ PegGuard                                  │
             │                                       │  deposit / buyCover / claim / expire      │
Prover service (hosted):                             │  claim(policyId, roundId) reads registry  │
  GET  /api/v1/health                                │  proveAndClaim = recordRound + claim      │
  GET  /api/v1/attested-height/{chainKey}            └──────────────────────────────────────────┘
  GET  /api/v1/proof-by-tx/{chainKey}/{txHash}
```

Off-chain the CLI never *decides* anything: it fetches a proof for a transaction that exists, and the
contract either verifies it or reverts. The CLI's private key is a gas payer, not an oracle.

## 2. End-to-end sequence (happy path, one round)

```mermaid
sequenceDiagram
  participant CL as Chainlink aggregator (ETH mainnet)
  participant K as pf CLI / keeper
  participant P as Prover service
  participant CC as Creditcoin RPC
  participant R as ProvenFeedRegistry
  participant V as 0xFD2 Block Prover precompile
  CL->>CL: transmit() emits AnswerUpdated(answer, roundId, updatedAt) in tx T at block B
  K->>CL: eth_getLogs(aggregator, topic0=AnswerUpdated)
  K->>CC: chainInfo.getLatestAttestedHeightAndHash(3)
  K->>P: waitUntilHeightAttested(3, B)  (polls /attested-height/3, ~8 min lag)
  K->>P: getProof(T) -> {txBytes, merkleProof, continuityProof, headerNumber}
  K->>CC: blockProver.verifySingle(...) (eth_call dry run, no gas)
  K->>R: recordRound(3, B, txBytes, root, siblings, lowerEndpointDigest, roots)
  R->>V: calculateTxIndex(merkleProof) -> queryId
  R->>V: verifyAndEmit(3, B, txBytes, merkleProof, continuityProof)
  V-->>R: true (+ emits TransactionVerified(3, B, txIndex))
  R->>R: decodeReceiptFields(txBytes); status==1; logs filtered by AnswerUpdated sig
  R->>R: emitter -> feedId; roundId = phase<<64 | aggRound; store; maybe update latest
  R-->>K: RoundProven(feedId, roundId, answer, updatedAt, queryId, prover)
```

Claim path: identical, then `PegGuard.claim(policyId, roundId)` reads `registry.getRound` and pays.

## 3. Data model (on-chain)

```
Feed      { uint64 chainKey; address emitter; uint16 phaseId; uint8 decimals; bool active; string description; }
Round     { int256 answer; uint64 updatedAt; uint64 provenAt; address prover; bytes32 queryId; bool exists; }
Policy    { bytes32 feedId; address holder; int256 strike; uint128 notional; uint128 premiumPaid;
            uint64 start; uint64 expiry; Status status; uint80 claimRoundId; }
Pool      { uint256 balance; uint256 locked; uint256 totalShares; mapping shares; uint16 premiumBpsPer30d;
            uint32 waitingPeriod; uint128 maxNotional; bool active; }
```

Keys: `feedId = keccak256(bytes(description))` e.g. `keccak256("USDC / USD")` — **use the exact string
returned by the proxy's `description()`** so the id is derivable by anyone. `emitterKey = keccak256(abi.encode(chainKey, emitter))`.

## 4. Trust model

| Question | Answer |
|---|---|
| Who can submit a round? | Anyone. Submission is permissionless; correctness is enforced by the precompile + decoder + emitter check. |
| What can a malicious submitter do? | Nothing except pay gas. A fake event would come from an unregistered emitter → revert. A tampered proof → precompile reverts/returns false. A replayed proof → `processedQueries` revert. |
| What can the registry owner do? | Register/deactivate feeds (configuration). The owner cannot insert, alter, or delete a price. Documented centralization point; P2 explores permissionless registration. |
| What does a consumer trust? | Ethereum consensus, Chainlink's aggregator (same trust as any Chainlink consumer on mainnet), and Creditcoin's attestor set (the Attestcoin Protocol). No project-run server is in the trust path. |
| Freshness | Not guaranteed. A proven round is a lower bound on what Chainlink has published. Consumers must check `updatedAt` against their own staleness policy. What bounds a selective prover is the **heartbeat**, which is measurable and was measured (docs/05: USDC/USD 23.01 h observed, ETH/USD 1.02 h observed): a keeper that skips rounds can hide movement only until the next heartbeat round, which it must also skip to keep hiding — and every skipped round remains provable by anyone else. Deviation thresholds are Chainlink's documented figures and are not something this system verifies. PegGuard is immune to the whole question (existence semantics), and since FR-33 it additionally refuses to *sell* cover priced against a reference older than `maxReferenceAge`. |
| Liveness | Depends on someone running `pf watch`. P1 adds a bounty. |

## 5. Security invariants (tested — see docs/07)

| ID | Invariant |
|---|---|
| INV-01 | A `Round` exists in storage only if `recordRound` verified its transaction via `0xFD2` (through the inherited `ASCBase` helpers) in the same call. No other write path to `rounds`. |
| INV-02 | `rounds[feedId][roundId]` is written at most once. |
| INV-03 | A log is accepted only if `log.address_` maps to an active feed **for the `chainKey` of the proof**. |
| INV-04 | `receiptStatus == 1` and `isValidTransactionType` are enforced before any log is read. |
| INV-05 | `latestRoundId[feedId]` is monotonically non-decreasing. |
| INV-06 | `queryId` replay is impossible (inherited from `ASCBase.processedQueries`). |
| INV-07 | `PegGuard`: `pool.locked ≤ pool.balance` at all times; `withdraw` never touches locked funds. |
| INV-08 | A policy can be claimed at most once, only while ACTIVE, only with a round whose `start ≤ updatedAt ≤ expiry` and `answer < strike`. |
| INV-09 | Payout recipient is always `policy.holder`, regardless of `msg.sender`. |
| INV-10 | `proveAndClaim` is atomic: if the claim fails, the round is still recorded? **No** — whole tx reverts (simpler, no partial state). Document this. |
| INV-11 | No function on any contract accepts a price/round value directly from calldata except via `recordRound` proof bytes. |

## 6. Gas budget (targets; measure on Day 1)

| Operation | Expected | Source |
|---|---|---|
| `verifyAndEmit` single tx | ~100k–400k | index41 measured 292k for a 3-leg probe, 1.09M for 3 legs + decoding |
| `recordRound` (verify + decode + store) | ≤ 1.0M target, 2.0M hard cap (NFR-01) | — |
| `proveAndClaim` | `recordRound` + ~120k | — |
| Block cap | 75,000,000 | SDK `utils.gas.MAX_GAS_CAP` |

Gas estimation may fail on precompile calls (pallet-evm drops revert reasons during estimation) —
see docs/04 §5 for the fallback formula.

## 7. Failure modes and behaviour

| Failure | Behaviour |
|---|---|
| Block not yet attested | CLI waits (`waitUntilHeightAttested`, poll 15 s, timeout 20 min); prints latest attested height every poll. |
| Prover 5xx / retriable error | Exponential backoff, max 10 attempts, then exit non-zero with the last error body. |
| Dry-run `verifySingle` false | Do **not** submit. Print proof summary and exit 2. |
| `recordRound` reverts `Query already processed` | Treat as success-idempotent in `watch`; print existing `RoundProven`. |
| `NoMatchingLogs` | The tx is not a registered aggregator's transmit; print emitter addresses found. |
| Claim with round outside window | Revert `RoundOutsideWindow(updatedAt, start, expiry)`. |
| Pool underfunded for `buyCover` | Revert `InsufficientCapacity(available, notional)`. |

## 8. Why this maps to the hackathon rubric

Reported judging emphasis (from another submitter's README, unverified): *depth of Attestcoin Protocol
utilization*. Surfaces this design makes load-bearing, all exercised on the default path:
`recordRound` (via `ASCBase._verifyProof`/`_computeQueryId`) → `INativeQueryVerifier.verifyAndEmit`, `calculateTxIndex` (queryId),
`EvmV1Decoder.{getTransactionType,isValidTransactionType,decodeReceiptFields,getLogsByEventSignature}`,
SDK `chainInfo.{getSupportedChainByKey,getAttestationGenesisHeight,getLatestAttestedHeightAndHash}`,
`proofProvider.service.ProofBuilder.{waitUntilHeightAttested,getProof}`,
`blockProver.PrecompileBlockProver.verifySingle` (pre-flight), `utils.gas.MAX_GAS_CAP`, and the
precompile's `TransactionVerified` log read back by the CLI/web page. Keep the README table honest:
count only surfaces that do real work on `npm run pf -- prove`.
