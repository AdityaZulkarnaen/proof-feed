# 01 — Product Requirements Document (PRD)

Status: FROZEN for P0. Changes require editing this file first.

## 1. Problem

1. **Creditcoin has no trust-minimized external price data.** New L1s wait years for an oracle
   network to deploy. Creditcoin's own `TWAPReader` in `@gluwa/asc-contracts` is fed by a single
   off-chain `oracleService` address that pushes observations — a trusted push model. Every DeFi
   primitive on Creditcoin that needs a USD price today must either trust an operator or not exist.
2. **Ethereum mainnet already has the most battle-tested price data (Chainlink), and the Attestcoin
   Protocol can cryptographically prove any mainnet transaction to Creditcoin.** A Chainlink round
   update is just a mainnet transaction whose receipt contains `AnswerUpdated(current, roundId, updatedAt)`.
   Nobody has connected these two facts into a reusable primitive.
3. **Stablecoin depeg risk is uninsurable on most chains** because the trigger (an oracle print below
   a threshold) is either unavailable or requires trusting whoever reports it. A claim that depends on a
   trusted reporter is a claim that can be denied.

## 2. Solution

**ProofFeed** — a registry contract on Creditcoin. Anyone can submit an Attestcoin proof of a mainnet
Chainlink `AnswerUpdated` transaction. The contract verifies the proof with the Block Prover
precompile, decodes the log from the verified bytes, checks the emitter is the registered aggregator,
and records `(roundId, answer, updatedAt)`. An `AggregatorV3Interface`-shaped adapter exposes the data
to any Creditcoin contract that already speaks Chainlink.

**PegGuard** — a parametric cover product using ProofFeed as its only trigger. A holder buys cover
"pay me `notional` if `feed` prints below `strike` between `start` and `expiry`". To claim, the holder
(or anyone) proves the breaching round. The claim needs no adjuster, no vote, no admin.

### Why the freshness problem does not break PegGuard
Attestcoin can prove *"round R happened and printed X"*; it cannot prove *"R is the latest round"*.
For a general price feed that is a real limitation (documented as a lower-bound / bounded-staleness
feed). For PegGuard it is irrelevant: the policy pays if **any** round in the coverage window breached
the strike. Existence is exactly what a transaction proof establishes.

## 3. Users

| Persona | Need | Served by |
|---|---|---|
| Creditcoin DeFi builder | A USD price for USDC/ETH/BTC they can justify to an auditor | ProofFeed adapter |
| Stablecoin treasury / DAO on Creditcoin | Hedge USDC/USDT depeg without counterparty discretion | PegGuard policy |
| Underwriter / yield seeker | Earn premiums by backing cover with CTC | PegGuard pool |
| Keeper / prover (anyone) | Earn nothing (P0) or a bounty (P1) for submitting proofs | CLI `watch` |
| Hackathon judge | Verify depth of Attestcoin integration in minutes | README + Blockscout links |

## 4. Scope

### P0 — must ship (Definition of Done in CLAUDE.md)

| ID | Requirement |
|---|---|
| FR-01 | `ProvenFeedRegistry` extends `ASCBase`. Owner registers feeds: `(feedId, chainKey, emitter, phaseId, decimals, description)`. Multiple emitters (phases) per feedId allowed; each emitter maps to exactly one feedId. |
| FR-02 | `recordRound(chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)` (same proof parameters as `ASCBase.execute`, see D-03) records every `AnswerUpdated` log in the proven transaction whose emitter is a registered, active feed for that `chainKey`. Rejects if zero logs match. |
| FR-03 | Stored round id = `(phaseId << 64) | aggregatorRoundId` (Chainlink proxy convention) as `uint80`. |
| FR-04 | Registry tracks `latestRoundId[feedId]`; updated only when a proven round id is strictly greater. Older rounds are still stored (needed for claims and history). |
| FR-05 | Views: `latestRoundData(feedId)`, `getRound(feedId, roundId)`, `isFresh(feedId, maxAge)`, `feedOf(chainKey, emitter)`. |
| FR-06 | `ProvenFeedAdapter(registry, feedId)` exposes Chainlink-shaped `decimals()`, `description()`, `latestRoundData()`, `getRoundData(uint80)`. Reverts if no round proven yet. |
| FR-07 | `PegGuard` pools per feedId: `deposit()` (native CTC) → shares; `withdraw(shares)` limited to unlocked liquidity. |
| FR-08 | `buyCover(feedId, strike, notional, durationDays)` payable premium; premium = `notional × premiumBpsPer30d × durationDays / 30 / 10_000`; locks `notional` in pool; policy `start = block.timestamp + waitingPeriod`. |
| FR-09 | `claim(policyId, roundId)`: round exists in registry for policy.feedId, `start ≤ updatedAt ≤ expiry`, `answer < strike`, policy active → pay `notional` to holder, unlock, mark CLAIMED. Callable by anyone (payout always goes to holder). |
| FR-10 | `proveAndClaim(policyId, roundId, proofArgs…)`: calls `registry.recordRound(proofArgs…)` then `claim`. Single Creditcoin transaction. |
| FR-11 | `expire(policyId)`: after expiry and not claimed → unlock capacity, mark EXPIRED. Anyone can call. |
| FR-12 | CLI `pf spike` prints the Day-1 gate table (see docs/06) and writes `docs/spike-output.json`. |
| FR-13 | CLI `pf prove --feed <F> --tx <hash>`: wait attestation → fetch proof → dry-run `verifySingle` → submit `recordRound` → print Blockscout link + decoded round. |
| FR-14 | CLI `pf watch --feed <F>`: poll the mainnet aggregator for new `AnswerUpdated` logs and run the `prove` pipeline for each; idempotent (skips already-proven rounds by reading the registry). |
| FR-15 | CLI `pf claim --policy <id> --tx <hash>` runs `proveAndClaim`. |
| FR-16 | CLI `pf capture --tx <hash> --out <file>` stores the full `ContinuityResponse` as a JSON fixture for Foundry. |
| FR-17 | Deploy script + `docs/DEPLOYMENT.md` with addresses, verification links, and every demo tx hash. |
| FR-18 | README sections: problem, how it works, Attestcoin surfaces table, security model, limitations, reproduce-in-3-commands. |

