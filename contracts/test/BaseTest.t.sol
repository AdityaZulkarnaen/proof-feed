// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {ProvenFeedRegistry} from "../src/ProvenFeedRegistry.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";

/// @notice One captured Attestcoin proof, decoded into `recordRound`'s argument list.
struct ProofFixture {
    uint64 chainKey;
    uint64 blockHeight;
    bytes encodedTransaction;
    bytes32 merkleRoot;
    INativeQueryVerifier.MerkleProofEntry[] siblings;
    bytes32 lowerEndpointDigest;
    bytes32[] continuityRoots;
}

/// @title BaseTest
/// @notice Shared harness: a mock verifier etched at the real precompile address, a registry, and
///         loaders for the REAL mainnet proofs captured by `pf capture` (docs/07 §1).
/// @dev The verifier verdict is mocked because Foundry has no precompiles (D-09). Everything after
///      the verdict — EvmV1 decoding, the emitter check, round composition, storage — runs on
///      genuine Ethereum mainnet bytes.
abstract contract BaseTest is Test {
    /// @dev The Block Prover / Native Query Verifier precompile address on Creditcoin.
    address internal constant VERIFIER_ADDR = 0x0000000000000000000000000000000000000FD2;

    /// @dev Attestcoin chain key for Ethereum mainnet.
    uint64 internal constant MAINNET_KEY = 3;
    /// @dev Attestcoin chain key for Sepolia — used to prove that a key mismatch is rejected.
    uint64 internal constant SEPOLIA_KEY = 1;

    // ── Live fixture: USDC/USD round 1178, Ethereum block 25,924,144 ─────────────────────────────
    string internal constant FIXTURE_LIVE = "usdc_usd_live_25924144";
    address internal constant LIVE_AGGREGATOR = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;
    uint16 internal constant LIVE_PHASE = 3;
    int256 internal constant LIVE_ANSWER = 99988765;
    uint256 internal constant LIVE_AGG_ROUND = 1178;
    uint64 internal constant LIVE_UPDATED_AT = 1788768023; // 2026-09-07T08:00:23Z
    uint80 internal constant LIVE_ROUND_ID = 55340232221128656026; // (3 << 64) | 1178

    // ── Historical fixture: the 2023-03-11 USDC depeg low, Ethereum block 16,803,472 ─────────────
    string internal constant FIXTURE_DEPEG = "usdc_usd_depeg_16803472";
    address internal constant DEPEG_AGGREGATOR = 0x789190466E21a8b78b8027866CBBDc151542A26C;
    uint16 internal constant DEPEG_PHASE = 2;
    int256 internal constant DEPEG_ANSWER = 88000000; // $0.88000000
    uint256 internal constant DEPEG_AGG_ROUND = 983;
    uint64 internal constant DEPEG_UPDATED_AT = 1678521083; // 2023-03-11T07:51:23Z
    uint80 internal constant DEPEG_ROUND_ID = 36893488147419104215; // (2 << 64) | 983

    /// @dev `keccak256("USDC / USD")`, the exact string the mainnet proxy returns.
    bytes32 internal constant USDC_FEED_ID =
        0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256;
    string internal constant USDC_DESCRIPTION = "USDC / USD";
    uint8 internal constant USDC_DECIMALS = 8;

    ProvenFeedRegistry internal registry;
    MockNativeQueryVerifier internal verifier;

    address internal owner = makeAddr("owner");
    address internal keeper = makeAddr("keeper");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        _etchVerifier();
        registry = new ProvenFeedRegistry(owner);
        _registerUsdcPhases();
        // Fixtures carry real 2023/2026 timestamps; keep block.timestamp ahead of both.
        vm.warp(LIVE_UPDATED_AT + 1 days);
    }

    /// @dev Put the mock's code at the precompile address so `ASCBase`'s hardcoded VERIFIER hits it.
    function _etchVerifier() internal {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_ADDR, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_ADDR);
        // Etched code starts with zeroed storage; set the default verdict explicitly.
        verifier.setResult(true);
    }

    /// @dev Register both USDC/USD phases under one feed id, as `pf register` does on-chain.
    function _registerUsdcPhases() internal {
        vm.startPrank(owner);
        registry.registerFeed(
            USDC_FEED_ID, MAINNET_KEY, LIVE_AGGREGATOR, LIVE_PHASE, USDC_DECIMALS, USDC_DESCRIPTION
        );
        registry.registerFeed(
            USDC_FEED_ID, MAINNET_KEY, DEPEG_AGGREGATOR, DEPEG_PHASE, USDC_DECIMALS, USDC_DESCRIPTION
        );
        vm.stopPrank();
    }

    /// @notice Load a captured proof (`test/fixtures/<name>.abi.hex`) into `recordRound` arguments.
    function _loadFixture(string memory name) internal view returns (ProofFixture memory f) {
        string memory path = string.concat("./test/fixtures/", name, ".abi.hex");
        bytes memory encoded = vm.parseBytes(vm.trim(vm.readFile(path)));
        (
            uint64 chainKey,
            uint64 blockHeight,
            bytes memory encodedTransaction,
            bytes32 merkleRoot,
            INativeQueryVerifier.MerkleProofEntry[] memory siblings,
            bytes32 lowerEndpointDigest,
            bytes32[] memory continuityRoots
        ) = abi.decode(
            encoded,
            (uint64, uint64, bytes, bytes32, INativeQueryVerifier.MerkleProofEntry[], bytes32, bytes32[])
        );
        f = ProofFixture({
            chainKey: chainKey,
            blockHeight: blockHeight,
            encodedTransaction: encodedTransaction,
            merkleRoot: merkleRoot,
            siblings: siblings,
            lowerEndpointDigest: lowerEndpointDigest,
            continuityRoots: continuityRoots
        });
    }

    /// @notice Submit a fixture through `recordRound` as `keeper`.
    function _record(ProofFixture memory f) internal returns (uint80[] memory) {
        vm.prank(keeper);
        return registry.recordRound(
            f.chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );
    }

    /// @notice Submit a fixture with an overridden chain key (cross-chain spoof tests, INV-03).
    function _recordAs(ProofFixture memory f, uint64 chainKey) internal returns (uint80[] memory) {
        vm.prank(keeper);
        return registry.recordRound(
            chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );
    }

    /// @notice Submit several fixtures through `recordRoundBatch` as `keeper` (FR-32).
    /// @dev The shared continuity proof is taken from `fs[0]`. That mirrors the prover's batch
    ///      response, which returns exactly one `ContinuityProof` for the whole span. The mock
    ///      verifier does not check it cryptographically — what these tests exercise is the
    ///      registry's batch orchestration on top of a verdict, against real mainnet tx bytes.
    function _recordBatch(ProofFixture[] memory fs) internal returns (uint80[] memory) {
        (
            uint64[] memory heights,
            bytes[] memory txs,
            INativeQueryVerifier.MerkleProof[] memory proofs
        ) = _batchArgs(fs);
        vm.prank(keeper);
        return registry.recordRoundBatch(
            fs[0].chainKey, heights, txs, proofs, fs[0].lowerEndpointDigest, fs[0].continuityRoots
        );
    }

    /// @dev Split fixtures into the parallel arrays `recordRoundBatch` takes.
    function _batchArgs(ProofFixture[] memory fs)
        internal
        pure
        returns (
            uint64[] memory heights,
            bytes[] memory txs,
            INativeQueryVerifier.MerkleProof[] memory proofs
        )
    {
        uint256 n = fs.length;
        heights = new uint64[](n);
        txs = new bytes[](n);
        proofs = new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i; i < n; ++i) {
            heights[i] = fs[i].blockHeight;
            txs[i] = fs[i].encodedTransaction;
            proofs[i] = INativeQueryVerifier.MerkleProof({root: fs[i].merkleRoot, siblings: fs[i].siblings});
        }
    }

    /// @dev Produce a fixture with a DIFFERENT query id but the same payload.
    ///      `_computeQueryId` hashes `(chainKey, blockHeight, calculateTxIndex(siblings))` — the
    ///      merkle root is not part of it — so the laterality of a sibling is what must change.
    ///      Used to reach the per-round guard (INV-02) without tripping replay protection first.
    function _withDifferentQueryId(ProofFixture memory f) internal pure returns (ProofFixture memory) {
        f.siblings[0].isLeft = !f.siblings[0].isLeft;
        return f;
    }
}
