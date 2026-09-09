// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./BaseTest.t.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {PegGuard} from "../src/PegGuard.sol";

/// @title ProportionalPayoutTest
/// @notice FR-30 — cover that pays the depth of the breach instead of the whole notional.
/// @dev The worked example throughout is the real one: strike $0.97, the proven 2023-03-11 USDC
///      round at $0.88, notional 50 CTC. The breach is 9/97 of the strike, so a proportional
///      policy pays 450/97 = 4.639175257731958762 CTC and hands the other ~45.36 back to the LPs.
///      Full cover would pay all 50. That gap is exactly why the two modes are priced differently.
contract ProportionalPayoutTest is BaseTest {
    PegGuard internal guard;

    address internal lp = makeAddr("lp");
    address internal holder = makeAddr("holder");

    uint16 internal constant PREMIUM_BPS_30D = 50; // 0.50% / 30d for full cover
    uint16 internal constant PROPORTIONAL_BPS_30D = 30; // 0.30% / 30d — pays less, costs less
    uint16 internal constant BOUNTY_BPS = 2_000;
    uint128 internal constant MAX_NOTIONAL = 100 ether;
    uint128 internal constant NOTIONAL = 50 ether;
    int256 internal constant STRIKE_097 = 97_000_000;

    /// @dev 50e18 × (97_000_000 − 88_000_000) / 97_000_000, floored.
    uint256 internal constant EXPECTED_PAYOUT = 4_639_175_257_731_958_762;

    function setUp() public override {
        super.setUp();
        guard = new PegGuard(IProvenFeedRegistry(address(registry)), owner);
        vm.prank(owner);
        guard.configurePool(
            USDC_FEED_ID, PREMIUM_BPS_30D, 0, MAX_NOTIONAL, true, BOUNTY_BPS, PROPORTIONAL_BPS_30D
        );

        vm.deal(lp, 1000 ether);
        vm.deal(holder, 1000 ether);
        vm.deal(keeper, 10 ether);
    }

    // ── T-P17…T-P19 · the payout formula ─────────────────────────────────────────────────────────

    /// T-P17: `payoutFor` is the whole rule, and it is pure so anyone can check it before buying.
    function test_PayoutFor_TracksTheDepthOfTheBreach() public view {
        assertEq(
            guard.payoutFor(PegGuard.PayoutMode.PROPORTIONAL, NOTIONAL, STRIKE_097, 88_000_000),
            EXPECTED_PAYOUT,
            "a 9-cent breach on a 97-cent strike pays 9/97 of the notional"
        );
        // A one-unit breach pays almost nothing; full cover would pay everything.
        assertEq(
            guard.payoutFor(PegGuard.PayoutMode.PROPORTIONAL, NOTIONAL, STRIKE_097, 96_999_999),
            (uint256(NOTIONAL) * 1) / 97_000_000,
            "a one-unit breach pays one 97-millionth"
        );
        assertEq(
            guard.payoutFor(PegGuard.PayoutMode.FULL, NOTIONAL, STRIKE_097, 96_999_999),
            NOTIONAL,
            "full cover is a trigger: any breach pays everything"
        );
    }

    /// T-P18: the payout is capped at the notional even when the print is zero or negative.
    function test_PayoutFor_IsCappedAtTheNotional() public view {
        assertEq(guard.payoutFor(PegGuard.PayoutMode.PROPORTIONAL, NOTIONAL, STRIKE_097, 0), NOTIONAL);
        assertEq(guard.payoutFor(PegGuard.PayoutMode.PROPORTIONAL, NOTIONAL, STRIKE_097, -1), NOTIONAL);
        assertEq(
            guard.payoutFor(PegGuard.PayoutMode.PROPORTIONAL, NOTIONAL, STRIKE_097, type(int256).min),
            NOTIONAL,
            "no int256 answer can make the pool pay more than it reserved"
        );
    }

    /// T-P19: no answer, for any strike and notional, can make a proportional policy overpay.
    function testFuzz_PayoutFor_NeverExceedsTheNotional(uint128 notional, int256 strike, int256 answer)
        public
        view
    {
        strike = int256(bound(strike, 1, type(int128).max));
        uint256 payout = guard.payoutFor(PegGuard.PayoutMode.PROPORTIONAL, notional, strike, answer);
        assertLe(payout, notional, "INV-07 depends on this: the reserve is always enough");
    }

    // ── T-P20…T-P22 · pricing ────────────────────────────────────────────────────────────────────

    /// T-P20: proportional cover is cheaper, because it pays less. Otherwise nobody would buy it.
    function test_QuoteFor_ProportionalCostsLessThanFull() public view {
        uint256 full = guard.quoteFor(USDC_FEED_ID, NOTIONAL, 30, PegGuard.PayoutMode.FULL);
        uint256 prop = guard.quoteFor(USDC_FEED_ID, NOTIONAL, 30, PegGuard.PayoutMode.PROPORTIONAL);

        assertEq(full, (uint256(NOTIONAL) * PREMIUM_BPS_30D) / 10_000, "0.50% of notional for 30 days");
        assertEq(prop, (uint256(NOTIONAL) * PROPORTIONAL_BPS_30D) / 10_000, "0.30% of notional");
        assertLt(prop, full, "the cheaper product is the one that pays less");
        assertEq(guard.quote(USDC_FEED_ID, NOTIONAL, 30), full, "quote() still means full cover");
    }

    /// T-P21: a pool that has not set a proportional rate does not write proportional cover —
    /// it must not silently sell it for nothing.
    function test_QuoteFor_RevertsWhenThePoolDoesNotOfferProportionalCover() public {
        vm.prank(owner);
        guard.configurePool(USDC_FEED_ID, PREMIUM_BPS_30D, 0, MAX_NOTIONAL, true, BOUNTY_BPS, 0);

        vm.expectRevert(abi.encodeWithSelector(PegGuard.ProportionalCoverUnavailable.selector, USDC_FEED_ID));
        guard.quoteFor(USDC_FEED_ID, NOTIONAL, 30, PegGuard.PayoutMode.PROPORTIONAL);

        _seedPool(200 ether);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.ProportionalCoverUnavailable.selector, USDC_FEED_ID));
        guard.buyCover{value: 0}(USDC_FEED_ID, STRIKE_097, NOTIONAL, 7, PegGuard.PayoutMode.PROPORTIONAL);
    }

    /// T-P22: the premium charged is the one for the mode actually bought.
    function test_BuyCover_ChargesTheProportionalPremium() public {
        _seedPool(200 ether);
        uint256 prop = guard.quoteFor(USDC_FEED_ID, NOTIONAL, 7, PegGuard.PayoutMode.PROPORTIONAL);
        uint256 full = guard.quoteFor(USDC_FEED_ID, NOTIONAL, 7, PegGuard.PayoutMode.FULL);

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.WrongPremium.selector, prop, full));
        guard.buyCover{value: full}(USDC_FEED_ID, STRIKE_097, NOTIONAL, 7, PegGuard.PayoutMode.PROPORTIONAL);

        vm.prank(holder);
        uint256 policyId =
            guard.buyCover{value: prop}(USDC_FEED_ID, STRIKE_097, NOTIONAL, 7, PegGuard.PayoutMode.PROPORTIONAL);

        PegGuard.Policy memory p = guard.getPolicy(policyId);
        assertEq(uint8(p.mode), uint8(PegGuard.PayoutMode.PROPORTIONAL), "the mode is stored on the policy");
        assertEq(p.premiumPaid, prop);
        assertEq(p.notional, NOTIONAL, "the notional is the maximum, not the expected payout");
    }

    // ── T-P23…T-P26 · settlement ─────────────────────────────────────────────────────────────────

    /// T-P23: the flagship proportional path — the real 2023 depeg round, paid in proportion.
    function test_Claim_ProportionalPaysTheBreachAndReturnsTheRest() public {
        uint256 policyId = _proportionalPolicyCoveringTheDepeg();
        _record(_loadFixture(FIXTURE_DEPEG));

        PegGuard.Pool memory poolBefore = guard.getPool(USDC_FEED_ID);
        uint256 holderBefore = holder.balance;

        vm.expectEmit(true, true, true, true, address(guard));
        emit PegGuard.ClaimPaid(
            policyId, DEPEG_ROUND_ID, holder, EXPECTED_PAYOUT, NOTIONAL - EXPECTED_PAYOUT, keeper
        );
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(holder.balance, holderBefore + EXPECTED_PAYOUT, "holder paid 9/97 of the notional");

        PegGuard.Policy memory p = guard.getPolicy(policyId);
        assertEq(uint8(p.status), uint8(PegGuard.Status.CLAIMED));
        assertEq(p.payout, EXPECTED_PAYOUT, "the policy records what it actually paid");
        assertEq(p.claimRoundId, DEPEG_ROUND_ID);

        PegGuard.Pool memory poolAfter = guard.getPool(USDC_FEED_ID);
        assertEq(poolAfter.locked, poolBefore.locked - NOTIONAL, "the WHOLE reserve unlocks");
        assertEq(poolAfter.balance, poolBefore.balance - EXPECTED_PAYOUT, "only the payout leaves");
        assertGe(poolAfter.balance, poolAfter.locked, "INV-07");
    }

    /// T-P24: the unpaid remainder is real, spendable liquidity again — not stranded.
    function test_Claim_ProportionalRemainderBecomesFreeLiquidityAgain() public {
        uint256 policyId = _proportionalPolicyCoveringTheDepeg();
        _record(_loadFixture(FIXTURE_DEPEG));
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        PegGuard.Pool memory pool = guard.getPool(USDC_FEED_ID);
        assertEq(guard.available(USDC_FEED_ID), pool.balance, "nothing is locked any more");

        // And an LP can actually take it out.
        uint256 shares = guard.sharesOf(USDC_FEED_ID, lp);
        uint256 before = lp.balance;
        vm.prank(lp);
        uint256 paid = guard.withdraw(USDC_FEED_ID, shares);
        assertEq(lp.balance, before + paid);
        assertGt(paid, 190 ether, "the LP kept most of the 200 CTC it staked");
    }

    /// T-P25: the contract still holds every wei it owes — pool balance plus bounty escrow.
    function test_Claim_ProportionalLeavesTheContractSolvent() public {
        uint256 policyId = _proportionalPolicyCoveringTheDepeg();
        _record(_loadFixture(FIXTURE_DEPEG));
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        PegGuard.Pool memory pool = guard.getPool(USDC_FEED_ID);
        assertEq(
            address(guard).balance,
            pool.balance + guard.bountyEscrow(),
            "no wei is unaccounted for after a partial payout"
        );
    }

    /// T-P26: the prover earns the whole bounty either way — the work was the same.
    function test_Claim_ProportionalStillPaysTheFullProverBounty() public {
        uint256 policyId = _proportionalPolicyCoveringTheDepeg();
        uint128 bounty = guard.getPolicy(policyId).proverBounty;
        assertGt(bounty, 0, "the pool escrows a bounty on proportional cover too");

        _record(_loadFixture(FIXTURE_DEPEG));
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(guard.bountyOwed(keeper), bounty, "the bounty is not scaled down by the payout");
    }

    // ── T-P27…T-P29 · edges ──────────────────────────────────────────────────────────────────────

    /// T-P27: a breach too shallow to pay one wei leaves the policy ACTIVE rather than burning it.
    /// @dev The holder can still claim on a deeper round later. Marking it CLAIMED for a zero
    ///      payout would destroy the cover for nothing.
    function test_Claim_ProportionalRevertsRatherThanSettlingForZero() public {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 1 days);

        // A notional so small that 9/97 of it floors to zero wei.
        uint128 dust = 10;
        uint256 premium = guard.quoteFor(USDC_FEED_ID, dust, 7, PegGuard.PayoutMode.PROPORTIONAL);
        vm.prank(holder);
        uint256 policyId =
            guard.buyCover{value: premium}(USDC_FEED_ID, STRIKE_097, dust, 7, PegGuard.PayoutMode.PROPORTIONAL);

        _record(_loadFixture(FIXTURE_DEPEG));

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.PayoutTooSmall.selector, DEPEG_ANSWER, STRIKE_097));
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(
            uint8(guard.getPolicy(policyId).status),
            uint8(PegGuard.Status.ACTIVE),
            "the cover survives to be claimed on a deeper round"
        );
    }

    /// T-P28: expiry releases the whole reserved notional, mode notwithstanding.
    function test_Expire_ProportionalReleasesTheFullReserve() public {
        uint256 policyId = _proportionalPolicyCoveringTheDepeg();
        PegGuard.Policy memory p = guard.getPolicy(policyId);

        vm.warp(p.expiry + 1);
        guard.expire(policyId);

        PegGuard.Pool memory pool = guard.getPool(USDC_FEED_ID);
        assertEq(pool.locked, 0, "the maximum exposure is what was reserved and what is released");
        assertEq(uint8(guard.getPolicy(policyId).status), uint8(PegGuard.Status.EXPIRED));
    }

    /// T-P29: full-payout cover is untouched by any of this (regression guard).
    function test_Claim_FullModeStillPaysTheWholeNotional() public {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 1 days);
        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.prank(holder);
        uint256 policyId = guard.buyCover{value: premium}(USDC_FEED_ID, STRIKE_097, NOTIONAL, 7);

        assertEq(uint8(guard.getPolicy(policyId).mode), uint8(PegGuard.PayoutMode.FULL), "the default");

        _record(_loadFixture(FIXTURE_DEPEG));
        uint256 before = holder.balance;
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(holder.balance, before + NOTIONAL, "unchanged behaviour");
        assertEq(guard.getPolicy(policyId).payout, NOTIONAL, "payout equals notional under FULL");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _seedPool(uint256 amount) internal {
        vm.prank(lp);
        guard.deposit{value: amount}(USDC_FEED_ID);
    }

    /// @dev A funded proportional policy whose window contains the 2023-03-11 depeg round.
    function _proportionalPolicyCoveringTheDepeg() internal returns (uint256 policyId) {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 1 days);
        uint256 premium = guard.quoteFor(USDC_FEED_ID, NOTIONAL, 7, PegGuard.PayoutMode.PROPORTIONAL);
        vm.prank(holder);
        policyId =
            guard.buyCover{value: premium}(USDC_FEED_ID, STRIKE_097, NOTIONAL, 7, PegGuard.PayoutMode.PROPORTIONAL);
    }
}
