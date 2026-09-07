# 08 — Demo & Submission

> **Updated 2026-09-08 to match what actually shipped.** The original script assumed one branch would
> be chosen. Both ran: the *feed import* is Branch H (the real 2023 depeg round) and the *claim* is
> Branch L (a live ETH/USD round). §1a below is the script to record; §1 is kept as the original.

## 1a. Demo video script — as built (≤ 3 min)

| t | Screen | Say |
|---|---|---|
| 0:00 | Title card | "Every price here is a real Ethereum mainnet Chainlink transaction, cryptographically verified on Creditcoin. No relayer. No admin key can insert a number." |
| 0:10 | Etherscan, tx `0x24500a30…acd8`, 2023-03-11 | "March 11th 2023. Silicon Valley Bank has failed and USDC has lost its peg. This is the Chainlink round that printed 88 cents." |
| 0:25 | Terminal: `npm run pf -- demo --branch H` | Narrate the surfaces: `getProof` returns a proof with 529 continuity roots for a three-year-old block; `verifySingle` dry-run returns true. |
| 0:50 | Blockscout, tx `0x51391915…2d06` | "`TransactionVerified` from the precompile at 0xFD2, and `RoundProven` from our registry. 628,000 gas — under one percent of a Creditcoin block. That 2023 round now lives on Creditcoin." |
| 1:10 | `cast call $ADAPTER "getRoundData(uint80)" 36893488147419104215` | "Readable through the plain Chainlink interface. Any contract already written for Chainlink works unmodified." |
| 1:25 | Terminal: `npm run pf -- prove --feed USDC/USD --latest` | "And the same command imports today's round. 320,000 gas." |
| 1:45 | Blockscout: PegGuard `CoverBought` | "A treasury bought cover: pay 50 CTC if this feed prints below the strike this week." |
| 2:00 | Terminal: `npm run pf -- claim --policy 0` | "The claim proves the breaching round and settles in one transaction. Nobody approves it." |
| 2:20 | Blockscout: `ClaimPaid`, holder balance delta | "Paid. The round decided, not an adjuster." |
| 2:35 | README "Limitations" | "What it does not do: prove state, prove freshness, or write back to Ethereum. It proves a round *happened* — which is exactly what a parametric claim needs. And you cannot buy cover for a depeg that already printed: cover always starts in the future. That is why the claim demo uses a live round." |
| 2:50 | Repo + Blockscout links | End. |

Rules: show real hashes; if something is cached or pre-recorded, say so on screen.

## 1. Demo video script (original plan, superseded by §1a)

| t | Screen | Say |
|---|---|---|
| 0:00 | Title card: "ProofFeed — Chainlink rounds on Creditcoin, verified by Attestcoin. PegGuard — depeg cover that pays by proof." | One sentence: "Every price here is a mainnet Chainlink transaction cryptographically verified on Creditcoin. No relayer, no admin key can insert a number." |
| 0:10 | Etherscan: USDC/USD aggregator, latest `AnswerUpdated` tx | "This is a real Chainlink round on Ethereum mainnet, updated minutes ago." |
| 0:25 | Terminal: `pf prove --feed USDC/USD --latest` | Narrate the surfaces as they print: attested height, proof fetched, dry-run true, `recordRound` sent. |
| 1:05 | Blockscout: the CC3 tx — logs `TransactionVerified` (from 0x…0FD2) and `RoundProven` | "The precompile verified inclusion and continuity; the contract decoded the log from the verified bytes." |
| 1:20 | `cast call adapter latestRoundData()` | "Any Creditcoin contract that speaks Chainlink's interface can read this now." |
| 1:35 | Blockscout: PegGuard `CoverBought` (bought earlier) | "A DAO bought cover: pay 50 CTC if USDC prints below $0.97 this week." |
| 1:50 | Branch H: `pf claim --policy 0 --tx <2023-03-11 tx>` / Branch L: `pf claim` with the ETH/USD breach tx | "The claim is a proof, not a request." |
| 2:20 | Blockscout: `ClaimPaid`; wallet balance delta | "Paid. Nobody approved it — the round did." |
| 2:35 | README: limitations section | "What it does not do: prove state, prove freshness, write back to Ethereum. It proves that a round happened — which is exactly what a claim needs." |
| 2:50 | Repo + Blockscout links | End. |

Rules: show real hashes; if something is cached/recorded, say so on screen.

## 2. README skeleton (repo root)

```
# ProofFeed + PegGuard
one-paragraph thesis (from docs/00)

Badges: Live on CC3 testnet · Blockscout registry · Blockscout PegGuard · Demo video · BUIDL CTC 2026 Fall (DeFi)

## The problem (3 sentences)      → docs/01 §1
## How it works (diagram)          → docs/02 §1 ASCII + mermaid
## Live deployment (table)         → addresses, verify links, every demo tx, gas, attestation lag
## Reproduce in 3 commands
   npm ci && (cd contracts && forge test)
   npm run pf -- prove --feed USDC/USD --latest
   npm run pf -- claim --policy <id> --tx <hash>
## Attestcoin Protocol integration
   - surfaces table (only ones doing real work on the default path; mark undocumented ones)
   - "Why recordRound instead of execute" (D-03)
   - "Remove Attestcoin and…" paragraph
## Security model                  → docs/02 §4 + invariants list
## Limitations (disclosed, not discovered)
   - Proves transaction history, not state; cannot prove latestRoundData or the absence of rounds.
   - Lower-bound feed: freshness not guaranteed; consumers must check updatedAt; selective proving bounded by deviation threshold.
   - One-directional; writability unavailable on testnet.
   - Feed registration is owner-managed (configuration, not data). Permissionless registration is future work.
   - Testnet CTC, unaudited, binary payout, no premium refunds.
   - Branch L only: the claim demo uses ETH/USD because depegs are rare; the code path is feed-agnostic.
## Tests                            → counts, coverage, fixture provenance
## Project structure
## License (MIT)
```

## 3. DoraHacks BUIDL page fields
- Title: `ProofFeed — Chainlink price rounds on Creditcoin, verified by Attestcoin (+ PegGuard depeg cover)`
- One-liner (≤ 140 chars): `Real Ethereum Chainlink rounds proven into Creditcoin by the Attestcoin Protocol; parametric depeg cover that pays by proof.`
- Track: DeFi. Tags: Attestcoin Protocol, Creditcoin, Chainlink, oracle, parametric insurance, stablecoin.
- Links: GitHub, video, Blockscout registry, Blockscout claim tx, optional web page.
- Description: paste README sections 1–5 (DoraHacks renders markdown).

## 4. Judge checklist (what we expect them to verify in 5 minutes)
1. Open the `recordRound` tx on Blockscout → see `TransactionVerified` from `0x…0FD2` and `RoundProven`.
2. Open Etherscan for the same mainnet tx → same `answer`/`roundId`/`updatedAt`.
3. Open the `ClaimPaid` tx → payout to holder, referencing a `roundId` that exists in the registry.
4. Read "Limitations" and find nothing over-claimed.
5. Run `forge test` → green, including the real-fixture decode test.

## 5. Pitch deck (optional, 6 slides max)
1 Problem · 2 Insight (a Chainlink round is a mainnet tx; Attestcoin proves mainnet txs) · 3 Architecture ·
4 Live evidence (Blockscout screenshots) · 5 Security & limitations · 6 What's next (bounties, permissionless registration, batch proofs, more feeds, CEIP ask).
