# 07 — Test Plan

Principles: Foundry tests never touch the network (NFR-04). Real-network behaviour is proven by CLI
runs whose tx hashes go into `docs/DEPLOYMENT.md`. Every test name says what it asserts. Tests that
exercise the **mock** verifier say `Mock` in their name (index41 convention — judges liked it).

## 1. Harness

- `BaseTest.t.sol`: deploys `MockNativeQueryVerifier`, `vm.etch(0x0FD2, code)`, deploys
  `ProvenFeedRegistry(owner)`, registers `USDC / USD` with `emitter = FIXTURE_EMITTER`, `chainKey = 3`,
  `phaseId = FIXTURE_PHASE`, `decimals = 8`. Helper `_loadFixture(name)` reads
  `test/fixtures/<name>.abi.hex` and `abi.decode`s into proof args.
- Fixture provenance: `usdc_usd_round_<block>.json` captured by `pf capture` from a **real mainnet tx**.
  The mock verifier returns `true`; the **decoder runs on the real bytes** — so decode logic is tested
  against reality even though verification is mocked.
- Synthetic tx builder (`test/utils/TxBytesBuilder.sol`): constructs `EvmV1` encoded bytes for a
  type-2 tx with arbitrary receipt logs, so we can craft negative cases (wrong emitter, wrong topics,
  failed receipt) without needing more real fixtures. Must match the encoder layout expected by
  `EvmV1Decoder.decodeReceiptFields` (check chunk structure in the library: `(uint8 txType, bytes[] chunks)` with 3 or 4 chunks; receipt is the last chunk). If building the encoder is > 2 h, fall back to mutating the real fixture bytes (e.g. flip the receipt status byte, patch the emitter address) using a small byte-patch helper — document which approach was used.

## 2. Registry tests (`ProvenFeedRegistry.t.sol`)

| ID | Test | Expect |
|---|---|---|
| T-R01 | `test_RegisterFeed_StoresMetadataAndMapping` | `feedOf(3, emitter) == feedId`; `getFeed` matches |
| T-R02 | `test_RegisterFeed_RevertsOnDuplicateEmitter` | `FeedExists` |
| T-R03 | `test_RegisterFeed_RevertsOnDecimalsMismatchAcrossPhases` | `FeedExists` |
| T-R04 | `test_RegisterFeed_OnlyOwner` | OZ `OwnableUnauthorizedAccount` |
| T-F01 | `test_RecordRound_RealMainnetFixture_DecodesAndStores` | `RoundProven` with the values printed by `pf capture`; `latestRoundData` equals them |
| T-R05 | `test_RecordRound_EmitsTransactionVerifiedFromMockVerifier` | log from `0x0FD2` present |
| T-R06 | `test_RecordRound_RevertsWhenMockVerifierReturnsFalse` | `"Proof of inclusion verification failed"` |
| T-R07 | `test_RecordRound_RevertsOnReplay` | second call → `"Query already processed"` |
| T-R08 | `test_RecordRound_RevertsWhenReceiptStatusZero` | `SourceTxFailed(0)` |
| T-R09 | `test_RecordRound_RevertsWhenNoRegisteredEmitter` | `NoMatchingLogs` |
| T-R10 | `test_RecordRound_SkipsUnregisteredLogButRecordsRegisteredOne` | one `RoundProven` |
| T-R11 | `test_RecordRound_RevertsWhenEmitterRegisteredForOtherChainKey` | register emitter under chainKey 1, prove with chainKey 3 → `NoMatchingLogs` (INV-03) |
| T-R12 | `test_LatestRoundId_IsMonotonic_OlderRoundDoesNotOverwrite` | prove round N then N-1 → latest stays N, both stored |
| T-R13 | `test_RecordRound_RevertsOnMalformedAnswerUpdatedLog` | `BadAnswerUpdatedLog` (topics != 3) |
| T-R14 | `test_InheritedExecute_AlwaysReverts` | `UseRecordRound` |
| T-R15 | `test_ComposeRoundId_MatchesChainlinkProxyConvention` | `(phase<<64)|agg` |
| T-R16 | `test_SetFeedActive_FalseCausesSkip` | deactivated emitter → `NoMatchingLogs` |

