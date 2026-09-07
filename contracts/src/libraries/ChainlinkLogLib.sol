// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title ChainlinkLogLib
/// @notice Pure helpers that turn a verified `EvmV1Decoder.LogEntry` into a Chainlink round.
/// @dev Every function is `internal pure`, so the library is inlined — no linking step.
///      Callers MUST have verified the transaction through the Block Prover precompile before
///      calling anything here: this library trusts its input bytes and only checks their shape.
library ChainlinkLogLib {
    /// @notice `keccak256("AnswerUpdated(int256,uint256,uint256)")`.
    /// @dev Day-1 verified: the current USDC/USD aggregator emits this event (docs/09 Q2).
    bytes32 internal constant ANSWER_UPDATED_SIG =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    /// @notice A decoded `AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)`.
    /// @param emitter The aggregator that emitted the log (checked against the registry by the caller).
    /// @param answer The price, in the feed's decimals.
    /// @param aggregatorRoundId The aggregator-local round id (NOT the proxy round id).
    /// @param updatedAt The source-chain timestamp Chainlink recorded for the round.
    struct AnswerUpdated {
        address emitter;
        int256 answer;
        uint256 aggregatorRoundId;
        uint256 updatedAt;
    }

    /// @notice The log matched the event signature but does not have the shape the ABI requires.
    error BadAnswerUpdatedLog(uint256 topics, uint256 dataLen);

    /// @notice Round ids must fit the Chainlink proxy's `uint80` packing.
    error AggregatorRoundIdTooLarge(uint256 aggregatorRoundId);

    /// @notice Decode one `AnswerUpdated` log.
    /// @dev Enforces the exact ABI shape (2 indexed params + 1 word of data) rather than trusting
    ///      topic[0] alone — a contract may emit an event with a colliding signature hash but a
    ///      different layout. INV-04 / hard rule 2 in CLAUDE.md.
    /// @param log_ A log already filtered by `ANSWER_UPDATED_SIG`.
    /// @return a The decoded round.
    function parseAnswerUpdated(EvmV1Decoder.LogEntry memory log_)
        internal
        pure
        returns (AnswerUpdated memory a)
    {
        if (log_.topics.length != 3 || log_.data.length != 32) {
            revert BadAnswerUpdatedLog(log_.topics.length, log_.data.length);
        }
        a.emitter = log_.address_;
        // `current` is an indexed int256: the topic holds its two's-complement bytes32.
        a.answer = int256(uint256(log_.topics[1]));
        a.aggregatorRoundId = uint256(log_.topics[2]);
        a.updatedAt = abi.decode(log_.data, (uint256));
    }

    /// @notice Compose the Chainlink proxy round id from a phase and an aggregator-local round.
    /// @dev `(phaseId << 64) | aggregatorRoundId`, the AggregatorProxy convention (D-04).
    ///      Day-1 verified against live mainnet: `(3 << 64) | 1178` equals the value the USDC/USD
    ///      proxy returns from `latestRoundData()`.
    /// @param phaseId The proxy phase the emitting aggregator belongs to.
    /// @param aggregatorRoundId The aggregator-local round id.
    /// @return The proxy-shaped round id.
    function composeRoundId(uint16 phaseId, uint256 aggregatorRoundId) internal pure returns (uint80) {
        if (aggregatorRoundId >= (uint256(1) << 64)) revert AggregatorRoundIdTooLarge(aggregatorRoundId);
        return uint80((uint256(phaseId) << 64) | aggregatorRoundId);
    }

    /// @notice Split a proxy round id back into its phase and aggregator-local parts.
    /// @param roundId The proxy-shaped round id.
    /// @return phaseId The phase component.
    /// @return aggregatorRoundId The aggregator-local component.
    function decomposeRoundId(uint80 roundId)
        internal
        pure
        returns (uint16 phaseId, uint64 aggregatorRoundId)
    {
        phaseId = uint16(roundId >> 64);
        aggregatorRoundId = uint64(roundId);
    }
}
