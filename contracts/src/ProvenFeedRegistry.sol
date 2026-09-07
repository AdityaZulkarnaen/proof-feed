// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IProvenFeedRegistry} from "./interfaces/IProvenFeedRegistry.sol";
import {ChainlinkLogLib} from "./libraries/ChainlinkLogLib.sol";

/// @title ProvenFeedRegistry
/// @author ProofFeed
/// @notice Stores Ethereum-mainnet Chainlink price rounds on Creditcoin. A round enters only by
///         way of an Attestcoin proof that the Block Prover precompile (`0xFD2`) verified in the
///         same transaction. There is no admin path that can write, alter or delete a price.
/// @dev Security model (docs/02 §5). Every stored round satisfies, in order:
///      1. the query id has never been processed before (`ASCBase.processedQueries`, INV-06);
///      2. `VERIFIER.verifyAndEmit` returned true for `(chainKey, blockHeight, txBytes, proofs)`;
///      3. the transaction type is one `EvmV1Decoder` supports (INV-04);
///      4. the source-chain receipt status is 1 (INV-04);
///      5. the log's emitter maps to an ACTIVE feed registered **for that same `chainKey`** (INV-03);
///      6. the log has the exact `AnswerUpdated` shape (3 topics, 32 bytes of data);
///      7. the round has not been stored before (INV-02).
///
///      **Why `recordRound` instead of `execute` (D-03).** `ASCBase.execute` is not `virtual`, and
///      its `_processAndEmitEvent` hook receives `(action, queryId, encodedTransaction)` — no
///      `chainKey`. Binding the emitter check to the chain key the precompile actually verified is
///      invariant INV-03: without it, a proof verified against Sepolia (key 1) could be processed
///      as if it were mainnet (key 3). So this contract keeps the standard `ASCBase` shape
///      (`VERIFIER`, `processedQueries`, `_verifyProof`, `_computeQueryId`) but adds its own
///      entrypoint that carries `chainKey` all the way to the emitter lookup, and neuters the
///      inherited `execute` by reverting in the hook.
contract ProvenFeedRegistry is ASCBase, Ownable2Step, IProvenFeedRegistry {
    using ChainlinkLogLib for EvmV1Decoder.LogEntry;

    /// @notice Upper bound on matching logs decoded per proven transaction (D-12).
    /// @dev Bounds gas. A Chainlink `transmit` carries a handful of logs; 64 is far above reality.
    uint256 public constant MAX_LOGS = 64;

    /// @dev Canonical metadata per feed, taken from the first registration of that feed id.
    mapping(bytes32 feedId => Feed) private _feeds;
    /// @dev `emitterKey => feedId`. Zero means "not a registered aggregator".
    mapping(bytes32 emitterKey => bytes32 feedId) private _emitterToFeed;
    /// @dev `emitterKey => per-emitter record` (its own chainKey, phaseId and active flag).
    mapping(bytes32 emitterKey => Feed) private _emitterFeed;
    /// @dev `feedId => roundId => round`. Write-once per round (INV-02).
    mapping(bytes32 feedId => mapping(uint80 roundId => Round)) private _rounds;

    /// @inheritdoc IProvenFeedRegistry
    mapping(bytes32 feedId => uint80) public latestRoundId;

    /// @param initialOwner The address allowed to register and deactivate feeds (configuration only).
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    /// @dev The key under which an aggregator is registered. Includes `chainKey` so the same
    ///      address on two source chains is two distinct registrations (INV-03).
    function emitterKey(uint64 chainKey, address emitter) public pure returns (bytes32) {
        return keccak256(abi.encode(chainKey, emitter));
    }

    /// @inheritdoc IProvenFeedRegistry
    /// @dev Registration is configuration, not data: it says "this address is aggregator X of feed
    ///      Y". It cannot introduce, change or remove a price. Disclosed centralization point (D-08).
    function registerFeed(
        bytes32 feedId,
        uint64 chainKey,
        address emitter,
        uint16 phaseId,
        uint8 decimals_,
        string calldata description
    ) external onlyOwner {
        if (emitter == address(0)) revert ZeroAddress();
        if (feedId == bytes32(0)) revert UnknownFeed(feedId);

        bytes32 key = emitterKey(chainKey, emitter);
        if (_emitterToFeed[key] != bytes32(0)) revert FeedExists(feedId, emitter);

        Feed storage canonical = _feeds[feedId];
        if (canonical.emitter == address(0)) {
            // First aggregator for this feed defines its canonical decimals and description.
            canonical.chainKey = chainKey;
            canonical.emitter = emitter;
            canonical.phaseId = phaseId;
            canonical.decimals = decimals_;
            canonical.active = true;
            canonical.description = description;
        } else if (canonical.decimals != decimals_) {
            // Mixing decimals across phases would silently corrupt every consumer's maths.
            revert FeedExists(feedId, emitter);
        }

        _emitterToFeed[key] = feedId;
        Feed storage e = _emitterFeed[key];
        e.chainKey = chainKey;
        e.emitter = emitter;
        e.phaseId = phaseId;
        e.decimals = decimals_;
        e.active = true;
        e.description = description;

        emit FeedRegistered(feedId, chainKey, emitter, phaseId, decimals_, description);
    }

    /// @inheritdoc IProvenFeedRegistry
    /// @dev Deactivating stops future proofs from that emitter. Already-stored rounds are untouched:
    ///      they were true when proven, and PegGuard policies may depend on them.
    function setFeedActive(uint64 chainKey, address emitter, bool active) external onlyOwner {
        bytes32 key = emitterKey(chainKey, emitter);
        bytes32 feedId = _emitterToFeed[key];
        if (feedId == bytes32(0)) revert UnknownFeed(feedId);
        _emitterFeed[key].active = active;
        emit FeedActiveSet(feedId, emitter, active);
    }

    /// @inheritdoc IProvenFeedRegistry
    /// @dev Permissionless: anyone may submit a proof. A malicious caller can only waste their own
    ///      gas — a forged log comes from an unregistered emitter, a tampered proof fails the
    ///      precompile, and a replayed proof hits `processedQueries`.
    function recordRound(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (uint80[] memory roundIds) {
        // 1. Replay protection, before spending anything on verification.
        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);
        require(!processedQueries[queryId], "Query already processed");

        // 2. The precompile is the only thing that can make these bytes trustworthy.
        bool verified = _verifyProof(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleRoot,
            siblings,
            lowerEndpointDigest,
            continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        // 3. Effects before decoding, so a revert below cannot leave a half-consumed query.
        processedQueries[queryId] = true;

        return _record(chainKey, queryId, encodedTransaction);
    }

    /// @dev Decode a set of verified transaction bytes and store every round we recognise.
    function _record(uint64 chainKey, bytes32 queryId, bytes calldata encodedTransaction)
        private
        returns (uint80[] memory roundIds)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTxType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        // A reverted source transaction still has a receipt; its logs must never be believed.
        if (receipt.receiptStatus != 1) revert SourceTxFailed(receipt.receiptStatus);

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, ChainlinkLogLib.ANSWER_UPDATED_SIG);
        uint256 n = logs.length;
        if (n > MAX_LOGS) revert TooManyLogs(n);

        uint80[] memory found = new uint80[](n);
        uint256 count;

        for (uint256 i; i < n; ++i) {
            EvmV1Decoder.LogEntry memory log_ = logs[i];

            // INV-03: the emitter must be registered for the chain key the precompile verified.
            bytes32 key = emitterKey(chainKey, log_.address_);
            bytes32 feedId = _emitterToFeed[key];
            // Unrelated aggregators can share a transaction, so skip rather than revert.
            if (feedId == bytes32(0)) continue;
            Feed storage emitterFeed = _emitterFeed[key];
            if (!emitterFeed.active) continue;

            ChainlinkLogLib.AnswerUpdated memory a = log_.parseAnswerUpdated();
            uint80 roundId = ChainlinkLogLib.composeRoundId(emitterFeed.phaseId, a.aggregatorRoundId);

            Round storage stored = _rounds[feedId][roundId];
            if (stored.exists) revert RoundAlreadyProven(feedId, roundId);

            stored.answer = a.answer;
            stored.updatedAt = uint64(a.updatedAt);
            stored.provenAt = uint64(block.timestamp);
            stored.prover = msg.sender;
            stored.queryId = queryId;
            stored.exists = true;

            emit RoundProven(feedId, roundId, a.answer, uint64(a.updatedAt), queryId, msg.sender);

            // INV-05: latest only ever moves forward. Older rounds are still stored, because a
            // PegGuard claim may need a round that is no longer the newest.
            if (roundId > latestRoundId[feedId]) {
                latestRoundId[feedId] = roundId;
                emit LatestRoundUpdated(feedId, roundId);
            }

            found[count++] = roundId;
        }

        if (count == 0) revert NoMatchingLogs(n);

        roundIds = new uint80[](count);
        for (uint256 i; i < count; ++i) {
            roundIds[i] = found[i];
        }
    }

    /// @inheritdoc ASCBase
    /// @dev Disabled on purpose (D-03). `ASCBase.execute` cannot pass `chainKey` to this hook, so
    ///      honouring it would break INV-03. It reverts before `execute` persists anything, which
    ///      makes the inherited entrypoint inert rather than dangerous.
    function _processAndEmitEvent(uint8, bytes32, bytes memory) internal pure override {
        revert UseRecordRound();
    }

    /// @inheritdoc IProvenFeedRegistry
    function feedOf(uint64 chainKey, address emitter) external view returns (bytes32) {
        return _emitterToFeed[emitterKey(chainKey, emitter)];
    }

    /// @inheritdoc IProvenFeedRegistry
    function getFeed(bytes32 feedId) external view returns (Feed memory) {
        return _feeds[feedId];
    }

    /// @inheritdoc IProvenFeedRegistry
    function getEmitterFeed(uint64 chainKey, address emitter) external view returns (Feed memory) {
        return _emitterFeed[emitterKey(chainKey, emitter)];
    }

    /// @inheritdoc IProvenFeedRegistry
    function getRound(bytes32 feedId, uint80 roundId) external view returns (Round memory) {
        return _rounds[feedId][roundId];
    }

    /// @inheritdoc IProvenFeedRegistry
    function latestRoundData(bytes32 feedId)
        external
        view
        returns (uint80 roundId, int256 answer, uint64 updatedAt, uint64 provenAt)
    {
        roundId = latestRoundId[feedId];
        if (roundId == 0) revert NoRoundYet(feedId);
        Round storage r = _rounds[feedId][roundId];
        return (roundId, r.answer, r.updatedAt, r.provenAt);
    }

    /// @inheritdoc IProvenFeedRegistry
    /// @dev Freshness here is a LOWER BOUND on what Chainlink has published: it says "a round this
    ///      recent has been proven", never "no newer round exists". Attestcoin commits transaction
    ///      history, not state (CLAUDE.md hard rule 4).
    function isFresh(bytes32 feedId, uint64 maxAge) external view returns (bool) {
        uint80 roundId = latestRoundId[feedId];
        if (roundId == 0) return false;
        return uint256(_rounds[feedId][roundId].updatedAt) + uint256(maxAge) >= block.timestamp;
    }
}
