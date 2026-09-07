// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProvenFeedRegistry} from "./interfaces/IProvenFeedRegistry.sol";

/// @title ProvenFeedAdapter
/// @author ProofFeed
/// @notice Exposes one proven feed in the shape of Chainlink's `AggregatorV3Interface`, so a
///         Creditcoin contract already written against Chainlink compiles and runs unchanged.
/// @dev **This is a lower-bound feed, and consumers MUST treat it as one.**
///      `updatedAt` is Chainlink's Ethereum-mainnet timestamp for the round; `latestProvenAt` is
///      when Creditcoin accepted the proof. The Attestcoin Protocol commits transaction history,
///      not state, so this contract can prove that a round *happened* but never that it is the
///      *latest* round Chainlink has published — somebody simply may not have proven a newer one
///      yet. Every consumer MUST apply its own staleness check against `updatedAt`, exactly as a
///      careful Chainlink consumer does on mainnet.
contract ProvenFeedAdapter {
    /// @notice The registry this adapter reads. Immutable — an adapter can never be repointed.
    IProvenFeedRegistry public immutable REGISTRY;

    /// @notice The feed this adapter exposes, `keccak256(bytes(description))`.
    bytes32 public immutable FEED_ID;

    /// @notice No round has been proven for this feed yet.
    error NoRoundYet(bytes32 feedId);
    /// @notice The requested round has never been proven onto Creditcoin.
    error UnknownRound(bytes32 feedId, uint80 roundId);
    /// @notice The registry address was zero.
    error ZeroAddress();

    /// @param registry The `ProvenFeedRegistry` holding proven rounds.
    /// @param feedId The feed to expose.
    constructor(IProvenFeedRegistry registry, bytes32 feedId) {
        if (address(registry) == address(0)) revert ZeroAddress();
        REGISTRY = registry;
        FEED_ID = feedId;
    }

    /// @notice Decimals of the underlying Chainlink feed (8 for USD feeds).
    function decimals() external view returns (uint8) {
        return REGISTRY.getFeed(FEED_ID).decimals;
    }

    /// @notice The feed's description, exactly as the mainnet proxy reports it, e.g. "USDC / USD".
    function description() external view returns (string memory) {
        return REGISTRY.getFeed(FEED_ID).description;
    }

    /// @notice Interface version, mirroring Chainlink's aggregator versioning.
    function version() external pure returns (uint256) {
        return 1;
    }

    /// @notice The most recent round proven onto Creditcoin.
    /// @dev `startedAt` is set to `updatedAt` and `answeredInRound` to `roundId`: the source
    ///      `AnswerUpdated` event carries no separate started-at, and inventing one would be a lie.
    /// @return roundId The Chainlink proxy round id, `(phaseId << 64) | aggregatorRoundId`.
    /// @return answer The price in feed decimals.
    /// @return startedAt Equal to `updatedAt` (see dev note).
    /// @return updatedAt Chainlink's mainnet timestamp — check this against your staleness policy.
    /// @return answeredInRound Equal to `roundId`.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint80 latest = REGISTRY.latestRoundId(FEED_ID);
        if (latest == 0) revert NoRoundYet(FEED_ID);
        IProvenFeedRegistry.Round memory r = REGISTRY.getRound(FEED_ID, latest);
        return (latest, r.answer, r.updatedAt, r.updatedAt, latest);
    }

    /// @notice A specific proven round.
    /// @param roundId_ The Chainlink proxy round id.
    /// @return roundId The round id echoed back.
    /// @return answer The price in feed decimals.
    /// @return startedAt Equal to `updatedAt`.
    /// @return updatedAt Chainlink's mainnet timestamp.
    /// @return answeredInRound Equal to `roundId`.
    function getRoundData(uint80 roundId_)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        IProvenFeedRegistry.Round memory r = REGISTRY.getRound(FEED_ID, roundId_);
        if (!r.exists) revert UnknownRound(FEED_ID, roundId_);
        return (roundId_, r.answer, r.updatedAt, r.updatedAt, roundId_);
    }

    /// @notice When Creditcoin accepted the proof of the latest round (NOT a Chainlink timestamp).
    /// @dev Non-Chainlink extension. Use it to reason about how stale the *proof* is, separately
    ///      from how stale the *price* is.
    function latestProvenAt() external view returns (uint64) {
        uint80 latest = REGISTRY.latestRoundId(FEED_ID);
        if (latest == 0) revert NoRoundYet(FEED_ID);
        return REGISTRY.getRound(FEED_ID, latest).provenAt;
    }
}
