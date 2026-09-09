// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {BaseTest, ProofFixture} from "./BaseTest.t.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {ProvenFeedRegistry} from "../src/ProvenFeedRegistry.sol";
import {ChainlinkLogLib} from "../src/libraries/ChainlinkLogLib.sol";

/// @notice Registry behaviour: registration, the proven-round path, and the invariants around it.
///         Tests whose name contains `Mock` depend on the mocked verifier verdict; the rest run the
///         real decoder over real Ethereum mainnet bytes.
contract ProvenFeedRegistryTest is BaseTest {
    // ── T-R01…T-R04: registration ────────────────────────────────────────────────────────────────

    /// T-R01
    function test_RegisterFeed_StoresMetadataAndMapping() public view {
        assertEq(registry.feedOf(MAINNET_KEY, LIVE_AGGREGATOR), USDC_FEED_ID, "live emitter maps to feed");
        assertEq(registry.feedOf(MAINNET_KEY, DEPEG_AGGREGATOR), USDC_FEED_ID, "depeg emitter maps to feed");

        IProvenFeedRegistry.Feed memory canonical = registry.getFeed(USDC_FEED_ID);
        assertEq(canonical.decimals, USDC_DECIMALS, "canonical decimals");
        assertEq(canonical.description, USDC_DESCRIPTION, "canonical description");
        assertEq(canonical.emitter, LIVE_AGGREGATOR, "canonical emitter is the first registered");
        assertTrue(canonical.active, "canonical active");

        IProvenFeedRegistry.Feed memory perEmitter = registry.getEmitterFeed(MAINNET_KEY, DEPEG_AGGREGATOR);
        assertEq(perEmitter.phaseId, DEPEG_PHASE, "per-emitter phase is its own, not the canonical one");
        assertEq(perEmitter.chainKey, MAINNET_KEY, "per-emitter chain key");
    }

    /// T-R01: the feed id is derivable by anyone from the proxy's description string.
    function test_FeedId_IsKeccakOfExactDescriptionString() public pure {
        assertEq(keccak256(bytes(USDC_DESCRIPTION)), USDC_FEED_ID, "feedId = keccak256(description)");
    }

    /// T-R02
    function test_RegisterFeed_RevertsOnDuplicateEmitter() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IProvenFeedRegistry.FeedExists.selector, USDC_FEED_ID, LIVE_AGGREGATOR)
        );
        registry.registerFeed(
            USDC_FEED_ID, MAINNET_KEY, LIVE_AGGREGATOR, LIVE_PHASE, USDC_DECIMALS, USDC_DESCRIPTION
        );
    }

    /// T-R17: a zero feed id is not a feed. Branch coverage found this guard untested.
    function test_RegisterFeed_RevertsOnZeroFeedId() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.UnknownFeed.selector, bytes32(0)));
        registry.registerFeed(
            bytes32(0), MAINNET_KEY, makeAddr("agg"), 1, USDC_DECIMALS, USDC_DESCRIPTION
        );
    }

    /// T-R03: mixing decimals across phases would silently corrupt every consumer's maths.
    function test_RegisterFeed_RevertsOnDecimalsMismatchAcrossPhases() public {
        address otherPhase = makeAddr("phase4Aggregator");
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IProvenFeedRegistry.FeedExists.selector, USDC_FEED_ID, otherPhase)
        );
        registry.registerFeed(USDC_FEED_ID, MAINNET_KEY, otherPhase, 4, 18, USDC_DESCRIPTION);
    }

    /// T-R04
    function test_RegisterFeed_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.registerFeed(USDC_FEED_ID, MAINNET_KEY, makeAddr("x"), 9, USDC_DECIMALS, USDC_DESCRIPTION);
    }

    function test_RegisterFeed_RevertsOnZeroEmitter() public {
        vm.prank(owner);
        vm.expectRevert(IProvenFeedRegistry.ZeroAddress.selector);
        registry.registerFeed(USDC_FEED_ID, MAINNET_KEY, address(0), 9, USDC_DECIMALS, USDC_DESCRIPTION);
    }

    /// @dev The constructor's own `if (initialOwner == address(0)) revert ZeroAddress()` is
    ///      **unreachable**: `Ownable` runs first and rejects the zero owner before that body
    ///      executes, which is why this expects OZ's error and not ours. Branch coverage proved the
    ///      line dead. It stays in the deployed source on purpose — `bytecode_hash` is at its
    ///      default, so editing it would change the bytecode and break the Blockscout verification
    ///      the whole project rests on (README, Tests).
    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ProvenFeedRegistry(address(0));
    }

    // ── T-F01: the real mainnet fixtures ─────────────────────────────────────────────────────────

    /// T-F01: a REAL Ethereum mainnet Chainlink transaction, decoded on-chain by `EvmV1Decoder`.
    function test_RecordRound_RealMainnetFixture_DecodesAndStores() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        assertEq(f.chainKey, MAINNET_KEY, "fixture is a mainnet proof");
        assertEq(f.blockHeight, 25_924_144, "fixture block height");

        vm.expectEmit(true, true, false, true, address(registry));
        emit IProvenFeedRegistry.RoundProven(
            USDC_FEED_ID, LIVE_ROUND_ID, LIVE_ANSWER, LIVE_UPDATED_AT, _queryIdOf(f), keeper
        );
        uint80[] memory ids = _record(f);

        assertEq(ids.length, 1, "exactly one round in this transaction");
        assertEq(ids[0], LIVE_ROUND_ID, "proxy round id");

        IProvenFeedRegistry.Round memory r = registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID);
        assertTrue(r.exists, "round stored");
        assertEq(r.answer, LIVE_ANSWER, "answer decoded from the verified bytes");
        assertEq(r.updatedAt, LIVE_UPDATED_AT, "Chainlink's own timestamp");
        assertEq(r.provenAt, uint64(block.timestamp), "Creditcoin's timestamp");
        assertEq(r.prover, keeper, "whoever paid the gas");

        (uint80 roundId, int256 answer, uint64 updatedAt,) = registry.latestRoundData(USDC_FEED_ID);
        assertEq(roundId, LIVE_ROUND_ID, "latest round id");
        assertEq(answer, LIVE_ANSWER, "latest answer");
        assertEq(updatedAt, LIVE_UPDATED_AT, "latest updatedAt");
    }

    /// T-F01 (Branch H): the actual 2023-03-11 USDC depeg round, proven from real mainnet bytes.
    function test_RecordRound_RealDepegFixture_Decodes088() public {
        ProofFixture memory f = _loadFixture(FIXTURE_DEPEG);
        assertEq(f.blockHeight, 16_803_472, "depeg block height");
        assertEq(f.continuityRoots.length, 529, "deep history needs a long continuity proof");

        uint80[] memory ids = _record(f);
        assertEq(ids.length, 1, "one round");
        assertEq(ids[0], DEPEG_ROUND_ID, "phase-2 proxy round id");

        IProvenFeedRegistry.Round memory r = registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID);
        assertEq(r.answer, DEPEG_ANSWER, "USDC printed $0.88 during the SVB depeg");
        assertEq(r.updatedAt, DEPEG_UPDATED_AT, "2023-03-11T07:51:23Z");
        assertLt(r.answer, int256(97_000_000), "below a 0.97 strike - this is what PegGuard pays on");
    }

    /// T-R15: the round id packing matches what the live proxy reports (verified Day 1).
    function test_ComposeRoundId_MatchesChainlinkProxyConvention() public pure {
        assertEq(ChainlinkLogLib.composeRoundId(LIVE_PHASE, LIVE_AGG_ROUND), LIVE_ROUND_ID, "live");
        assertEq(ChainlinkLogLib.composeRoundId(DEPEG_PHASE, DEPEG_AGG_ROUND), DEPEG_ROUND_ID, "depeg");

        (uint16 phase, uint64 aggRound) = ChainlinkLogLib.decomposeRoundId(LIVE_ROUND_ID);
        assertEq(phase, LIVE_PHASE, "phase round-trips");
        assertEq(aggRound, uint64(LIVE_AGG_ROUND), "aggregator round round-trips");
    }

    /// T-S07
    function test_ComposeRoundId_RevertsWhenAggregatorRoundExceeds64Bits() public {
        uint256 tooLarge = uint256(1) << 64;
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkLogLib.AggregatorRoundIdTooLarge.selector, tooLarge)
        );
        this.exposedComposeRoundId(1, tooLarge);
    }

    /// @dev External wrapper so `vm.expectRevert` sees a call boundary.
    function exposedComposeRoundId(uint16 phaseId, uint256 aggRound) external pure returns (uint80) {
        return ChainlinkLogLib.composeRoundId(phaseId, aggRound);
    }

    // ── T-R05…T-R07: the verification path ───────────────────────────────────────────────────────

    /// T-R05: the precompile really is called — its event must appear in the same transaction.
    function test_RecordRound_EmitsTransactionVerifiedFromMockVerifier() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        vm.expectEmit(true, true, false, true, VERIFIER_ADDR);
        emit INativeQueryVerifier.TransactionVerified(
            MAINNET_KEY, f.blockHeight, verifier.calculateTxIndex(_merkleProof(f))
        );
        _record(f);
        assertEq(verifier.verifyAndEmitCalls(), 1, "verifyAndEmit called exactly once");
    }

    /// T-R06: no verdict, no round. This is INV-01.
    function test_RecordRound_RevertsWhenMockVerifierReturnsFalse() public {
        verifier.setResult(false);
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        vm.expectRevert("Proof of inclusion verification failed");
        _record(f);
        assertFalse(registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID).exists, "nothing stored");
    }

    /// T-R07 / T-S03 / INV-06
    function test_RecordRound_RevertsOnReplay() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        _record(f);
        vm.expectRevert("Query already processed");
        _record(f);
    }

    /// INV-02: even via a fresh query id, the same round cannot be stored twice.
    function test_RecordRound_RevertsWhenSameRoundArrivesUnderNewQueryId() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        _record(f);
        // A different query id means replay protection does not fire; the per-round guard must.
        vm.expectRevert(
            abi.encodeWithSelector(
                IProvenFeedRegistry.RoundAlreadyProven.selector, USDC_FEED_ID, LIVE_ROUND_ID
            )
        );
        _record(_withDifferentQueryId(_loadFixture(FIXTURE_LIVE)));
    }

    // ── T-R09…T-R11, T-R16: the emitter check ────────────────────────────────────────────────────

    /// T-R09 / T-S01: a perfectly formed log from an address nobody registered is worthless.
    function test_RecordRound_RevertsWhenNoRegisteredEmitter() public {
        ProvenFeedRegistry empty = new ProvenFeedRegistry(owner);
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        empty.recordRound(
            f.chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );
    }

    /// T-R11 / T-S02 / INV-03: this is the whole reason `recordRound` exists instead of `execute`.
    function test_RecordRound_RevertsWhenEmitterRegisteredForOtherChainKey() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        // The aggregator is registered for mainnet (key 3) only. Present the same proof as Sepolia.
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        _recordAs(f, SEPOLIA_KEY);
        assertFalse(registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID).exists, "nothing stored");
    }

    /// T-R16
    function test_SetFeedActive_FalseCausesSkip() public {
        vm.prank(owner);
        registry.setFeedActive(MAINNET_KEY, LIVE_AGGREGATOR, false);

        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoMatchingLogs.selector, 1));
        _record(f);
    }

    function test_SetFeedActive_ReenablesRecording() public {
        vm.startPrank(owner);
        registry.setFeedActive(MAINNET_KEY, LIVE_AGGREGATOR, false);
        registry.setFeedActive(MAINNET_KEY, LIVE_AGGREGATOR, true);
        vm.stopPrank();
        uint80[] memory ids = _record(_loadFixture(FIXTURE_LIVE));
        assertEq(ids[0], LIVE_ROUND_ID, "recording works again");
    }

    function test_SetFeedActive_RevertsForUnknownEmitter() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.UnknownFeed.selector, bytes32(0)));
        registry.setFeedActive(MAINNET_KEY, makeAddr("nobody"), true);
    }

    function test_SetFeedActive_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setFeedActive(MAINNET_KEY, LIVE_AGGREGATOR, false);
    }

    // ── T-R12: monotonic latest ──────────────────────────────────────────────────────────────────

    /// T-R12 / INV-05: an older round is still stored, but it must not become "latest".
    function test_LatestRoundId_IsMonotonic_OlderRoundDoesNotOverwrite() public {
        _record(_loadFixture(FIXTURE_LIVE)); // phase 3, round 1178 — the higher id
        assertEq(registry.latestRoundId(USDC_FEED_ID), LIVE_ROUND_ID, "latest after the newer round");

        _record(_loadFixture(FIXTURE_DEPEG)); // phase 2, round 983 — an older, lower id

        assertEq(registry.latestRoundId(USDC_FEED_ID), LIVE_ROUND_ID, "latest did not regress");
        assertTrue(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).exists, "older round still stored");
        assertEq(
            registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).answer, DEPEG_ANSWER, "older answer intact"
        );
    }

    function test_LatestRoundUpdated_EmittedOnlyWhenLatestAdvances() public {
        vm.recordLogs();
        _record(_loadFixture(FIXTURE_LIVE));
        _record(_loadFixture(FIXTURE_DEPEG));

        uint256 advances;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == IProvenFeedRegistry.LatestRoundUpdated.selector) ++advances;
        }
        assertEq(advances, 1, "only the newer round advanced latest");
    }

    // ── T-R14: the inherited entrypoint is inert ─────────────────────────────────────────────────

    /// T-R14 / D-03: `execute` must never be able to record anything.
    function test_InheritedExecute_AlwaysReverts() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        vm.prank(keeper);
        vm.expectRevert(IProvenFeedRegistry.UseRecordRound.selector);
        registry.execute(
            0,
            f.chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );
        assertFalse(registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID).exists, "nothing stored");
    }

    /// D-03: `execute` reverting must not burn the query id for the real entrypoint.
    function test_InheritedExecute_DoesNotConsumeTheQueryId() public {
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE);
        vm.prank(keeper);
        try registry.execute(
            0,
            f.chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        ) {
            fail();
        } catch {}
        uint80[] memory ids = _record(f);
        assertEq(ids[0], LIVE_ROUND_ID, "recordRound still works afterwards");
    }

    // ── Views ────────────────────────────────────────────────────────────────────────────────────

    function test_LatestRoundData_RevertsBeforeAnyRound() public {
        vm.expectRevert(abi.encodeWithSelector(IProvenFeedRegistry.NoRoundYet.selector, USDC_FEED_ID));
        registry.latestRoundData(USDC_FEED_ID);
    }

    function test_GetRound_ReturnsEmptyStructForUnknownRound() public view {
        IProvenFeedRegistry.Round memory r = registry.getRound(USDC_FEED_ID, 12345);
        assertFalse(r.exists, "does not revert, just reports absence");
        assertEq(r.answer, 0, "zeroed");
    }

    function test_IsFresh_ReflectsSourceChainTimestamp() public {
        assertFalse(registry.isFresh(USDC_FEED_ID, 1 hours), "no round yet");
        _record(_loadFixture(FIXTURE_LIVE));

        vm.warp(LIVE_UPDATED_AT + 30 minutes);
        assertTrue(registry.isFresh(USDC_FEED_ID, 1 hours), "within maxAge");

        vm.warp(LIVE_UPDATED_AT + 2 hours);
        assertFalse(registry.isFresh(USDC_FEED_ID, 1 hours), "beyond maxAge");
    }

    /// @dev The freshness semantics we promise: a lower bound, never "this is the latest price".
    function test_IsFresh_UsesChainlinkTimestampNotProvenAt() public {
        // Prove the 2023 round long after the fact: it is genuinely old, however recently proven.
        _record(_loadFixture(FIXTURE_DEPEG));
        assertFalse(registry.isFresh(USDC_FEED_ID, 365 days), "a freshly proven old round is still old");
        assertEq(
            registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).provenAt,
            uint64(block.timestamp),
            "provenAt is Creditcoin time"
        );
    }

    function test_MaxLogs_IsBounded() public view {
        assertEq(registry.MAX_LOGS(), 64, "D-12");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _merkleProof(ProofFixture memory f)
        internal
        pure
        returns (INativeQueryVerifier.MerkleProof memory)
    {
        return INativeQueryVerifier.MerkleProof({root: f.merkleRoot, siblings: f.siblings});
    }

    /// @dev Mirrors `ASCBase._computeQueryId` so tests can assert the exact `RoundProven` payload.
    function _queryIdOf(ProofFixture memory f) internal view returns (bytes32 queryId) {
        uint256 txIndex = verifier.calculateTxIndex(_merkleProof(f));
        uint64 chainKey = f.chainKey;
        uint64 blockHeight = f.blockHeight;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}
