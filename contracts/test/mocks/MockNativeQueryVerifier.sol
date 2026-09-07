// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title MockNativeQueryVerifier
/// @notice Test double for the Block Prover precompile at `0xFD2`. TESTS ONLY — never reachable
///         from `cli/`, `script/` or any deployed contract (CLAUDE.md hard rule 6).
/// @dev Foundry has no precompiles, so tests `vm.etch` this code at `0x…0FD2`. State then lives at
///      that address, which is why the toggles are storage rather than constructor args (D-09).
///      What is mocked is ONLY the cryptographic verdict; the transaction bytes fed to the registry
///      in the fixture tests are real Ethereum mainnet bytes, so the decode path is tested against
///      reality.
contract MockNativeQueryVerifier is INativeQueryVerifier {
    /// @notice Verdict returned for every proof unless `rejectRoot` matches.
    bool public result = true;

    /// @notice When non-zero, any proof carrying this merkle root is rejected.
    /// @dev Lets a test reject one specific proof while accepting others in the same run.
    bytes32 public rejectRoot;

    /// @notice How many times `verifyAndEmit` has been called (asserts the registry really calls it).
    uint256 public verifyAndEmitCalls;

    error NotSupported();

    /// @notice Set the verdict returned to callers.
    function setResult(bool value) external {
        result = value;
    }

    /// @notice Reject only proofs whose merkle root equals `root`.
    function setRejectRoot(bytes32 root) external {
        rejectRoot = root;
    }

    /// @inheritdoc INativeQueryVerifier
    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata
    ) external returns (bool) {
        ++verifyAndEmitCalls;
        emit TransactionVerified(chainKey, height, calculateTxIndex(merkleProof));
        if (rejectRoot != bytes32(0) && merkleProof.root == rejectRoot) return false;
        return result;
    }

    /// @inheritdoc INativeQueryVerifier
    function verify(
        uint64,
        uint64,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata
    ) external view returns (bool) {
        if (rejectRoot != bytes32(0) && merkleProof.root == rejectRoot) return false;
        return result;
    }

    /// @notice Batch verification is out of scope for P0 (FR-32 is P2).
    function verifyAndEmit(uint64, uint64[] calldata, bytes[] calldata, MerkleProof[] calldata, ContinuityProof calldata)
        external
        pure
        returns (bool)
    {
        revert NotSupported();
    }

    /// @notice Batch verification is out of scope for P0 (FR-32 is P2).
    function verify(uint64, uint64[] calldata, bytes[] calldata, MerkleProof[] calldata, ContinuityProof calldata)
        external
        pure
        returns (bool)
    {
        revert NotSupported();
    }

    /// @inheritdoc INativeQueryVerifier
    /// @dev Mirrors the off-chain `indexFromLaterality`: a sibling on the LEFT means this leaf is
    ///      the right child, so bit `i` is set. Must match the real precompile, because the query
    ///      id (and therefore replay protection) is derived from this value.
    function calculateTxIndex(MerkleProof calldata merkleProof) public pure returns (uint64 index) {
        uint256 n = merkleProof.siblings.length;
        for (uint256 i; i < n; ++i) {
            if (merkleProof.siblings[i].isLeft) index |= uint64(1) << uint64(i);
        }
    }
}
