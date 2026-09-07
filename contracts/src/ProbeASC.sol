// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title ProbeASC
/// @notice Day-1 spike contract only (docs/03 §6, docs/06 gate G4). NOT part of the demo path.
/// @dev Verifies an Attestcoin proof through the inherited `ASCBase.execute`, decodes the receipt
///      from the verified bytes and emits one `Probe` per `AnswerUpdated` log. Deliberately performs
///      NO emitter check — it exists to measure real gas and obtain the first on-chain verification
///      tx hash before product code is written. Never deploy this as part of the product.
contract ProbeASC is ASCBase {
    /// @dev keccak256("AnswerUpdated(int256,uint256,uint256)")
    bytes32 public constant ANSWER_UPDATED_SIG =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    /// @notice One decoded Chainlink round found inside a proven transaction.
    event Probe(
        address indexed emitter, int256 answer, uint256 aggRound, uint256 updatedAt, bytes32 queryId
    );

    /// @notice Summary of what the decoder saw in the proven transaction.
    event ProbeSummary(bytes32 indexed queryId, uint8 txType, uint8 receiptStatus, uint256 totalLogs, uint256 matchedLogs);

    error UnsupportedTxType(uint8 txType);
    error SourceTxFailed(uint8 status);

    /// @inheritdoc ASCBase
    function _processAndEmitEvent(uint8, bytes32 queryId, bytes memory encodedTransaction)
        internal
        override
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTxType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTxFailed(receipt.receiptStatus);

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, ANSWER_UPDATED_SIG);

        uint256 n = logs.length;
        for (uint256 i; i < n; ++i) {
            EvmV1Decoder.LogEntry memory log_ = logs[i];
            if (log_.topics.length != 3 || log_.data.length != 32) continue;
            emit Probe(
                log_.address_,
                int256(uint256(log_.topics[1])),
                uint256(log_.topics[2]),
                abi.decode(log_.data, (uint256)),
                queryId
            );
        }

        emit ProbeSummary(queryId, txType, receipt.receiptStatus, receipt.receiptLogs.length, n);
    }
}
