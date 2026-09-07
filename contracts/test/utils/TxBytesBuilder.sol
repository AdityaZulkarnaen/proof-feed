// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title TxBytesBuilder
/// @notice Builds `EvmV1`-encoded transaction bytes for negative test cases. TESTS ONLY.
/// @dev docs/09 Q10 asked whether a synthetic encoder was feasible in under two hours, with
///      byte-patching as the fallback. It is: `EvmV1Decoder` decodes `abi.encode(uint8 txType,
///      bytes[] chunks)` where `chunks[0]` is the common tx fields, `chunks[1]` is type-specific and
///      `chunks[2]` is the receipt (types 0–2). So the encoder is the mirror image of the decoder,
///      and negative cases (unregistered emitter, failed receipt, malformed log, 65 logs) can be
///      constructed exactly rather than approximated by mutating real bytes.
///
///      The positive cases still use REAL captured mainnet bytes (docs/07 §1) — this builder exists
///      only to reach states no real Chainlink transaction would produce.
library TxBytesBuilder {
    /// @dev keccak256("AnswerUpdated(int256,uint256,uint256)")
    bytes32 internal constant ANSWER_UPDATED_SIG =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    /// @notice A well-formed `AnswerUpdated` log from `emitter`.
    function answerUpdatedLog(address emitter, int256 answer, uint256 aggRound, uint256 updatedAt)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory log_)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = ANSWER_UPDATED_SIG;
        topics[1] = bytes32(uint256(answer));
        topics[2] = bytes32(aggRound);
        log_ = EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: abi.encode(updatedAt)});
    }

    /// @notice A log carrying the right signature but the wrong ABI shape (`topicCount` topics).
    /// @dev Models a contract that emits a colliding signature hash with a different layout.
    function malformedAnswerUpdatedLog(address emitter, uint256 topicCount, uint256 dataBytes)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory log_)
    {
        bytes32[] memory topics = new bytes32[](topicCount);
        if (topicCount > 0) topics[0] = ANSWER_UPDATED_SIG;
        for (uint256 i = 1; i < topicCount; ++i) {
            topics[i] = bytes32(i);
        }
        log_ = EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: new bytes(dataBytes)});
    }

    /// @notice An unrelated log (different event signature) — must be filtered out entirely.
    function unrelatedLog(address emitter) internal pure returns (EvmV1Decoder.LogEntryTuple memory log_) {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("Transfer(address,address,uint256)");
        topics[1] = bytes32(uint256(uint160(emitter)));
        topics[2] = bytes32(uint256(1));
        log_ = EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: abi.encode(uint256(1))});
    }

    /// @notice Encode a type-2 (EIP-1559) transaction with the given receipt status and logs.
    /// @param receiptStatus 1 for success, 0 for a reverted source transaction.
    /// @param logs The receipt's logs, in order.
    function encodeType2(uint8 receiptStatus, EvmV1Decoder.LogEntryTuple[] memory logs)
        internal
        pure
        returns (bytes memory)
    {
        return encode(2, receiptStatus, logs);
    }

    /// @notice Encode a transaction of `txType` (0–2 shape: three chunks).
    function encode(uint8 txType, uint8 receiptStatus, EvmV1Decoder.LogEntryTuple[] memory logs)
        internal
        pure
        returns (bytes memory)
    {
        bytes[] memory chunks = new bytes[](3);

        // chunk 0 — common tx fields
        chunks[0] = abi.encode(
            uint64(7), // nonce
            uint64(500_000), // gasLimit
            address(0xBEEF), // from
            false, // toIsNull
            address(0xCAFE), // to
            uint256(0), // value
            hex"c9807539" // calldata (transmit selector shape; unused by our path)
        );

        // chunk 1 — type-specific fields
        EvmV1Decoder.AccessListEntryBytes32[] memory accessList =
            new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(
            uint64(1), // chainId
            uint128(1 gwei), // maxPriorityFeePerGas
            uint128(30 gwei), // maxFeePerGas
            accessList,
            uint8(0), // yParity
            bytes32(uint256(1)), // r
            bytes32(uint256(2)) // s
        );

        // chunk 2 — receipt
        chunks[2] = abi.encode(receiptStatus, uint64(210_000), logs, new bytes(256));

        return abi.encode(txType, chunks);
    }

    /// @notice Encode a transaction whose type byte is outside the supported 0–4 range.
    function encodeInvalidType(uint8 txType) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(
            uint64(0), uint64(0), address(0), false, address(0), uint256(0), bytes("")
        );
        chunks[1] = "";
        chunks[2] = abi.encode(
            uint8(1), uint64(0), new EvmV1Decoder.LogEntryTuple[](0), new bytes(0)
        );
        return abi.encode(txType, chunks);
    }

    /// @notice Convenience: a transaction containing exactly one well-formed round.
    function singleRound(address emitter, int256 answer, uint256 aggRound, uint256 updatedAt)
        internal
        pure
        returns (bytes memory)
    {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = answerUpdatedLog(emitter, answer, aggRound, updatedAt);
        return encodeType2(1, logs);
    }
}
