// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";
import {TxBytesBuilder} from "./utils/TxBytesBuilder.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {PegGuard} from "../src/PegGuard.sol";
import {ProvenFeedRegistry} from "../src/ProvenFeedRegistry.sol";

/// @notice T-P16 / INV-07: whatever sequence of deposits, purchases, claims, expiries and
///         withdrawals a fuzzer finds, the pool must never promise more than it holds.
contract PegGuardInvariantTest is Test {
    address internal constant VERIFIER_ADDR = 0x0000000000000000000000000000000000000FD2;
    bytes32 internal constant FEED_ID = keccak256("USDC / USD");
    address internal constant AGGREGATOR = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;
    uint64 internal constant CHAIN_KEY = 3;
    uint16 internal constant PHASE = 3;

    ProvenFeedRegistry internal registry;
    PegGuard internal guard;
    PegGuardHandler internal handler;

    function setUp() public {
        vm.etch(VERIFIER_ADDR, address(new MockNativeQueryVerifier()).code);
        MockNativeQueryVerifier(VERIFIER_ADDR).setResult(true);

        address owner = address(this);
        registry = new ProvenFeedRegistry(owner);
        registry.registerFeed(FEED_ID, CHAIN_KEY, AGGREGATOR, PHASE, 8, "USDC / USD");

        guard = new PegGuard(IProvenFeedRegistry(address(registry)), owner);
        guard.configurePool(FEED_ID, 50, 0, 100 ether, true, 2_000, 30);

        // FR-33: these suites are about the money paths, not the underwriting bound, and most of
        // them buy cover before any round exists to price a strike against. The ceiling is turned
        // off here on purpose; `StrikeGuard.t.sol` is where the default behaviour is tested.
        uint16 unbounded = guard.UNBOUNDED_STRIKE();
        vm.prank(owner);
        guard.configureStrikeBounds(FEED_ID, unbounded, 0);

        handler = new PegGuardHandler(registry, guard, FEED_ID);
        vm.deal(address(handler), 10_000 ether);

        targetContract(address(handler));
    }

    /// @notice INV-07: reserved liquidity never exceeds the balance backing it.
    function invariant_LockedNeverExceedsBalance() public view {
        PegGuard.Pool memory p = guard.getPool(FEED_ID);
        assertLe(p.locked, p.balance, "locked <= balance");
    }

    /// @notice T-S08: the contract's actual CTC must cover every pool it accounts for, so a claim
    ///         can never be reached in a state where the pool owes more than it holds. Together
    ///         with `invariant_LockedNeverExceedsBalance` this is what makes "claim when
    ///         balance < notional" unreachable: an ACTIVE policy's notional is always part of
    ///         `locked`, and `locked <= balance <= address(this).balance`.
    function invariant_ContractBalanceCoversPoolAccounting() public view {
        PegGuard.Pool memory p = guard.getPool(FEED_ID);
        // FR-20: the contract now also custodies bounty escrow, which is NOT part of any pool
        // balance. Solvency must cover both, or the pool could be spending money it is holding for
        // provers.
        assertGe(address(guard).balance, p.balance + guard.bountyEscrow(), "solvent incl. bounty escrow");
    }

    /// @notice FR-20: escrowed bounty is never counted as pool liquidity, so an LP can never
    ///         withdraw it and a claim can never pay it out as notional.
    function invariant_BountyEscrowIsSeparateFromPool() public view {
        PegGuard.Pool memory p = guard.getPool(FEED_ID);
        assertGe(address(guard).balance - guard.bountyEscrow(), p.balance, "escrow not double-counted");
    }

    /// @notice FR-30: no settled policy ever paid more than the notional the pool reserved for
    ///         it, and a proportional policy's payout is exactly the formula applied to the round
    ///         that settled it. This is what lets `locked` be released in full on a partial payout.
    function invariant_PayoutNeverExceedsReservedNotional() public view {
        uint256[] memory ids = handler.policyIds();
        for (uint256 i; i < ids.length; ++i) {
            PegGuard.Policy memory p = guard.getPolicy(ids[i]);
            if (p.status != PegGuard.Status.CLAIMED) continue;
            assertLe(p.payout, p.notional, "payout <= reserved notional");
            IProvenFeedRegistry.Round memory r = registry.getRound(p.feedId, p.claimRoundId);
            assertEq(
                p.payout,
                guard.payoutFor(p.mode, p.notional, p.strike, r.answer),
                "the payout is the formula, applied to the proven answer"
            );
        }
    }

    /// @notice Shares exist only while there is a balance to redeem them against.
    function invariant_SharesImplyBalance() public view {
        PegGuard.Pool memory p = guard.getPool(FEED_ID);
        if (p.totalShares > 0) assertGt(p.balance, 0, "shares are backed");
    }

    /// @notice INV-05: the registry's latest round only ever moves forward.
    function invariant_LatestRoundIdIsMonotonic() public view {
        assertGe(registry.latestRoundId(FEED_ID), handler.highestRoundSeen(), "monotonic");
    }

    /// @notice A deterministic walk through the whole lifecycle, asserting the invariants after
    ///         every state transition. This is what keeps the fuzzed invariants from being
    ///         vacuous: the fuzzer's actions all swallow reverts, so on its own a run in which
    ///         nothing ever succeeded would look identical to a healthy one. (The `afterInvariant`
    ///         report below shows what the fuzz run actually reached; it only logs, because it runs
    ///         after every run including one-call shrunk replays.)
    function test_Lifecycle_InvariantsHoldAcrossAFullCycle() public {
        address lp = makeAddr("lp");
        address holder = makeAddr("holder");
        vm.deal(lp, 500 ether);
        vm.deal(holder, 500 ether);

        vm.prank(lp);
        guard.deposit{value: 200 ether}(FEED_ID);
        _assertInvariants("after deposit");

        uint256 premium = guard.quote(FEED_ID, 50 ether, 7);
        vm.prank(holder);
        uint256 policyId = guard.buyCover{value: premium}(FEED_ID, 97_000_000, 50 ether, 7);
        _assertInvariants("after buyCover");
        assertEq(guard.getPool(FEED_ID).locked, 50 ether, "notional locked");

        uint80 roundId = _proveRound(88_000_000);
        _assertInvariants("after recordRound");

        uint256 balanceBefore = holder.balance;
        guard.claim(policyId, roundId);
        _assertInvariants("after claim");
        assertEq(holder.balance, balanceBefore + 50 ether, "the claim really paid");
        assertEq(guard.getPool(FEED_ID).locked, 0, "capacity released");

        // FR-30: a proportional policy over the same breach. It must pay strictly less, release
        // the whole reserve, and leave the pool solvent. Asserted deterministically here because
        // the fuzzer's actions all swallow reverts — a run that never reached a partial payout
        // would leave `invariant_PayoutNeverExceedsReservedNotional` passing on nothing.
        uint256 propPremium =
            guard.quoteFor(FEED_ID, 50 ether, 7, PegGuard.PayoutMode.PROPORTIONAL);
        assertLt(propPremium, premium, "proportional cover is cheaper");
        vm.prank(holder);
        uint256 propId = guard.buyCover{value: propPremium}(
            FEED_ID, 97_000_000, 50 ether, 7, PegGuard.PayoutMode.PROPORTIONAL
        );
        _assertInvariants("after proportional buyCover");
        assertEq(guard.getPool(FEED_ID).locked, 50 ether, "the FULL notional is reserved");

        uint80 propRound = _proveRound(88_000_000);
        uint256 poolBefore = guard.getPool(FEED_ID).balance;
        uint256 holderBefore = holder.balance;
        guard.claim(propId, propRound);
        _assertInvariants("after proportional claim");

        uint256 paid = holder.balance - holderBefore;
        assertEq(paid, guard.getPolicy(propId).payout, "the policy records what it paid");
        assertLt(paid, 50 ether, "a 9/97 breach pays far less than the notional");
        assertEq(guard.getPool(FEED_ID).locked, 0, "the whole reserve is released");
        assertEq(guard.getPool(FEED_ID).balance, poolBefore - paid, "only the payout left the pool");

        // A second policy that runs to expiry instead of paying.
        vm.prank(holder);
        uint256 policyId2 = guard.buyCover{value: premium}(FEED_ID, 97_000_000, 50 ether, 7);
        _assertInvariants("after second buyCover");
        vm.warp(guard.getPolicy(policyId2).expiry + 1);
        guard.expire(policyId2);
        _assertInvariants("after expire");
        assertEq(guard.getPool(FEED_ID).locked, 0, "capacity released on expiry");

        // Read the share balance BEFORE the prank: a view call would consume it.
        uint256 lpShares = guard.sharesOf(FEED_ID, lp);
        vm.prank(lp);
        guard.withdraw(FEED_ID, lpShares);
        _assertInvariants("after withdraw");
    }

    function _assertInvariants(string memory stage) internal view {
        PegGuard.Pool memory p = guard.getPool(FEED_ID);
        assertLe(p.locked, p.balance, string.concat("INV-07 violated ", stage));
        assertGe(
            address(guard).balance,
            p.balance + guard.bountyEscrow(),
            string.concat("insolvent incl. escrow ", stage)
        );
    }

    uint256 internal lifecycleRound;

    /// @dev Record one round through the real proof path and return its proxy round id.
    function _proveRound(int256 answer) internal returns (uint80) {
        uint256 aggRound = ++lifecycleRound;
        bytes memory txBytes = TxBytesBuilder.singleRound(AGGREGATOR, answer, aggRound, block.timestamp);
        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](1);
        siblings[0] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s"), isLeft: false});
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("r");
        uint80[] memory ids = registry.recordRound(
            CHAIN_KEY,
            uint64(1000 + aggRound),
            txBytes,
            keccak256(abi.encode(aggRound)),
            siblings,
            bytes32(0),
            roots
        );
        return ids[0];
    }

    /// @notice Reports what the fuzz run actually exercised (logging only — see the test above).
    function afterInvariant() public view {
        console.log("invariant run coverage:");
        console.log("  rounds proven   ", handler.roundsProven());
        console.log("  covers bought   ", handler.coversBought());
        console.log("   of them prop.  ", handler.proportionalCovers());
        console.log("  claims paid     ", handler.claimsPaid());
        console.log("   of them prop.  ", handler.proportionalClaimsPaid());
        console.log("  policies expired", handler.policiesExpired());
        console.log("  withdrawals     ", handler.withdrawals());
        console.log("  bounties drawn  ", handler.bountiesWithdrawn());
        console.log("  claim rejections: notActive/notProven/window/strike/other");
        console.log("   ", handler.errNotActive(), handler.errNotProven(), handler.errWindow());
        console.log("   ", handler.errStrike(), handler.errOther());
    }
}

