# 06 — Implementation Plan (7 days, 2026-09-07 → 2026-09-13)

Deadline 2026-09-14 03:59 (verify timezone). **Submit on 2026-09-13**, not at the last hour.

## Day 1 (Mon 09-07) — Setup + Spike + GO/NO-GO

### Setup (≤ 2 h)
- [ ] Repo skeleton exactly as CLAUDE.md. `npm i @gluwa/asc-contracts@0.2.1 @openzeppelin/contracts@5 @gluwa/usc-sdk@0.18.0 ethers@6 dotenv tsx typescript`. `forge install foundry-rs/forge-std`.
- [ ] `forge build` with an empty contract importing `ASCBase` + `EvmV1Decoder` compiles (checks remappings, solc 0.8.30, via_ir).
- [ ] Testnet wallet funded from faucet; record address in `docs/DEPLOYMENT.md`.
- [ ] `.env` filled; `pf` runs `--help`.

### Spike (`pf spike`, see docs/04 §3) — gates

| Gate | Check | Pass criterion | If fail |
|---|---|---|---|
| G1 | prover health + `getSupportedChainByKey(3).chainId == 1` | true | try candidate B URL; if still failing, Branch S (Sepolia key 1) |
| G2 | attestation lag for key 3 | < 120 min behind mainnet head | still OK if < 6 h; else Branch S |
| G3a | ≥1 `AnswerUpdated` log from current USDC/USD aggregator in last 20k blocks | ≥1 | see docs/09 Q2 (`NewTransmission` path) |
| G3b | `getProof(tx)` succeeds and `verifySingle` dry-run == true | true | inspect error body; retry with an older tx (≥ 2 h old); escalate on Discord |
| G4 | `ProbeASC.execute` on CC3 emits `TransactionVerified` + `Probe` | tx status 1 | gas > 5M → investigate decode loop; otherwise escalate |
| G5 | `getAttestationGenesisHeight(3)` ≤ depeg block (~16.8M) | → **Branch H** | else **Branch L** (default assumption) |

**Deliverables:** `docs/spike-output.json`, `docs/DEPLOYMENT.md` (probe address + tx), branch decision
written into docs/09 D-05. Gas of one `ProbeASC.execute` recorded (first estimate for `recordRound`).

**STOP RULE:** if G3b fails for both chain keys after 3 h of trying → post in `#buidl-ctc-qna` with the
exact request/response, and pause product code until a reply or a workaround (local proof path via
`proofProvider.raw.RawProofBuilder`, which index41 showed takes ~3 min per proof).

## Day 2 (Tue 09-08) — Registry on testnet, first real round proven (Milestone M1)

- [ ] `ChainlinkLogLib`, `IProvenFeedRegistry`, `ProvenFeedRegistry` per docs/03 (recordRound design, D-03).
- [ ] `MockNativeQueryVerifier`; unit tests T-R01…T-R12 (docs/07) green.
- [ ] `pf capture` of the G3 tx → `contracts/test/fixtures/usdc_usd_round_<block>.json`; fixture decode test T-F01 green (**real mainnet bytes decoded in Foundry**).
- [ ] `pf register` (P1 FR-21 pulled into P0 if it takes < 1 h) or manual `registerFeed` with args printed by `resolveFeed`.
- [ ] Deploy registry to CC3, source-verify on Blockscout.
- [ ] `pf prove --feed USDC/USD --latest` → **RoundProven on Blockscout**. Record gas, links.
- [ ] `ProvenFeedAdapter` deployed; `cast call adapter latestRoundData()` returns the real round.

**Acceptance:** README section "Live deployment" can already list registry, adapter, and one proven round tx.

## Day 3 (Wed 09-09) — PegGuard

- [ ] `PegGuard` per docs/03 §5; tests T-P01…T-P14 green (incl. claim-window and strike logic with a fixture-driven registry state).
- [ ] Deploy; `configurePool(USDC/USD, 50 bps, waitingPeriod=0 for demo, maxNotional=100 CTC)`; `deposit` 200 CTC; `buyCover` 50 CTC notional, strike 0.97, 7 days → `CoverBought` on Blockscout.
- [ ] Branch H prep: enumerate `phaseAggregators`, locate the 2023-03-11 min-price `AnswerUpdated` tx, `pf capture` it; **attempt `getProof`** (this is the real test of Branch H). If proof fails → switch to Branch L today.
- [ ] Branch L prep: register ETH/USD (chain key 3); `configurePool(ETH/USD)`; buy a policy with `strike = current price + 0.3%` and 2-day duration; start `pf watch --feed ETH/USD` in a tmux session and let it prove every round (this also produces the "keeper" evidence).

## Day 4 (Thu 09-10) — Claim paid (Milestone M2) + CLI completeness

- [ ] `pf claim` / `proveAndClaim` executed on testnet → **ClaimPaid on Blockscout** with holder balance delta.
- [ ] `pf watch` stable for ≥ 6 h (log excerpt saved to `docs/watch-log.txt`).
- [ ] `pf demo --branch <chosen>` runs end-to-end from a clean shell with only `.env`.
- [ ] Security tests T-S01…T-S08 green (unregistered emitter, wrong chain key, failed receipt, replay, double claim, window, strike, withdraw-locked).

## Day 5 (Fri 09-11) — Hardening + docs

**Done ahead of schedule on 2026-09-09**, along with all of P1 and two thirds of P2.

- [x] Gas table (recordRound, recordRoundBatch, proveAndClaim, claim, buyCover ×2, withdrawBounty) in README from real receipts.
- [x] `docs/DEPLOYMENT.md` complete: every address, every demo tx, attestation lag measured, prover host used.
- [x] README per docs/08 skeleton, including limitations and "Why recordRound instead of execute".
- [x] P1: USDT/USD registered and proven (FR-22); prover bounty (FR-20) shipped with tests and an on-chain lifecycle.
- [x] `web/` page (FR-23): reads registry + PegGuard via RPC; labels live vs cached.
- [x] P2: proportional payout (FR-30) and batch proving (FR-32) shipped; FR-31 researched and
      closed with evidence (D-14). See `docs/DEPLOYMENT.md` §P2.

Remaining, and all of it needs a human: record the video, fill the DoraHacks page, make the repo
public, deploy `web/` to Vercel (root directory `web`), and look at the landing page in a browser.

## Day 6 (Sat 09-12) — Demo video + submission draft

- [ ] Record ≤ 3 min video following `docs/DEMO-CHECKLIST.md` (docs/08 §1a now points there). Show Blockscout, not slides.
- [ ] DoraHacks BUIDL page filled: title, one-liner, track DeFi, GitHub, video, deck (optional 6 slides), live links.
- [ ] Fresh-clone test: `git clone && npm ci && forge test` passes; `pf prove --latest` works with a fresh wallet.

## Day 7 (Sun 09-13) — Buffer + submit

- [ ] Submit by 20:00 local. Re-run `pf prove --latest` once more so the newest proven round is < 24 h old at judging time.
- [ ] Post the submission link in Discord `#buidl-ctc-qna` (visibility).

## Cut list (in order, if behind schedule)
1. `web/` page → replace with README screenshots of Blockscout.
2. `pf watch` → replace with manual `pf prove` runs (keep FR-14 code but mark experimental).
3. `ProvenFeedAdapter` → keep contract, skip deployment (do NOT cut: it is 40 lines and it is the infra story). Cut only the adapter *tests* beyond T-A01/T-A02.
4. Multiple feeds → one feed (USDC/USD) + ETH/USD only if Branch L.
Never cut: on-chain proven mainnet round, claim paid on testnet, security tests, limitations section.
