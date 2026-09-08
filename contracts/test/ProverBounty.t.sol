// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest, ProofFixture} from "./BaseTest.t.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {PegGuard} from "../src/PegGuard.sol";
import {ProvenFeedRegistry} from "../src/ProvenFeedRegistry.sol";

/// @notice FR-20 — the prover bounty. A share of every premium is escrowed and paid to whoever
///         first proved the round that settled the policy, which is what makes running a keeper
///         worth someone's gas.
contract ProverBountyTest is BaseTest {
    PegGuard internal guard;

    address internal lp = makeAddr("lp");
    address internal holder = makeAddr("holder");
    address internal settler = makeAddr("settler");

    uint16 internal constant PREMIUM_BPS_30D = 50;
    uint16 internal constant BOUNTY_BPS = 2_000; // 20% of the premium
    uint128 internal constant MAX_NOTIONAL = 100 ether;
    int256 internal constant STRIKE_097 = 97_000_000;

    function setUp() public override {
        super.setUp();
        guard = new PegGuard(IProvenFeedRegistry(address(registry)), owner);
        vm.prank(owner);
        guard.configurePool(USDC_FEED_ID, PREMIUM_BPS_30D, 0, MAX_NOTIONAL, true, BOUNTY_BPS);

        vm.deal(lp, 1000 ether);
        vm.deal(holder, 1000 ether);
        vm.deal(keeper, 10 ether);
        vm.deal(settler, 10 ether);
    }

    function _seed() internal {
        vm.prank(lp);
        guard.deposit{value: 200 ether}(USDC_FEED_ID);
    }

    function _buy() internal returns (uint256 policyId, uint256 premium, uint256 bounty) {
        premium = guard.quote(USDC_FEED_ID, 50 ether, 7);
        bounty = guard.quoteBounty(USDC_FEED_ID, 50 ether, 7);
        vm.warp(DEPEG_UPDATED_AT - 1 days);
        vm.prank(holder);
        policyId = guard.buyCover{value: premium}(USDC_FEED_ID, STRIKE_097, 50 ether, 7);
    }

    // ── The split ────────────────────────────────────────────────────────────────────────────────

    /// The buyer's cost is unchanged: the bounty is carved OUT of the premium, never added on top.
    function test_Bounty_IsCarvedOutOfThePremiumNotAddedToIt() public {
        _seed();
        (, uint256 premium, uint256 bounty) = _buy();

        assertEq(bounty, (premium * BOUNTY_BPS) / 10_000, "bounty is the configured share");
        assertGt(bounty, 0, "a configured share actually escrows something");

        PegGuard.Pool memory p = guard.getPool(USDC_FEED_ID);
        assertEq(p.balance, 200 ether + premium - bounty, "pool receives the premium less the bounty");
        assertEq(guard.bountyEscrow(), bounty, "the rest is escrowed");
        assertEq(address(guard).balance, p.balance + bounty, "contract holds both");
    }

    /// Escrow is not pool liquidity, so it cannot be withdrawn by an LP.
    function test_Bounty_EscrowIsNotWithdrawableAsLiquidity() public {
        _seed();
        (,, uint256 bounty) = _buy();

        uint256 shares = guard.sharesOf(USDC_FEED_ID, lp);
        vm.prank(lp);
        guard.withdraw(USDC_FEED_ID, shares / 4);

        assertEq(guard.bountyEscrow(), bounty, "escrow untouched by an LP withdrawal");
        assertGe(address(guard).balance, guard.getPool(USDC_FEED_ID).balance + bounty, "still solvent");
    }

    // ── Who earns it ─────────────────────────────────────────────────────────────────────────────

    /// The bounty follows the work: the keeper who proved the round earns it, even though somebody
    /// else called `claim`.
    function test_Bounty_GoesToTheRoundsProverNotTheClaimCaller() public {
        _seed();
        (uint256 policyId,, uint256 bounty) = _buy();

        // `keeper` proves the round (BaseTest submits fixtures as `keeper`).
        _record(_loadFixture(FIXTURE_DEPEG));
        assertEq(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).prover, keeper, "keeper is on record");

        // A different address settles the policy.
        vm.expectEmit(true, true, false, true, address(guard));
        emit PegGuard.BountyAccrued(policyId, keeper, bounty);
        vm.prank(settler);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(guard.bountyOwed(keeper), bounty, "the prover earned it");
        assertEq(guard.bountyOwed(settler), 0, "the caller did not");
    }

    /// On the `proveAndClaim` path the registry records PegGuard as the prover, so the bounty falls
    /// through to the caller — who did prove it, in that same transaction.
    function test_Bounty_FallsThroughToCallerWhenPegGuardIsTheRecordedProver() public {
        _seed();
        (uint256 policyId,, uint256 bounty) = _buy();

        ProofFixture memory f = _loadFixture(FIXTURE_DEPEG);
        vm.prank(settler);
        guard.proveAndClaim(
            policyId,
            DEPEG_ROUND_ID,
            f.chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );

        assertEq(
            registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).prover,
            address(guard),
            "the registry records the contract on this path"
        );
        assertEq(guard.bountyOwed(settler), bounty, "so the human who paid the gas earns it");
        assertEq(guard.bountyOwed(address(guard)), 0, "never credited to the contract itself");
    }

    // ── Withdrawal ───────────────────────────────────────────────────────────────────────────────

    function test_Bounty_WithdrawPaysAndClearsTheLedger() public {
        _seed();
        (uint256 policyId,, uint256 bounty) = _buy();
        _record(_loadFixture(FIXTURE_DEPEG));
        guard.claim(policyId, DEPEG_ROUND_ID);

        uint256 before = keeper.balance;
        vm.prank(keeper);
        uint256 got = guard.withdrawBounty();

        assertEq(got, bounty, "paid in full");
        assertEq(keeper.balance, before + bounty, "CTC received");
        assertEq(guard.bountyOwed(keeper), 0, "ledger cleared");
        assertEq(guard.bountyEscrow(), 0, "escrow released");
    }

    function test_Bounty_WithdrawRevertsWhenNothingOwed() public {
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.NothingOwed.selector, settler));
        guard.withdrawBounty();
    }

    function test_Bounty_CannotBeWithdrawnTwice() public {
        _seed();
        (uint256 policyId,,) = _buy();
        _record(_loadFixture(FIXTURE_DEPEG));
        guard.claim(policyId, DEPEG_ROUND_ID);

        vm.prank(keeper);
        guard.withdrawBounty();

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.NothingOwed.selector, keeper));
        guard.withdrawBounty();
    }

    // ── Expiry ───────────────────────────────────────────────────────────────────────────────────

    /// Nobody proved a breaching round, so nobody earned the bounty: it goes back to the LPs who
    /// carried the risk rather than sitting in escrow forever.
    function test_Bounty_ReturnsToThePoolWhenThePolicyExpiresUnclaimed() public {
        _seed();
        (uint256 policyId,, uint256 bounty) = _buy();
        uint256 poolBefore = guard.getPool(USDC_FEED_ID).balance;

        vm.warp(guard.getPolicy(policyId).expiry + 1);
        vm.expectEmit(true, true, false, true, address(guard));
        emit PegGuard.BountyReleased(policyId, USDC_FEED_ID, bounty);
        guard.expire(policyId);

        assertEq(guard.getPool(USDC_FEED_ID).balance, poolBefore + bounty, "pool got it back");
        assertEq(guard.bountyEscrow(), 0, "escrow emptied");
    }

    // ── The griefing case ────────────────────────────────────────────────────────────────────────

    /// The reason the bounty is a pull payment. If `claim` pushed CTC to the prover, a prover
    /// contract that reverts on receive could hold every holder's payout hostage. Here the holder
    /// is paid in full and the hostile prover simply never collects.
    function test_Bounty_HostileProverCannotBlockTheHoldersPayout() public {
        _seed();
        (uint256 policyId,, uint256 bounty) = _buy();

        HostileProver hostile = new HostileProver();
        vm.deal(address(hostile), 1 ether);

        // The hostile contract proves the round, so it is the one on record.
        hostile.prove(registry, _loadFixture(FIXTURE_DEPEG));
        assertEq(
            registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).prover,
            address(hostile),
            "hostile contract is the recorded prover"
        );

        uint256 before = holder.balance;
        vm.prank(settler);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(holder.balance, before + 50 ether, "the holder was paid in full anyway");
        assertEq(guard.bountyOwed(address(hostile)), bounty, "the bounty is merely owed, not sent");

        // And the hostile contract cannot collect, which is its own problem, not the holder's.
        vm.expectRevert();
        hostile.collect(guard);
        assertEq(guard.bountyEscrow(), bounty, "escrow still held, holder unaffected");
    }

    // ── Configuration ────────────────────────────────────────────────────────────────────────────

    function test_Bounty_ShareIsCappedSoThePoolIsNeverUnderwritingForNothing() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InvalidBountyShare.selector, uint16(5_001)));
        guard.configurePool(USDC_FEED_ID, PREMIUM_BPS_30D, 0, MAX_NOTIONAL, true, 5_001);
    }

    function test_Bounty_ZeroShareBehavesExactlyAsBefore() public {
        vm.prank(owner);
        guard.configurePool(USDC_FEED_ID, PREMIUM_BPS_30D, 0, MAX_NOTIONAL, true, 0);
        _seed();
        (uint256 policyId, uint256 premium, uint256 bounty) = _buy();

        assertEq(bounty, 0, "nothing escrowed");
        assertEq(guard.bountyEscrow(), 0, "no escrow at all");
        assertEq(guard.getPool(USDC_FEED_ID).balance, 200 ether + premium, "whole premium to the pool");

        _record(_loadFixture(FIXTURE_DEPEG));
        guard.claim(policyId, DEPEG_ROUND_ID);
        assertEq(guard.bountyOwed(keeper), 0, "nothing accrued");
    }
}

/// @dev A prover that cannot receive CTC. Models the griefing vector the pull payment removes.
contract HostileProver {
    function prove(ProvenFeedRegistry registry, ProofFixture memory f) external {
        registry.recordRound(
            f.chainKey,
            f.blockHeight,
            f.encodedTransaction,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );
    }

    function collect(PegGuard guard) external {
        guard.withdrawBounty();
    }

    receive() external payable {
        revert("no");
    }
}