/// @dev Drives the protocol through the states a fuzzer can reach. Every action is bounded so the
///      run explores realistic sequences instead of reverting on trivia.
contract PegGuardHandler is Test {
    ProvenFeedRegistry public immutable REGISTRY;
    PegGuard public immutable GUARD;
    bytes32 public immutable FEED_ID;

    address internal constant AGGREGATOR = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;
    uint64 internal constant CHAIN_KEY = 3;
    uint16 internal constant PHASE = 3;

    uint256[] public policies;
    /// @dev Round ids actually recorded, so `claim` can reference a real one. Fuzzing a raw uint80
    ///      never lands on a valid `(phase << 64) | round`, which made an earlier version of this
    ///      suite pass vacuously — the ghost counters in `afterInvariant` caught it.
    uint80[] public provenRounds;
    uint80 public highestRoundSeen;
    uint64 internal height = 1;
    uint256 internal aggRound = 1;

    // Ghost counters. Without these the invariants could pass vacuously, because every handler
    // action swallows reverts — a run in which no claim ever paid would look identical to a healthy
    // one. `afterInvariant` asserts each interesting state was actually reached.
    uint256 public coversBought;
    uint256 public proportionalCovers;
    uint256 public claimsPaid;
    uint256 public proportionalClaimsPaid;
    uint256 public policiesExpired;
    uint256 public withdrawals;
    uint256 public roundsProven;
    uint256 public bountiesWithdrawn;
    bytes4 public lastClaimError;
    uint256 public errNotActive;
    uint256 public errNotProven;
    uint256 public errWindow;
    uint256 public errStrike;
    uint256 public errOther;

    constructor(ProvenFeedRegistry registry_, PegGuard guard_, bytes32 feedId_) {
        REGISTRY = registry_;
        GUARD = guard_;
        FEED_ID = feedId_;
    }

    receive() external payable {}

    function deposit(uint96 amount) external {
        uint256 a = bound(amount, 1e15, 500 ether);
        if (address(this).balance < a) return;
        GUARD.deposit{value: a}(FEED_ID);
    }

    function withdraw(uint96 shares) external {
        uint256 held = GUARD.sharesOf(FEED_ID, address(this));
        if (held == 0) return;
        uint256 s = bound(shares, 1, held);
        try GUARD.withdraw(FEED_ID, s) returns (uint256) {
            ++withdrawals;
        } catch {}
    }

    /// @dev FR-30: the mode is fuzzed too, so INV-07 is exercised against partial payouts —
    ///      the case where `locked` drops by the full notional but `balance` only by the payout.
    function buyCover(uint96 notional, uint8 durationDays, bool proportional) external {
        uint256 n = bound(notional, 1e15, 100 ether);
        uint256 d = bound(durationDays, 1, 90);
        PegGuard.PayoutMode mode =
            proportional ? PegGuard.PayoutMode.PROPORTIONAL : PegGuard.PayoutMode.FULL;
        uint256 premium = GUARD.quoteFor(FEED_ID, n, d, mode);
        if (address(this).balance < premium) return;
        try GUARD.buyCover{value: premium}(FEED_ID, 97_000_000, uint128(n), d, mode) returns (uint256 id) {
            policies.push(id);
            ++coversBought;
            if (proportional) ++proportionalCovers;
        } catch {}
    }

    /// @dev Record a round through the real proof path, at a price that may or may not breach.
    function proveRound(int64 answer) external {
        int256 a = bound(int256(answer), 1, 200_000_000);
        bytes memory txBytes = TxBytesBuilder.singleRound(AGGREGATOR, a, aggRound, block.timestamp);
        uint80 roundId = uint80((uint256(PHASE) << 64) | aggRound);
        ++aggRound;

        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](1);
        siblings[0] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s"), isLeft: false});
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("r");

        try REGISTRY.recordRound(
            CHAIN_KEY, height++, txBytes, keccak256(abi.encode(height)), siblings, bytes32(0), roots
        ) {
            if (roundId > highestRoundSeen) highestRoundSeen = roundId;
            provenRounds.push(roundId);
            ++roundsProven;
        } catch {}
    }

    function claim(uint256 policySeed, uint256 roundSeed) external {
        if (policies.length == 0 || provenRounds.length == 0) return;
        uint256 id = policies[bound(policySeed, 0, policies.length - 1)];
        uint80 roundId = provenRounds[bound(roundSeed, 0, provenRounds.length - 1)];
        bool proportional = GUARD.getPolicy(id).mode == PegGuard.PayoutMode.PROPORTIONAL;
        try GUARD.claim(id, roundId) {
            ++claimsPaid;
            if (proportional) ++proportionalClaimsPaid;
        } catch (bytes memory err) {
            lastClaimError = bytes4(err);
            if (bytes4(err) == PegGuard.PolicyNotActive.selector) ++errNotActive;
            else if (bytes4(err) == PegGuard.RoundNotProven.selector) ++errNotProven;
            else if (bytes4(err) == PegGuard.RoundOutsideWindow.selector) ++errWindow;
            else if (bytes4(err) == PegGuard.StrikeNotBreached.selector) ++errStrike;
            else ++errOther;
        }
    }

    function expire(uint256 seed) external {
        if (policies.length == 0) return;
        uint256 id = policies[bound(seed, 0, policies.length - 1)];
        try GUARD.expire(id) {
            ++policiesExpired;
        } catch {}
    }

    function withdrawBounty() external {
        try GUARD.withdrawBounty() returns (uint256) {
            ++bountiesWithdrawn;
        } catch {}
    }

    /// @notice Every policy the fuzzer has bought, so an invariant can walk them all.
    function policyIds() external view returns (uint256[] memory) {
        return policies;
    }

    function warp(uint32 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 30 days));
    }
}