## 3. Adapter tests (`ProvenFeedAdapter.t.sol`)
| ID | Test |
|---|---|
| T-A01 | `test_LatestRoundData_RevertsBeforeAnyRound` → `NoRoundYet` |
| T-A02 | `test_LatestRoundData_ReturnsChainlinkShapedTuple` (roundId, answer, startedAt==updatedAt, updatedAt, answeredInRound==roundId) |
| T-A03 | `test_GetRoundData_UnknownRoundReverts` |

## 4. PegGuard tests (`PegGuard.t.sol`) — registry state is set by recording fixture/synthetic rounds

| ID | Test |
|---|---|
| T-P01 | `test_Deposit_MintsProportionalShares` |
| T-P02 | `test_Withdraw_RespectsLockedLiquidity` → `InsufficientLiquidity` |
| T-P03 | `test_Quote_Formula` (50 bps/30d, 30 days, 100 CTC → 0.5 CTC) |
| T-P04 | `test_BuyCover_LocksNotionalAndStoresPolicy` |
| T-P05 | `test_BuyCover_RevertsOnWrongPremium` |
| T-P06 | `test_BuyCover_RevertsOnInsufficientCapacity` |
| T-P07 | `test_Claim_PaysHolderWhenRoundBelowStrikeInsideWindow` (balance delta == notional; `ClaimPaid`) |
| T-P08 | `test_Claim_RevertsWhenRoundNotProven` |
| T-P09 | `test_Claim_RevertsWhenRoundBeforeStart` (waiting period) |
| T-P10 | `test_Claim_RevertsWhenRoundAfterExpiry` |
| T-P11 | `test_Claim_RevertsWhenAnswerNotBelowStrike` (equal → revert) |
| T-P12 | `test_Claim_CannotBeClaimedTwice` |
| T-P13 | `test_Claim_AnyoneCanCallPayoutGoesToHolder` (INV-09) |
| T-P14 | `test_ProveAndClaim_AtomicRevertLeavesNoRound` (mock verifier true, but round outside window → whole tx reverts, `getRound.exists == false`) |
| T-P15 | `test_Expire_UnlocksCapacityOnlyAfterExpiry` |
| T-P16 | `test_Invariant_LockedNeverExceedsBalance` (Foundry invariant test with handler: deposit/buy/claim/expire/withdraw) |

## 5. Security tests (`Security.t.sol`) — the ones judges will look for
| ID | Test |
|---|---|
| T-S01 | Fake aggregator: synthetic tx from an unregistered address with a perfect `AnswerUpdated` log → `NoMatchingLogs` |
| T-S02 | Cross-chain spoof: emitter registered on key 1, proof presented for key 3 → rejected |
| T-S03 | Replay across contracts: same proof accepted once per registry (queryId), second → revert |
| T-S04 | Owner cannot write a price: there is no function; assert via ABI introspection in a TS test (`cli/test/abi.test.ts`) that no registry function has an `int256` input except none |
| T-S05 | Reentrancy on `claim`/`withdraw` with a malicious holder contract → `ReentrancyGuardReentrantCall` |
| T-S06 | `recordRound` with > 64 `AnswerUpdated` logs → `TooManyLogs` |
| T-S07 | `aggregatorRoundId ≥ 2^64` → revert in `composeRoundId` |
| T-S08 | Pool: claim when `balance < notional` cannot happen (locked accounting) — invariant T-P16 covers |

## 6. CLI tests (`cli/test`, vitest or node:test)
- `chainlink.decodeAnswerUpdated` on a recorded real log → matches fixture.
- `roundId` composition equals `proxy.latestRoundData().roundId` semantics (recorded value).
- `toProofArgs` shape matches the `recordRound` ABI (encode with ethers Interface → no throw).
- Config loader fails fast on missing vars.

## 7. On-chain evidence (not tests, but required)
`docs/DEPLOYMENT.md` must contain: probe tx (Day 1), registry deploy + verify link, ≥1 `recordRound` tx
with gas, adapter `latestRoundData` output (cast call transcript), PegGuard deploy, `deposit`, `buyCover`,
`ClaimPaid` tx, measured attestation lag, prover host used, SDK/package versions.

## 8. Coverage target
`forge coverage` ≥ 90% lines on `src/` (excluding `ProbeASC`). Report the number in README.
