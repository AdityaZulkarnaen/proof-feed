// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./BaseTest.t.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {ProvenFeedAdapter} from "../src/ProvenFeedAdapter.sol";

/// @notice The Chainlink-shaped read surface. Consumers written for `AggregatorV3Interface` must
///         work against this without modification.
contract ProvenFeedAdapterTest is BaseTest {
    ProvenFeedAdapter internal adapter;

    function setUp() public override {
        super.setUp();
        adapter = new ProvenFeedAdapter(IProvenFeedRegistry(address(registry)), USDC_FEED_ID);
    }

    /// T-A01
    function test_LatestRoundData_RevertsBeforeAnyRound() public {
        vm.expectRevert(abi.encodeWithSelector(ProvenFeedAdapter.NoRoundYet.selector, USDC_FEED_ID));
        adapter.latestRoundData();
    }

    function test_LatestProvenAt_RevertsBeforeAnyRound() public {
        vm.expectRevert(abi.encodeWithSelector(ProvenFeedAdapter.NoRoundYet.selector, USDC_FEED_ID));
        adapter.latestProvenAt();
    }

    /// T-A02
    function test_LatestRoundData_ReturnsChainlinkShapedTuple() public {
        _record(_loadFixture(FIXTURE_LIVE));

        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            adapter.latestRoundData();

        assertEq(roundId, LIVE_ROUND_ID, "roundId");
        assertEq(answer, LIVE_ANSWER, "answer");
        assertEq(updatedAt, LIVE_UPDATED_AT, "updatedAt is Chainlink's mainnet timestamp");
        assertEq(startedAt, updatedAt, "startedAt mirrors updatedAt");
        assertEq(answeredInRound, roundId, "answeredInRound mirrors roundId");
    }

    /// T-A03
    function test_GetRoundData_UnknownRoundReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProvenFeedAdapter.UnknownRound.selector, USDC_FEED_ID, uint80(999))
        );
        adapter.getRoundData(999);
    }

    function test_GetRoundData_ReturnsHistoricalRoundAfterNewerOneExists() public {
        _record(_loadFixture(FIXTURE_LIVE));
        _record(_loadFixture(FIXTURE_DEPEG));

        (, int256 answer,, uint256 updatedAt,) = adapter.getRoundData(DEPEG_ROUND_ID);
        assertEq(answer, DEPEG_ANSWER, "the 2023 round is still readable");
        assertEq(updatedAt, DEPEG_UPDATED_AT, "with its own original timestamp");

        (, int256 latestAnswer,,,) = adapter.latestRoundData();
        assertEq(latestAnswer, LIVE_ANSWER, "latest is unaffected by proving an older round");
    }

    function test_Metadata_MirrorsTheMainnetProxy() public view {
        assertEq(adapter.decimals(), USDC_DECIMALS, "decimals");
        assertEq(adapter.description(), USDC_DESCRIPTION, "description");
        assertEq(adapter.version(), 1, "version");
        assertEq(adapter.FEED_ID(), USDC_FEED_ID, "feedId");
        assertEq(address(adapter.REGISTRY()), address(registry), "registry");
    }

    /// @dev `updatedAt` and `latestProvenAt` are different clocks and must never be conflated.
    function test_LatestProvenAt_IsCreditcoinTimeNotChainlinkTime() public {
        _record(_loadFixture(FIXTURE_DEPEG));
        (,,, uint256 updatedAt,) = adapter.latestRoundData();

        assertEq(updatedAt, DEPEG_UPDATED_AT, "price timestamp: 2023");
        assertEq(adapter.latestProvenAt(), uint64(block.timestamp), "proof timestamp: now");
        assertGt(adapter.latestProvenAt(), updatedAt, "a round can be proven long after it happened");
    }

    function test_Constructor_RevertsOnZeroRegistry() public {
        vm.expectRevert(ProvenFeedAdapter.ZeroAddress.selector);
        new ProvenFeedAdapter(IProvenFeedRegistry(address(0)), USDC_FEED_ID);
    }

    /// @notice A consumer written against Chainlink's interface compiles and runs unchanged.
    function test_ChainlinkShapedConsumer_WorksUnmodified() public {
        _record(_loadFixture(FIXTURE_LIVE));
        ChainlinkConsumer consumer = new ChainlinkConsumer(address(adapter));
        assertEq(consumer.readPrice(), LIVE_ANSWER, "an unmodified Chainlink consumer reads it");
    }
}

/// @dev Deliberately declares its own minimal `AggregatorV3Interface`, as a real third-party
///      consumer would — nothing here imports ProofFeed.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract ChainlinkConsumer {
    AggregatorV3Interface public immutable FEED;

    constructor(address feed) {
        FEED = AggregatorV3Interface(feed);
    }

    function readPrice() external view returns (int256) {
        (, int256 answer,,,) = FEED.latestRoundData();
        return answer;
    }
}
