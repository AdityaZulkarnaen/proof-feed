// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {BaseTest, ProofFixture} from "./BaseTest.t.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";

/// @title RecordRoundBatchTest
/// @notice FR-32 — several proven transactions sharing ONE continuity proof.
/// @dev The saving is real and was measured against the live prover before this was written: a
///      batch of three ETH/USD rounds spanning mainnet blocks 25,937,610 → 25,938,000 came back
///      from `/api/v1/proof-batch-by-tx` as a single continuity proof of 391 roots plus one Merkle
///      proof each, and `0xFD2.verify(batch)` accepted it. These tests cover what the contract adds
///      on top of that verdict: per-element replay protection, all-or-nothing semantics, the
///      argument-shape guards, and that decoding is identical to the single-proof path.
contract RecordRoundBatchTest is BaseTest {
    /// @dev The two real mainnet fixtures, batched. Distinct blocks, distinct query ids.
    function _twoFixtures() internal view returns (ProofFixture[] memory fs) {
        fs = new ProofFixture[](2);
        fs[0] = _loadFixture(FIXTURE_DEPEG);
        fs[1] = _loadFixture(FIXTURE_LIVE);
    }

    // ── T-B01 · the happy path ───────────────────────────────────────────────────────────────────

    /// T-B01: one call stores every round in the batch.
    function test_RecordRoundBatch_StoresEveryRound() public {
        uint80[] memory ids = _recordBatch(_twoFixtures());

        assertEq(ids.length, 2, "two rounds stored");
        assertEq(ids[0], DEPEG_ROUND_ID, "batch order preserved: element 0 first");
        assertEq(ids[1], LIVE_ROUND_ID, "batch order preserved: element 1 second");

        IProvenFeedRegistry.Round memory depeg = registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID);
        assertTrue(depeg.exists, "depeg round stored");
        assertEq(depeg.answer, DEPEG_ANSWER, "$0.88 decoded from the batched bytes");
        assertEq(depeg.updatedAt, DEPEG_UPDATED_AT);
        assertEq(depeg.prover, keeper, "prover is the batch submitter");

        IProvenFeedRegistry.Round memory live = registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID);
        assertTrue(live.exists, "live round stored");
        assertEq(live.answer, LIVE_ANSWER);
    }

    /// T-B02: the precompile is called ONCE for the whole batch — that is the entire point.
    function test_RecordRoundBatch_CallsThePrecompileOnceForTheWholeBatch() public {
        _recordBatch(_twoFixtures());

        assertEq(verifier.verifyAndEmitBatchCalls(), 1, "one batch verification");
        assertEq(verifier.lastBatchSize(), 2, "covering both transactions");
        assertEq(verifier.verifyAndEmitCalls(), 0, "the single-proof overload was never used");
    }

    /// T-B03: `latestRoundId` still moves only forward, even when the batch is out of order.
    /// @dev Element 0 is the 2023 depeg (lower round id), element 1 is the 2026 live round. The
    ///      older round is stored but must not become the latest.
    function test_RecordRoundBatch_LatestRoundIsStillMonotonic() public {
        _recordBatch(_twoFixtures());
        assertEq(registry.latestRoundId(USDC_FEED_ID), LIVE_ROUND_ID, "the newer round wins");

        (uint80 roundId, int256 answer,,) = registry.latestRoundData(USDC_FEED_ID);
        assertEq(roundId, LIVE_ROUND_ID);
        assertEq(answer, LIVE_ANSWER);
    }

    /// T-B04: each element emits its own `TransactionVerified` from the precompile address.
    function test_RecordRoundBatch_EmitsTransactionVerifiedPerElement() public {
        ProofFixture[] memory fs = _twoFixtures();
        vm.recordLogs();
        _recordBatch(fs);

        uint256 verified;
        bytes32 sig = keccak256("TransactionVerified(uint64,uint64,uint64)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == VERIFIER_ADDR && logs[i].topics[0] == sig) ++verified;
        }
        assertEq(verified, 2, "one TransactionVerified per proven transaction");
    }

    // ── T-B05..T-B07 · replay protection ─────────────────────────────────────────────────────────

    /// T-B05: a batch cannot contain the same transaction twice.
    function test_RecordRoundBatch_RevertsOnDuplicateInsideTheBatch() public {
        ProofFixture[] memory fs = new ProofFixture[](2);
        fs[0] = _loadFixture(FIXTURE_LIVE);
        fs[1] = _loadFixture(FIXTURE_LIVE);

        vm.expectRevert("Query already processed");
        _recordBatch(fs);
    }

    /// T-B06: a batch cannot re-prove a round already proven by the single-proof path.
    function test_RecordRoundBatch_RevertsWhenAnElementWasAlreadyProvenSingly() public {
        _record(_loadFixture(FIXTURE_LIVE));

        vm.expectRevert("Query already processed");
        _recordBatch(_twoFixtures());
    }

    /// T-B07: and the reverse — the single path rejects what a batch already consumed.
    function test_RecordRound_RevertsAfterTheQueryWasConsumedByABatch() public {
        _recordBatch(_twoFixtures());

        vm.expectRevert("Query already processed");
        _record(_loadFixture(FIXTURE_LIVE));
    }

    // ── T-B08..T-B10 · all-or-nothing ────────────────────────────────────────────────────────────

    /// T-B08: a false verdict stores nothing, not even the elements that would have decoded.
    function test_RecordRoundBatch_RevertsAndStoresNothingWhenVerdictIsFalse() public {
        verifier.setResult(false);

        vm.expectRevert("Proof of inclusion verification failed");
        _recordBatch(_twoFixtures());

        assertFalse(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).exists, "nothing stored");
        assertFalse(registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID).exists, "nothing stored");
        assertEq(registry.latestRoundId(USDC_FEED_ID), 0, "latest untouched");
    }

    /// T-B09: one bad element poisons the whole batch — the good one is not kept.
    /// @dev This is the property that makes batching safe to offer at all: there is no partial
    ///      success in which an unverified round could survive alongside verified ones.
    function test_RecordRoundBatch_OneRejectedElementDiscardsTheEntireBatch() public {
        ProofFixture[] memory fs = _twoFixtures();
        // Reject only the second element's proof.
        verifier.setRejectRoot(fs[1].merkleRoot);

        vm.expectRevert("Proof of inclusion verification failed");
        _recordBatch(fs);

        assertFalse(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).exists, "good element discarded too");
    }

    /// T-B10: the replay marks are rolled back with everything else, so a retry still works.
    function test_RecordRoundBatch_FailedBatchDoesNotBurnTheQueryIds() public {
        verifier.setResult(false);
        vm.expectRevert("Proof of inclusion verification failed");
        _recordBatch(_twoFixtures());

        verifier.setResult(true);
        uint80[] memory ids = _recordBatch(_twoFixtures());
        assertEq(ids.length, 2, "the same batch succeeds once the proof verifies");
    }

    // ── T-B11..T-B14 · argument-shape guards ─────────────────────────────────────────────────────

    /// T-B11: an empty batch is rejected before any work is done.
    function test_RecordRoundBatch_RevertsOnEmptyBatch() public {
        vm.prank(keeper);
        vm.expectRevert(IProvenFeedRegistry.EmptyBatch.selector);
        registry.recordRoundBatch(
            MAINNET_KEY,
            new uint64[](0),
            new bytes[](0),
            new INativeQueryVerifier.MerkleProof[](0),
            bytes32(0),
            new bytes32[](0)
        );
    }

    /// T-B12: batch size is capped so a caller cannot burn a whole block before reverting.
    function test_RecordRoundBatch_RevertsAboveMaxBatch() public {
        uint256 n = registry.MAX_BATCH() + 1;
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.BatchTooLarge.selector, n));
        registry.recordRoundBatch(
            MAINNET_KEY,
            new uint64[](n),
            new bytes[](n),
            new INativeQueryVerifier.MerkleProof[](n),
            bytes32(0),
            new bytes32[](0)
        );
    }

    /// T-B13: the parallel arrays must line up, or an element would be proven against another's proof.
    function test_RecordRoundBatch_RevertsOnLengthMismatch() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.BatchLengthMismatch.selector, 2, 1, 2));
        registry.recordRoundBatch(
            MAINNET_KEY,
            new uint64[](2),
            new bytes[](1),
            new INativeQueryVerifier.MerkleProof[](2),
            bytes32(0),
            new bytes32[](0)
        );
    }

    /// T-B14: a single-element batch behaves exactly like `recordRound`.
    function test_RecordRoundBatch_SingleElementMatchesTheSinglePath() public {
        ProofFixture[] memory fs = new ProofFixture[](1);
        fs[0] = _loadFixture(FIXTURE_DEPEG);

        uint80[] memory ids = _recordBatch(fs);
        assertEq(ids.length, 1);
        assertEq(ids[0], DEPEG_ROUND_ID);
        assertEq(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).answer, DEPEG_ANSWER);
    }

    // ── T-B15..T-B16 · the security checks are not weakened by batching ──────────────────────────

    /// T-B15: INV-03 still holds inside a batch — a mainnet emitter proven under Sepolia's key is
    /// not a registered emitter, so nothing decodes and the whole batch reverts.
    function test_RecordRoundBatch_RejectsWrongChainKey() public {
        ProofFixture[] memory fs = _twoFixtures();
        (
            uint64[] memory heights,
            bytes[] memory txs,
            INativeQueryVerifier.MerkleProof[] memory proofs
        ) = _batchArgs(fs);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        registry.recordRoundBatch(
            SEPOLIA_KEY, heights, txs, proofs, fs[0].lowerEndpointDigest, fs[0].continuityRoots
        );
    }

    /// T-B16: deactivating an emitter blocks it in a batch exactly as it does singly (INV-07).
    function test_RecordRoundBatch_RejectsDeactivatedEmitter() public {
        vm.prank(owner);
        registry.setFeedActive(MAINNET_KEY, DEPEG_AGGREGATOR, false);

        ProofFixture[] memory fs = new ProofFixture[](1);
        fs[0] = _loadFixture(FIXTURE_DEPEG);

        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        _recordBatch(fs);
    }
}
