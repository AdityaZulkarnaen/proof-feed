# ProofFeed + PegGuard — START HERE

> Catatan untuk pemilik proyek (Bahasa Indonesia): semua dokumen ditulis dalam bahasa Inggris
> karena akan dibaca oleh Claude Code, juri hackathon, dan calon kontributor. Urutan baca ada di
> bawah. Salin `CLAUDE.md` ke root repo, dan folder `docs/` ke `docs/` di repo yang sama.

**Hackathon:** BUIDL CTC 2026 Fall (DoraHacks) — Creditcoin & Credit Labs. Deadline extended to
**2026-09-14 03:59 (check timezone on the DoraHacks page)**. Track: **DeFi**.

**Working name:** `proof-feed` (repo). Two deliverables inside it:

| Layer | Name | One sentence |
|---|---|---|
| Infrastructure | **ProofFeed** (`ProvenFeedRegistry` + `ProvenFeedAdapter`) | Any contract on Creditcoin can consume real Ethereum-mainnet Chainlink price rounds, each one verified by the Attestcoin Protocol, without Chainlink deploying on Creditcoin and without a trusted relayer. |
| Product | **PegGuard** | Parametric "price-below-strike" cover (flagship policy: stablecoin depeg). The policyholder claims by proving the Chainlink round that breached the strike; payout is automatic. |

**The one-line thesis for judges:** *Remove Attestcoin and this repository has no inputs. Every price
that reaches Creditcoin is a Chainlink `AnswerUpdated` event whose transaction was cryptographically
verified by the Block Prover precompile, never a number a backend asserted.*

## Reading order

1. `CLAUDE.md` (repo root) — non-negotiable rules for the agent. Read first, keep open.
2. `docs/01-PRD.md` — what we are building and why, scope, requirements with IDs (FR-*, NFR-*).
3. `docs/02-ARCHITECTURE.md` — components, data flow, trust model, invariants (INV-*).
4. `docs/03-CONTRACT-SPEC.md` — exact Solidity behaviour, storage, events, errors, validation.
5. `docs/04-RELAYER-CLI-SPEC.md` — TypeScript CLI/keeper: commands, exact SDK calls.
6. `docs/05-TECH-REFERENCE.md` — verified ground truth: addresses, chain keys, SDK signatures, Chainlink event layout. **If a fact is not in this file, do not assume it — verify it.**
7. `docs/06-IMPLEMENTATION-PLAN.md` — 7-day plan, Day-1 spike with GO/NO-GO gates, decision branches.
8. `docs/07-TEST-PLAN.md` — Foundry + CLI test strategy, fixtures from real proofs.
9. `docs/08-DEMO-SUBMISSION.md` — demo script, README skeleton for DoraHacks, judge checklist.
10. `docs/09-DECISIONS-AND-OPEN-QUESTIONS.md` — decisions already made (do not re-litigate) and open questions with the exact procedure to resolve each.
11. `docs/10-PENJELASAN-ID.md` — ringkasan Bahasa Indonesia untuk pemilik proyek (bukan untuk Claude Code).

## How to hand this to Claude Code

```
mkdir proof-feed && cd proof-feed && git init
cp <bundle>/CLAUDE.md .
cp -r <bundle>/docs ./docs
cp <bundle>/.env.example .
claude
```

First prompt to Claude Code (copy verbatim):

> Read CLAUDE.md, then docs/00-START-HERE.md through docs/09. Then execute
> docs/06-IMPLEMENTATION-PLAN.md **Day 1 — Spike** exactly as written, and stop at the GO/NO-GO
> gate. Print the gate table and wait for my decision before writing any product code.

## Ground rules that prevent miscommunication

- **Requirement IDs are the contract.** Every PR / commit message references the FR/INV/T IDs it
  implements. If something is not covered by an ID, ask before building it.
- **`docs/05-TECH-REFERENCE.md` is the only source of addresses and signatures.** Anything marked
  `[VERIFY]` there must be verified during the Day-1 spike and the result written back into the file.
- **Scope is frozen** to P0 items in the PRD until P0 is deployed and demoed on CC3 testnet. P1/P2 only
  after that.
- **No mocks in the demo path.** Mocks live only under `contracts/test/`. The demo uses the real
  prover, the real precompile, real Ethereum mainnet Chainlink transactions.
