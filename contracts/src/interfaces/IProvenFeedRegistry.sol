// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title IProvenFeedRegistry
/// @notice The registry of Chainlink price rounds that were proven onto Creditcoin by the
///         Attestcoin Protocol. There is deliberately NO function that accepts a price from
///         calldata: a round can only enter through `recordRound`, whose bytes were verified by the
///         Block Prover precompile in the same call (INV-01, INV-11, CLAUDE.md hard rule 1).
interface IProvenFeedRegistry {
    /// @param chainKey Attestcoin source-chain key the emitter lives on (3 = Ethereum mainnet).
    /// @param emitter The Chainlink aggregator contract that emits `AnswerUpdated`.
    /// @param phaseId The proxy phase this aggregator serves.
    /// @param decimals The feed's decimals (8 for USD feeds).
    /// @param active Whether proofs from this emitter are currently accepted.
    /// @param description The proxy's `description()` string, e.g. "USDC / USD".
    struct Feed {
        uint64 chainKey;
        address emitter;
        uint16 phaseId;
        uint8 decimals;
        bool active;
        string description;
    }

    /// @param answer The price Chainlink published, in the feed's decimals.
    /// @param updatedAt Chainlink's source-chain timestamp for the round.
    /// @param provenAt The Creditcoin timestamp at which the proof was accepted.
    /// @param prover Whoever paid the gas to submit the proof.
    /// @param queryId The Attestcoin query id that carried this round (replay key).
    /// @param exists False for rounds that have never been proven.
    struct Round {
        int256 answer;
        uint64 updatedAt;
        uint64 provenAt;
        address prover;
        bytes32 queryId;
        bool exists;
    }

    /// @notice A new aggregator was registered under `feedId`.
    event FeedRegistered(
        bytes32 indexed feedId,
        uint64 indexed chainKey,
        address indexed emitter,
        uint16 phaseId,
        uint8 decimals,
        string description
    );

    /// @notice An emitter was activated or deactivated. Deactivation does not delete stored rounds.
    event FeedActiveSet(bytes32 indexed feedId, address indexed emitter, bool active);

    /// @notice A Chainlink round was decoded from a precompile-verified transaction and stored.
    event RoundProven(
        bytes32 indexed feedId,
        uint80 indexed roundId,
        int256 answer,
        uint64 updatedAt,
        bytes32 queryId,
        address prover
    );

    /// @notice `latestRoundId[feedId]` advanced. Only ever emitted for a strictly greater round.
    event LatestRoundUpdated(bytes32 indexed feedId, uint80 indexed roundId);

    /// @notice The proven transaction is of a type `EvmV1Decoder` cannot handle.
    error UnsupportedTxType(uint8 txType);
    /// @notice The proven transaction reverted on the source chain; its logs are meaningless.
    error SourceTxFailed(uint8 status);
    /// @notice The transaction was valid but contained no round for any registered, active emitter.
    error NoMatchingLogs(uint256 logsScanned);
    /// @notice Decode gas is bounded: at most `MAX_LOGS` matching logs per transaction.
    error TooManyLogs(uint256 n);
    /// @notice This exact round was already stored (INV-02).
    error RoundAlreadyProven(bytes32 feedId, uint80 roundId);
    /// @notice The emitter is already mapped, or the feed's decimals disagree across phases.
    error FeedExists(bytes32 feedId, address emitter);
    /// @notice No feed is registered under this id / emitter key.
    error UnknownFeed(bytes32 feedId);
    /// @notice The feed exists but has no proven round yet.
    error NoRoundYet(bytes32 feedId);
    /// @notice A zero address was supplied where a contract was required.
    error ZeroAddress();
    /// @notice The inherited `ASCBase.execute` entrypoint is disabled — use `recordRound` (D-03).
    error UseRecordRound();

    /// @notice Register an aggregator as a source for `feedId`. Configuration only — never data.
    function registerFeed(
        bytes32 feedId,
        uint64 chainKey,
        address emitter,
        uint16 phaseId,
        uint8 decimals,
        string calldata description
    ) external;

    /// @notice Enable or disable proofs from one emitter.
    function setFeedActive(uint64 chainKey, address emitter, bool active) external;

    /// @notice Verify an Attestcoin proof and store every Chainlink round it contains.
    /// @dev Same proof parameters as `ASCBase.execute` minus `action` (D-03). Permissionless.
    /// @return roundIds The proxy round ids stored by this call (never empty; reverts instead).
    function recordRound(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (uint80[] memory roundIds);

    /// @notice The feed an emitter belongs to on a given chain, or `bytes32(0)` if unregistered.
    function feedOf(uint64 chainKey, address emitter) external view returns (bytes32 feedId);

    /// @notice Canonical (first-registered) metadata for a feed.
    function getFeed(bytes32 feedId) external view returns (Feed memory);

    /// @notice Per-emitter registration record.
    function getEmitterFeed(uint64 chainKey, address emitter) external view returns (Feed memory);

    /// @notice A stored round. `exists == false` when it has never been proven (does not revert).
    function getRound(bytes32 feedId, uint80 roundId) external view returns (Round memory);

    /// @notice Highest proven round id for a feed. Monotonically non-decreasing (INV-05).
    function latestRoundId(bytes32 feedId) external view returns (uint80);

    /// @notice The highest proven round. Reverts `NoRoundYet` if nothing has been proven.
    function latestRoundData(bytes32 feedId)
        external
        view
        returns (uint80 roundId, int256 answer, uint64 updatedAt, uint64 provenAt);

    /// @notice Whether the latest round's SOURCE-CHAIN timestamp is within `maxAge` of now.
    /// @dev This is a lower bound: a newer Chainlink round may exist that nobody has proven yet.
    function isFresh(bytes32 feedId, uint64 maxAge) external view returns (bool);
}