### P1 — only after P0 is deployed and demoed

| ID | Requirement |
|---|---|
| FR-20 | Prover bounty: `buyCover` premium includes a `proverBounty` paid to `msg.sender` of the successful `claim`/`recordRound` that first proves the breaching round. |
| FR-21 | `ProvenFeedRegistry.registerFeedFromProxy` helper in CLI that reads `aggregator()`, `phaseId()`, `decimals()`, `description()` from the mainnet proxy and calls `registerFeed` — no hand-typed addresses. |
| FR-22 | Multiple feeds registered: USDC/USD, USDT/USD, ETH/USD. |
| FR-23 | Static web page (`web/`) reading registry + PegGuard state live from CC3 RPC; shows which source (live/cached) is displayed. |

### P2 — stretch (status as of 2026-09-09)
| ID | Requirement | Status |
|---|---|---|
| FR-30 | Proportional payout option (`payout = notional × (strike − answer)/strike`, capped). | **Shipped.** `PayoutMode.PROPORTIONAL` chosen at `buyCover`, priced at its own lower rate (D-13). Demonstrated on chain against the same round as a full-payout policy. |
| FR-31 | Permissionless feed registration gated by proving the proxy's `AggregatorUpdated`-style upgrade event (research). | **Researched, not shipped (D-14).** The gating event has not occurred on any major mainnet feed inside the attestable window, so the feature would be unexercisable dead code. |
| FR-32 | Batch `recordRound` for several rounds sharing one continuity proof (SDK `getBatchProof`). | **Shipped.** `recordRoundBatch` + `pf prove-batch`, using the precompile's batch `verifyAndEmit` overload. Gas measured both ways: a win for clustered rounds, a loss for scattered ones (D-15). |
| FR-33 | Underwriting bound on strikes: a pool may not sell cover that is already in the money, and may not price new cover against a stale reference. | **Shipped 2026-09-09 (D-16).** `Pool.maxStrikeBps` (default: at the latest proven answer, never above it) and `Pool.maxReferenceAge` (default 24h), enforced in `buyCover` and exposed as `strikeCap(feedId)`. Closes a hole found in review: premium is a function of notional and duration only, so without a ceiling the first buyer could name a strike above spot and drain the pool. |

### Out of scope (say so in README)
- Proving `latestRoundData()`/state; proving the *absence* of rounds.
- Writing anything back to Ethereum.
- Mainnet deployment, audits, real money. Payout asset is testnet CTC.
- Governance of the feed registry beyond `Ownable2Step` (documented as a known centralization point of *configuration*, not of *data*).

## 5. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | One `recordRound` ≤ 2,000,000 gas on CC3 (block cap 75,000,000). Measure and record in README. |
| NFR-02 | End-to-end latency from mainnet round to Creditcoin record ≤ attestation lag + 60 s. Record measured attestation lag in `spike-output.json`. |
| NFR-03 | All contracts source-verified on Blockscout. |
| NFR-04 | Foundry tests run without network access; the real-network path is exercised only by CLI scripts and documented in `docs/DEPLOYMENT.md`. |
| NFR-05 | No secrets in the repo; `.env.example` documents every variable. |
| NFR-06 | Every CLI command prints the exact SDK/precompile surface it is exercising (judges assess "depth of Attestcoin utilization"). |

## 6. Success metrics (what the README must be able to show)

- ≥ 1 real mainnet Chainlink round proven and stored (Blockscout tx with `TransactionVerified` + `RoundProven`).
- ≥ 1 PegGuard claim paid by proof (Blockscout tx with `ClaimPaid`).
- Gas per `recordRound` and per `proveAndClaim` measured.
- Measured attestation lag (mainnet block → attested) in minutes.
- Foundry: 100% of P0 contract functions covered by at least one test; a real-fixture decode test.

## 7. Demo branches (decided on Day 1 — see docs/06)

- **Branch H (historical):** if `getAttestationGenesisHeight(3)` ≤ the block of the March-2023 USDC
  depeg, the demo proves a real USDC/USD round from that day and pays a claim. Strongest story.
- **Branch L (live threshold):** otherwise, demo cover on ETH/USD with a strike slightly above the
  current price so the next natural Chainlink round (≤ 1 h heartbeat / 0.5% deviation) breaches it. Same
  code path; README states plainly why ETH/USD is used for the claim demo while USDC/USD is used for
  the feed-import demo.
- **Branch S (Sepolia fallback):** only if mainnet chain key 3 is unusable on Day 1. Deploy our own
  `MockAggregator` on Sepolia (chain key 1), emit a synthetic depeg round, prove it. Clearly labeled.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prover down / attestation stalls | `pf spike` re-run; CLI retries with backoff; keep captured proof fixtures so tests never depend on the network. |
| Chainlink aggregator does not emit `AnswerUpdated` (only `NewTransmission`) | Day-1 gate G3 checks real logs; contract has a second decoder path only if G3 says so (docs/09 Q2). |
| Genesis height too recent for Branch H | Branch L is fully specified; decide on Day 1, not Day 5. |
| Gas estimation fails on precompile | Use `estimateGas × 1.35` with the fallback formula from the official examples (docs/04). |
| Scope creep | P0 list above is the whole product until DoD is met. |
