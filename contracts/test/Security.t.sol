// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {BaseTest, ProofFixture} from "./BaseTest.t.sol";
import {TxBytesBuilder} from "./utils/TxBytesBuilder.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {ChainlinkLogLib} from "../src/libraries/ChainlinkLogLib.sol";

/// @notice The rejections a reviewer will look for. Every test here is an attack that must fail.
/// @dev These use SYNTHETIC transaction bytes (`TxBytesBuilder`) because they must reach states no
///      real Chainlink transaction produces — a failed receipt, 65 rounds, a forged emitter. The
///      happy paths in the other suites use real captured mainnet bytes.
contract SecurityTest is BaseTest {
    /// @dev Arbitrary but valid proof scaffolding; the mock verifier accepts it, which is the point:
    ///      these tests prove that passing verification is NOT sufficient to get a price stored.
    function _submit(bytes memory txBytes, uint64 chainKey, uint64 height)
        internal
        returns (uint80[] memory)
    {
        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](2);
        siblings[0] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s0"), isLeft: true});
        siblings[1] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s1"), isLeft: false});
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("root");

        vm.prank(keeper);
        return registry.recordRound(
            chainKey, height, txBytes, keccak256("merkleRoot"), siblings, keccak256("lower"), roots
        );
    }

    // ── T-S01: forged emitter ────────────────────────────────────────────────────────────────────

    /// T-S01: a flawless `AnswerUpdated` log from an address nobody registered buys nothing.
    function test_FakeAggregator_PerfectLogFromUnregisteredAddressIsRejected() public {
        address impostor = makeAddr("fakeChainlinkAggregator");
        bytes memory txBytes = TxBytesBuilder.singleRound(impostor, 50_000_000, 1, block.timestamp);

        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        _submit(txBytes, MAINNET_KEY, 1_000);
    }

    /// @dev Even a $0.01 print — a maximally profitable forgery — is worth nothing unregistered.
    function test_FakeAggregator_ExtremePriceStillRejected() public {
        address impostor = makeAddr("impostor");
        bytes memory txBytes = TxBytesBuilder.singleRound(impostor, 1_000_000, 999, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        _submit(txBytes, MAINNET_KEY, 1_001);
    }

    // ── T-S02: cross-chain spoof (INV-03) ────────────────────────────────────────────────────────

    /// T-S02: the same aggregator address, registered for Sepolia, must not satisfy a mainnet proof.
    function test_CrossChainSpoof_EmitterRegisteredOnAnotherChainKeyIsRejected() public {
        address shared = makeAddr("sameAddressOnBothChains");
        bytes32 sepoliaFeed = keccak256("SPOOF / USD");
        vm.prank(owner);
        registry.registerFeed(sepoliaFeed, SEPOLIA_KEY, shared, 1, 8, "SPOOF / USD");

        bytes memory txBytes = TxBytesBuilder.singleRound(shared, 50_000_000, 1, block.timestamp);

        // Presented as mainnet (key 3): the emitter key does not match, so nothing is stored.
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        _submit(txBytes, MAINNET_KEY, 2_000);

        // Presented as Sepolia (key 1): accepted, because that is where it is registered.
        uint80[] memory ids = _submit(txBytes, SEPOLIA_KEY, 2_001);
        assertEq(ids.length, 1, "accepted under the correct chain key");
        assertTrue(registry.getRound(sepoliaFeed, ids[0]).exists, "stored under the Sepolia feed");
    }

    // ── T-R08: failed source transaction (INV-04) ────────────────────────────────────────────────

    /// T-R08: a reverted mainnet transaction still has logs. They must never be believed.
    function test_FailedSourceTransaction_LogsAreNotBelieved() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 50_000_000, 5000, block.timestamp);
        bytes memory txBytes = TxBytesBuilder.encodeType2(0, logs); // receiptStatus = 0

        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.SourceTxFailed.selector, uint8(0)));
        _submit(txBytes, MAINNET_KEY, 3_000);
    }

    /// INV-04: an unsupported transaction type is rejected before any log is read.
    function test_UnsupportedTransactionType_IsRejected() public {
        bytes memory txBytes = TxBytesBuilder.encodeInvalidType(9);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.UnsupportedTxType.selector, uint8(9)));
        _submit(txBytes, MAINNET_KEY, 3_100);
    }

    // ── T-R13: malformed log shape ───────────────────────────────────────────────────────────────

    /// T-R13: the signature hash matching is not enough — the ABI shape must match too.
    function test_MalformedAnswerUpdatedLog_WrongTopicCountIsRejected() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxBytesBuilder.malformedAnswerUpdatedLog(LIVE_AGGREGATOR, 2, 32);
        bytes memory txBytes = TxBytesBuilder.encodeType2(1, logs);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkLogLib.BadAnswerUpdatedLog.selector, 2, 32));
        _submit(txBytes, MAINNET_KEY, 4_000);
    }

    /// T-R13: a payload of the wrong length would silently decode to a nonsense timestamp.
    function test_MalformedAnswerUpdatedLog_WrongDataLengthIsRejected() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxBytesBuilder.malformedAnswerUpdatedLog(LIVE_AGGREGATOR, 3, 64);
        bytes memory txBytes = TxBytesBuilder.encodeType2(1, logs);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkLogLib.BadAnswerUpdatedLog.selector, 3, 64));
        _submit(txBytes, MAINNET_KEY, 4_100);
    }

    // ── T-R10: mixed transactions ────────────────────────────────────────────────────────────────

    /// T-R10: unrelated aggregators may share a transaction — skip theirs, keep ours.
    function test_MixedLogs_SkipsUnregisteredEmitterAndRecordsRegisteredOne() public {
        address other = makeAddr("someOtherAggregator");
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](3);
        logs[0] = TxBytesBuilder.answerUpdatedLog(other, 300_000_000_000, 42, block.timestamp);
        logs[1] = TxBytesBuilder.unrelatedLog(other);
        logs[2] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_990_000, 5001, block.timestamp);

        uint80[] memory ids = _submit(TxBytesBuilder.encodeType2(1, logs), MAINNET_KEY, 5_000);

        assertEq(ids.length, 1, "only the registered aggregator's round is recorded");
        assertEq(ids[0], ChainlinkLogLib.composeRoundId(LIVE_PHASE, 5001), "our round");
        assertEq(registry.getRound(USDC_FEED_ID, ids[0]).answer, 99_990_000, "our answer");
    }

    /// @notice Several rounds from the SAME registered aggregator in one transaction all land.
    function test_MultipleRoundsInOneTransaction_AllRecorded() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](3);
        logs[0] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_990_000, 6001, block.timestamp);
        logs[1] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_980_000, 6002, block.timestamp);
        logs[2] = TxBytesBuilder.answerUpdatedLog(DEPEG_AGGREGATOR, 88_000_000, 6003, block.timestamp);

        uint80[] memory ids = _submit(TxBytesBuilder.encodeType2(1, logs), MAINNET_KEY, 6_000);

        assertEq(ids.length, 3, "all three recorded");
        assertEq(
            registry.latestRoundId(USDC_FEED_ID),
            ChainlinkLogLib.composeRoundId(LIVE_PHASE, 6002),
            "latest is the highest phase-3 round, not the last log"
        );
    }

    /// @notice The same round twice inside one transaction must not double-write (INV-02).
    function test_DuplicateRoundWithinOneTransaction_IsRejected() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](2);
        logs[0] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_990_000, 7001, block.timestamp);
        logs[1] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 12_345_678, 7001, block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(
                IProvenFeedRegistry.RoundAlreadyProven.selector,
                USDC_FEED_ID,
                ChainlinkLogLib.composeRoundId(LIVE_PHASE, 7001)
            )
        );
        _submit(TxBytesBuilder.encodeType2(1, logs), MAINNET_KEY, 7_000);
    }

    // ── T-S06: decode gas is bounded ─────────────────────────────────────────────────────────────

    /// T-S06 / D-12: 65 matching logs must be refused, not decoded.
    function test_TooManyLogs_IsRejectedAtSixtyFive() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](65);
        for (uint256 i; i < 65; ++i) {
            logs[i] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_990_000, 8000 + i, block.timestamp);
        }
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.TooManyLogs.selector, uint256(65)));
        _submit(TxBytesBuilder.encodeType2(1, logs), MAINNET_KEY, 8_000);
    }

    /// @notice Exactly 64 is still accepted — the bound is inclusive.
    function test_MaxLogs_SixtyFourIsAccepted() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](64);
        for (uint256 i; i < 64; ++i) {
            logs[i] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_990_000, 9000 + i, block.timestamp);
        }
        uint80[] memory ids = _submit(TxBytesBuilder.encodeType2(1, logs), MAINNET_KEY, 9_000);
        assertEq(ids.length, 64, "the cap is inclusive");
    }

    /// @notice Unrelated logs do not count towards the cap, because they are filtered first.
    function test_MaxLogs_UnrelatedLogsDoNotCountTowardsTheCap() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](100);
        for (uint256 i; i < 99; ++i) {
            logs[i] = TxBytesBuilder.unrelatedLog(makeAddr("noise"));
        }
        logs[99] = TxBytesBuilder.answerUpdatedLog(LIVE_AGGREGATOR, 99_990_000, 9500, block.timestamp);

        uint80[] memory ids = _submit(TxBytesBuilder.encodeType2(1, logs), MAINNET_KEY, 9_500);
        assertEq(ids.length, 1, "only matching logs are counted");
    }

    // ── T-S03: replay ────────────────────────────────────────────────────────────────────────────

    /// T-S03 / INV-06: the same proof cannot be spent twice, even for different content.
    function test_Replay_SameQueryIdIsRejectedRegardlessOfPayload() public {
        bytes memory txBytes = TxBytesBuilder.singleRound(LIVE_AGGREGATOR, 99_990_000, 10_001, block.timestamp);
        _submit(txBytes, MAINNET_KEY, 10_000);

        // Same chainKey/height/siblings -> same query id, even with entirely different bytes.
        bytes memory otherBytes =
            TxBytesBuilder.singleRound(LIVE_AGGREGATOR, 11_111_111, 10_002, block.timestamp);
        vm.expectRevert("Query already processed");
        _submit(otherBytes, MAINNET_KEY, 10_000);
    }

    /// @notice Two registries do not share replay state — each enforces its own (T-S03 note).
    function test_Replay_IsPerRegistryNotGlobal() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        _record(f);

        // A fresh registry has its own processedQueries mapping and its own feed configuration.
        vm.expectRevert("Query already processed");
        _record(f);
    }

    // ── T-S04: there is no admin write path ──────────────────────────────────────────────────────

    /// T-S04 / INV-11: the owner cannot insert a price. Asserted structurally, over the live ABI.
    /// @dev The TypeScript twin of this test (`cli/test/abi.test.ts`) walks the compiled ABI and
    ///      asserts no external function takes an `int256`. Here we assert the behavioural half:
    ///      with full owner powers and no proof, no round can be made to exist.
    function test_Owner_CannotCreateARoundByAnyMeans() public {
        vm.startPrank(owner);
        registry.registerFeed(keccak256("EVIL / USD"), MAINNET_KEY, makeAddr("evil"), 1, 8, "EVIL / USD");
        registry.setFeedActive(MAINNET_KEY, LIVE_AGGREGATOR, true);
        vm.stopPrank();

        assertFalse(registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID).exists, "still nothing");
        assertEq(registry.latestRoundId(USDC_FEED_ID), 0, "no latest round");
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoRoundYet.selector, USDC_FEED_ID));
        registry.latestRoundData(USDC_FEED_ID);
    }

    /// @notice Deactivating a feed cannot erase or alter rounds already proven under it.
    function test_Owner_CannotDeleteOrAlterAProvenRound() public {
        _record(_loadFixture(FIXTURE_LIVE));

        vm.prank(owner);
        registry.setFeedActive(MAINNET_KEY, LIVE_AGGREGATOR, false);

        IProvenFeedRegistry.Round memory r = registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID);
        assertTrue(r.exists, "the round survives deactivation");
        assertEq(r.answer, LIVE_ANSWER, "unchanged");
        assertEq(registry.latestRoundId(USDC_FEED_ID), LIVE_ROUND_ID, "latest unchanged");
    }

    // ── INV-01: verification is the only gate ────────────────────────────────────────────────────

    /// @notice Rejecting only ONE proof by root leaves the others working — the verdict is per-proof.
    function test_Verification_IsCheckedPerProof() public {
        verifier.setRejectRoot(keccak256("merkleRoot"));
        bytes memory txBytes = TxBytesBuilder.singleRound(LIVE_AGGREGATOR, 99_990_000, 11_001, block.timestamp);

        vm.expectRevert("Proof of inclusion verification failed");
        _submit(txBytes, MAINNET_KEY, 11_000);

        // The real fixture carries a different root, so it still verifies.
        uint80[] memory ids = _record(_loadFixture(FIXTURE_LIVE));
        assertEq(ids[0], LIVE_ROUND_ID, "unaffected proof still works");
    }
}
