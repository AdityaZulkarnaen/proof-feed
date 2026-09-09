// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {BaseTest, ProofFixture} from "./BaseTest.t.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {PegGuard} from "../src/PegGuard.sol";

/// @notice PegGuard money paths. Registry state is produced by recording the REAL captured mainnet
///         proofs, so a claim in these tests settles against the same bytes the demo settles on.
contract PegGuardTest is BaseTest {
    PegGuard internal guard;

    address internal lp = makeAddr("lp");
    address internal lp2 = makeAddr("lp2");
    address internal holder = makeAddr("holder");

    uint16 internal constant PREMIUM_BPS_30D = 50; // 0.50% per 30 days
    uint32 internal constant WAITING_PERIOD = 0; // demo setting (D-06)
    uint128 internal constant MAX_NOTIONAL = 100 ether;
    int256 internal constant STRIKE_097 = 97_000_000; // $0.97 on an 8-decimal feed
    uint16 internal constant BOUNTY_BPS = 2_000; // 20% of the premium goes to the prover (FR-20)
    uint16 internal constant PROPORTIONAL_BPS_30D = 30; // 0.30% per 30 days — FR-30 pays less, so it costs less

    function setUp() public override {
        super.setUp();
        guard = new PegGuard(IProvenFeedRegistry(address(registry)), owner);
        vm.prank(owner);
        guard.configurePool(
            USDC_FEED_ID, PREMIUM_BPS_30D, WAITING_PERIOD, MAX_NOTIONAL, true, BOUNTY_BPS, PROPORTIONAL_BPS_30D
        );

        vm.deal(lp, 1000 ether);
        vm.deal(lp2, 1000 ether);
        vm.deal(holder, 1000 ether);
        vm.deal(keeper, 10 ether);
    }

    // ── T-P01…T-P02: liquidity ───────────────────────────────────────────────────────────────────

    /// T-P01
    function test_Deposit_MintsProportionalShares() public {
        vm.prank(lp);
        uint256 s1 = guard.deposit{value: 200 ether}(USDC_FEED_ID);
        assertEq(s1, 200 ether, "first deposit mints 1:1");

        vm.prank(lp2);
        uint256 s2 = guard.deposit{value: 100 ether}(USDC_FEED_ID);
        assertEq(s2, 100 ether, "second deposit prices off the pre-deposit balance");

        PegGuard.Pool memory p = guard.getPool(USDC_FEED_ID);
        assertEq(p.balance, 300 ether, "pool balance");
        assertEq(p.totalShares, 300 ether, "total shares");
        assertEq(guard.sharesOf(USDC_FEED_ID, lp), 200 ether, "lp shares");
    }

    /// @dev Premiums accrue to the pool, so later depositors buy in at a higher share price.
    function test_Deposit_SharePriceRisesWithPremiums() public {
        _seedPool(200 ether);
        _buyCover(50 ether, 30);

        uint256 premium = guard.quote(USDC_FEED_ID, 50 ether, 30);
        uint256 bounty = guard.quoteBounty(USDC_FEED_ID, 50 ether, 30);
        vm.prank(lp2);
        uint256 s2 = guard.deposit{value: 100 ether}(USDC_FEED_ID);

        // 100 CTC now buys fewer shares, because the pool is worth 200 plus the premium it kept.
        // The escrowed bounty never enters the pool, so it does not dilute anyone.
        assertEq(
            s2,
            (100 ether * 200 ether) / (200 ether + premium - bounty),
            "diluted by the premium the pool actually kept"
        );
        assertLt(s2, 100 ether, "later LPs get fewer shares per CTC");
    }

    function test_Deposit_RevertsOnZeroValue() public {
        vm.prank(lp);
        vm.expectRevert(PegGuard.ZeroAmount.selector);
        guard.deposit{value: 0}(USDC_FEED_ID);
    }

    function test_Deposit_RevertsForUnregisteredFeed() public {
        bytes32 unknown = keccak256("NOPE / USD");
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.UnknownFeed.selector, unknown));
        guard.deposit{value: 1 ether}(unknown);
    }

    /// T-P02 / INV-07
    function test_Withdraw_RespectsLockedLiquidity() public {
        _seedPool(200 ether);
        _buyCover(90 ether, 30);

        uint256 premium = guard.quote(USDC_FEED_ID, 90 ether, 30);
        uint256 bounty = guard.quoteBounty(USDC_FEED_ID, 90 ether, 30);
        uint256 poolPremium = premium - bounty;
        uint256 free = 200 ether + poolPremium - 90 ether;

        // Asking for all shares would pull more than the free liquidity.
        vm.prank(lp);
        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.InsufficientLiquidity.selector, free, 200 ether + poolPremium)
        );
        guard.withdraw(USDC_FEED_ID, 200 ether);

        // Withdrawing only the free part succeeds.
        uint256 shares = (free * 200 ether) / (200 ether + poolPremium);
        vm.prank(lp);
        uint256 got = guard.withdraw(USDC_FEED_ID, shares);
        assertLe(got, free, "never more than the free liquidity");

        PegGuard.Pool memory p = guard.getPool(USDC_FEED_ID);
        assertGe(p.balance, p.locked, "INV-07 holds after withdrawal");
    }

    /// @notice A claim reduces the pool balance without burning shares, so a pool can be drained to
    ///         exactly zero while shares are still outstanding. Pricing a new deposit against that
    ///         divides by zero. It must revert with a real error, never a panic.
    function test_Deposit_RevertsCleanlyWhenThePoolWasFullyPaidOut() public {
        // A zero-premium pool is what makes the balance land on exactly zero after a full payout.
        vm.prank(owner);
        guard.configurePool(USDC_FEED_ID, 0, WAITING_PERIOD, MAX_NOTIONAL, true, 0, 0);

        vm.prank(lp);
        guard.deposit{value: 50 ether}(USDC_FEED_ID);

        vm.warp(DEPEG_UPDATED_AT - 1 days);
        vm.prank(holder);
        uint256 policyId = guard.buyCover{value: 0}(USDC_FEED_ID, STRIKE_097, 50 ether, 7);

        _record(_loadFixture(FIXTURE_DEPEG));
        guard.claim(policyId, DEPEG_ROUND_ID);

        PegGuard.Pool memory p = guard.getPool(USDC_FEED_ID);
        assertEq(p.balance, 0, "pool drained to exactly zero");
        assertGt(p.totalShares, 0, "but shares are still outstanding");

        vm.prank(lp2);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.PoolWipedOut.selector, USDC_FEED_ID));
        guard.deposit{value: 1 ether}(USDC_FEED_ID);

        // The escape hatch: burn the worthless shares, then the pool works again.
        uint256 lpShares = guard.sharesOf(USDC_FEED_ID, lp);
        vm.prank(lp);
        assertEq(guard.withdraw(USDC_FEED_ID, lpShares), 0, "worthless shares redeem for nothing");

        vm.prank(lp2);
        assertEq(guard.deposit{value: 1 ether}(USDC_FEED_ID), 1 ether, "pool accepts liquidity again");
    }

    function test_Withdraw_RevertsWhenBurningMoreSharesThanHeld() public {
        _seedPool(10 ether);
        vm.prank(lp2);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InsufficientLiquidity.selector, 0, 1 ether));
        guard.withdraw(USDC_FEED_ID, 1 ether);
    }

    function test_Withdraw_PaysOutAndBurnsShares() public {
        _seedPool(100 ether);
        uint256 before = lp.balance;
        vm.prank(lp);
        uint256 amount = guard.withdraw(USDC_FEED_ID, 40 ether);
        assertEq(amount, 40 ether, "1:1 with no premiums accrued");
        assertEq(lp.balance, before + 40 ether, "CTC received");
        assertEq(guard.sharesOf(USDC_FEED_ID, lp), 60 ether, "shares burned");
    }

    // ── T-P03…T-P06: pricing and purchase ────────────────────────────────────────────────────────

    /// T-P03: 50 bps per 30 days, 30 days, 100 CTC notional -> 0.5 CTC.
    function test_Quote_Formula() public view {
        assertEq(guard.quote(USDC_FEED_ID, 100 ether, 30), 0.5 ether, "30-day premium");
        assertEq(guard.quote(USDC_FEED_ID, 100 ether, 15), 0.25 ether, "half the duration, half the premium");
        assertEq(guard.quote(USDC_FEED_ID, 50 ether, 30), 0.25 ether, "half the notional, half the premium");
    }

    function test_Quote_RevertsOnInvalidDuration() public {
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InvalidDuration.selector, 0));
        guard.quote(USDC_FEED_ID, 1 ether, 0);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InvalidDuration.selector, 366));
        guard.quote(USDC_FEED_ID, 1 ether, 366);
    }

    /// T-P04
    function test_BuyCover_LocksNotionalAndStoresPolicy() public {
        _seedPool(200 ether);
        uint256 policyId = _buyCover(50 ether, 7);

        PegGuard.Policy memory p = guard.getPolicy(policyId);
        assertEq(p.holder, holder, "holder");
        assertEq(p.notional, 50 ether, "notional");
        assertEq(p.strike, STRIKE_097, "strike");
        assertEq(uint8(p.status), uint8(PegGuard.Status.ACTIVE), "active");
        assertEq(p.start, uint64(block.timestamp) + WAITING_PERIOD, "start");
        assertEq(p.expiry, p.start + 7 days, "expiry");

        assertEq(guard.getPool(USDC_FEED_ID).locked, 50 ether, "notional locked");
        // FR-20: the prover bounty is carved out of the premium and escrowed, so it is not pool
        // capacity. Only the remainder underwrites.
        uint256 bounty = guard.quoteBounty(USDC_FEED_ID, 50 ether, 7);
        assertEq(
            guard.available(USDC_FEED_ID),
            200 ether + p.premiumPaid - bounty - 50 ether,
            "capacity reduced by the notional, and by the escrowed bounty"
        );
    }

    /// T-P05
    function test_BuyCover_RevertsOnWrongPremium() public {
        _seedPool(200 ether);
        uint256 expected = guard.quote(USDC_FEED_ID, 50 ether, 7);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.WrongPremium.selector, expected, expected - 1));
        guard.buyCover{value: expected - 1}(USDC_FEED_ID, STRIKE_097, 50 ether, 7);
    }

    /// T-P06
    function test_BuyCover_RevertsOnInsufficientCapacity() public {
        _seedPool(10 ether);
        uint256 premium = guard.quote(USDC_FEED_ID, 50 ether, 7);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InsufficientCapacity.selector, 10 ether, 50 ether));
        guard.buyCover{value: premium}(USDC_FEED_ID, STRIKE_097, 50 ether, 7);
    }

    function test_BuyCover_RevertsWhenPoolInactive() public {
        _seedPool(200 ether);
        vm.prank(owner);
        guard.configurePool(
            USDC_FEED_ID, PREMIUM_BPS_30D, WAITING_PERIOD, MAX_NOTIONAL, false, BOUNTY_BPS, PROPORTIONAL_BPS_30D
        );
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.PoolInactive.selector, USDC_FEED_ID));
        guard.buyCover{value: 1 ether}(USDC_FEED_ID, STRIKE_097, 50 ether, 7);
    }

    function test_BuyCover_RevertsOnInvalidStrikeOrNotional() public {
        _seedPool(200 ether);
        uint256 premium = guard.quote(USDC_FEED_ID, 50 ether, 7);

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InvalidStrike.selector, int256(0)));
        guard.buyCover{value: premium}(USDC_FEED_ID, 0, 50 ether, 7);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.InvalidNotional.selector, uint256(0), uint256(MAX_NOTIONAL))
        );
        guard.buyCover{value: 0}(USDC_FEED_ID, STRIKE_097, 0, 7);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                PegGuard.InvalidNotional.selector, uint256(MAX_NOTIONAL) + 1, uint256(MAX_NOTIONAL)
            )
        );
        guard.buyCover{value: 1 ether}(USDC_FEED_ID, STRIKE_097, MAX_NOTIONAL + 1, 7);
    }

    function test_ConfigurePool_OnlyOwnerAndKnownFeed() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        guard.configurePool(USDC_FEED_ID, 1, 0, 1 ether, true, 0, 0);

        bytes32 unknown = keccak256("NOPE / USD");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.UnknownFeed.selector, unknown));
        guard.configurePool(unknown, 1, 0, 1 ether, true, 0, 0);
    }

    // ── T-P07…T-P13: claims ──────────────────────────────────────────────────────────────────────

    /// T-P07: the flagship path — the real 2023 depeg round pays a real policy.
    function test_Claim_PaysHolderWhenRoundBelowStrikeInsideWindow() public {
        uint256 policyId = _policyCoveringTheDepeg();
        _record(_loadFixture(FIXTURE_DEPEG));

        uint256 before = holder.balance;
        vm.expectEmit(true, true, true, true, address(guard));
        emit PegGuard.ClaimPaid(policyId, DEPEG_ROUND_ID, holder, 50 ether, 0, keeper);
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(holder.balance, before + 50 ether, "holder paid the full notional");

        PegGuard.Policy memory p = guard.getPolicy(policyId);
        assertEq(uint8(p.status), uint8(PegGuard.Status.CLAIMED), "claimed");
        assertEq(p.claimRoundId, DEPEG_ROUND_ID, "records which round paid");

        PegGuard.Pool memory pool = guard.getPool(USDC_FEED_ID);
        assertEq(pool.locked, 0, "capacity released");
        assertGe(pool.balance, pool.locked, "INV-07");
    }

    /// T-P08
    function test_Claim_RevertsWhenRoundNotProven() public {
        uint256 policyId = _policyCoveringTheDepeg();
        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.RoundNotProven.selector, USDC_FEED_ID, DEPEG_ROUND_ID)
        );
        guard.claim(policyId, DEPEG_ROUND_ID);
    }

    /// T-P09: the waiting period exists so cover cannot be bought after a depeg has already printed.
    function test_Claim_RevertsWhenRoundBeforeStart() public {
        _seedPool(200 ether);
        // Coverage starts strictly after the depeg round's timestamp.
        vm.warp(DEPEG_UPDATED_AT + 1);
        uint256 policyId = _buyCover(50 ether, 7);
        _record(_loadFixture(FIXTURE_DEPEG));

        PegGuard.Policy memory p = guard.getPolicy(policyId);
        vm.expectRevert(
            abi.encodeWithSelector(
                PegGuard.RoundOutsideWindow.selector, DEPEG_UPDATED_AT, p.start, p.expiry
            )
        );
        guard.claim(policyId, DEPEG_ROUND_ID);
    }

    /// T-P10
    function test_Claim_RevertsWhenRoundAfterExpiry() public {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 30 days);
        uint256 policyId = _buyCover(50 ether, 7); // expires well before the depeg
        _record(_loadFixture(FIXTURE_DEPEG));

        PegGuard.Policy memory p = guard.getPolicy(policyId);
        vm.expectRevert(
            abi.encodeWithSelector(
                PegGuard.RoundOutsideWindow.selector, DEPEG_UPDATED_AT, p.start, p.expiry
            )
        );
        guard.claim(policyId, DEPEG_ROUND_ID);
    }

    /// T-P11: the live round ($0.99988765) is above the strike, so it must not pay.
    function test_Claim_RevertsWhenAnswerNotBelowStrike() public {
        _seedPool(200 ether);
        vm.warp(LIVE_UPDATED_AT - 1 days);
        uint256 policyId = _buyCover(50 ether, 7);
        _record(_loadFixture(FIXTURE_LIVE));

        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.StrikeNotBreached.selector, LIVE_ANSWER, STRIKE_097)
        );
        guard.claim(policyId, LIVE_ROUND_ID);
    }

    /// T-P11 (boundary): equal to the strike is NOT below it.
    function test_Claim_RevertsWhenAnswerExactlyEqualsStrike() public {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 1 days);
        uint256 premium = guard.quote(USDC_FEED_ID, 50 ether, 7);
        vm.prank(holder);
        uint256 policyId = guard.buyCover{value: premium}(USDC_FEED_ID, DEPEG_ANSWER, 50 ether, 7);
        _record(_loadFixture(FIXTURE_DEPEG));

        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.StrikeNotBreached.selector, DEPEG_ANSWER, DEPEG_ANSWER)
        );
        guard.claim(policyId, DEPEG_ROUND_ID);
    }

    /// T-P12
    function test_Claim_CannotBeClaimedTwice() public {
        uint256 policyId = _policyCoveringTheDepeg();
        _record(_loadFixture(FIXTURE_DEPEG));
        guard.claim(policyId, DEPEG_ROUND_ID);

        vm.expectRevert(abi.encodeWithSelector(PegGuard.PolicyNotActive.selector, policyId));
        guard.claim(policyId, DEPEG_ROUND_ID);
    }

    /// T-P13 / INV-09: anyone may call; the money always goes to the holder.
    function test_Claim_AnyoneCanCallPayoutGoesToHolder() public {
        uint256 policyId = _policyCoveringTheDepeg();
        _record(_loadFixture(FIXTURE_DEPEG));

        uint256 holderBefore = holder.balance;
        uint256 strangerBefore = stranger.balance;

        vm.prank(stranger);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(holder.balance, holderBefore + 50 ether, "holder paid");
        assertEq(stranger.balance, strangerBefore, "caller gains nothing");
    }

    function test_Claim_RevertsForUnknownPolicy() public {
        vm.expectRevert(abi.encodeWithSelector(PegGuard.UnknownPolicy.selector, uint256(42)));
        guard.claim(42, DEPEG_ROUND_ID);
    }

    // ── T-P14: proveAndClaim atomicity ───────────────────────────────────────────────────────────

    /// @notice The single-transaction demo path: prove the depeg round and get paid at once.
    function test_ProveAndClaim_ProvesAndPaysInOneTransaction() public {
        uint256 policyId = _policyCoveringTheDepeg();
        ProofFixture memory f = _loadFixture(FIXTURE_DEPEG);

        uint256 before = holder.balance;
        vm.prank(keeper);
        uint80[] memory ids = guard.proveAndClaim(
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

        assertEq(ids[0], DEPEG_ROUND_ID, "round recorded");
        assertEq(holder.balance, before + 50 ether, "and paid, same transaction");
        assertTrue(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).exists, "round persisted");
    }

    /// T-P14 / INV-10: if the claim fails, the round is NOT recorded either.
    function test_ProveAndClaim_AtomicRevertLeavesNoRound() public {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT + 1); // window starts after the round -> claim must fail
        uint256 policyId = _buyCover(50 ether, 7);

        ProofFixture memory f = _loadFixture(FIXTURE_DEPEG);
        PegGuard.Policy memory p = guard.getPolicy(policyId);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                PegGuard.RoundOutsideWindow.selector, DEPEG_UPDATED_AT, p.start, p.expiry
            )
        );
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

        assertFalse(registry.getRound(USDC_FEED_ID, DEPEG_ROUND_ID).exists, "no partial state");
    }

    /// @notice Proving a transaction that does not contain the claimed round must fail loudly.
    function test_ProveAndClaim_RevertsWhenProofLacksTheClaimedRound() public {
        uint256 policyId = _policyCoveringTheDepeg();
        ProofFixture memory f = _loadFixture(FIXTURE_LIVE); // proves round 1178, not 983

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.RoundNotInProof.selector, DEPEG_ROUND_ID));
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
    }

    // ── T-P15: expiry ────────────────────────────────────────────────────────────────────────────

    /// T-P15
    function test_Expire_UnlocksCapacityOnlyAfterExpiry() public {
        _seedPool(200 ether);
        uint256 policyId = _buyCover(50 ether, 7);
        PegGuard.Policy memory p = guard.getPolicy(policyId);

        vm.expectRevert(abi.encodeWithSelector(PegGuard.NotExpired.selector, policyId, p.expiry));
        guard.expire(policyId);

        vm.warp(p.expiry + 1);
        vm.prank(stranger); // anyone may call
        guard.expire(policyId);

        assertEq(guard.getPool(USDC_FEED_ID).locked, 0, "capacity released");
        assertEq(uint8(guard.getPolicy(policyId).status), uint8(PegGuard.Status.EXPIRED), "expired");
    }

    function test_Expire_CannotRunTwiceAndBlocksLaterClaims() public {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 1 days);
        uint256 policyId = _buyCover(50 ether, 7);
        _record(_loadFixture(FIXTURE_DEPEG));

        vm.warp(guard.getPolicy(policyId).expiry + 1);
        guard.expire(policyId);

        vm.expectRevert(abi.encodeWithSelector(PegGuard.PolicyNotActive.selector, policyId));
        guard.expire(policyId);

        vm.expectRevert(abi.encodeWithSelector(PegGuard.PolicyNotActive.selector, policyId));
        guard.claim(policyId, DEPEG_ROUND_ID);
    }

    // ── T-S05: reentrancy ────────────────────────────────────────────────────────────────────────

    /// T-S05: a malicious holder cannot re-enter during its payout.
    function test_Claim_ReentrantHolderIsRejected() public {
        _seedPool(200 ether);
        ReentrantHolder attacker = new ReentrantHolder(guard);
        vm.deal(address(attacker), 10 ether);

        vm.warp(DEPEG_UPDATED_AT - 1 days);
        uint256 premium = guard.quote(USDC_FEED_ID, 50 ether, 7);
        uint256 policyId = attacker.buy{value: premium}(USDC_FEED_ID, STRIKE_097, 50 ether, 7, premium);
        _record(_loadFixture(FIXTURE_DEPEG));

        attacker.arm(policyId, DEPEG_ROUND_ID);
        // The payout call reverts inside the attacker's receive(), so the transfer fails.
        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.TransferFailed.selector, address(attacker), uint256(50 ether))
        );
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(uint8(guard.getPolicy(policyId).status), uint8(PegGuard.Status.ACTIVE), "no state change");
        assertEq(guard.getPool(USDC_FEED_ID).locked, 50 ether, "capacity still locked");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _seedPool(uint256 amount) internal {
        vm.prank(lp);
        guard.deposit{value: amount}(USDC_FEED_ID);
    }

    function _buyCover(uint128 notional, uint256 durationDays) internal returns (uint256) {
        uint256 premium = guard.quote(USDC_FEED_ID, notional, durationDays);
        vm.prank(holder);
        return guard.buyCover{value: premium}(USDC_FEED_ID, STRIKE_097, notional, durationDays);
    }

    /// @dev A funded policy whose window contains the 2023-03-11 depeg round.
    function _policyCoveringTheDepeg() internal returns (uint256 policyId) {
        _seedPool(200 ether);
        vm.warp(DEPEG_UPDATED_AT - 1 days);
        policyId = _buyCover(50 ether, 7);
    }
}

/// @dev Tries to re-enter `claim` while receiving its payout (T-S05).
contract ReentrantHolder {
    PegGuard private immutable GUARD;
    uint256 private policyId;
    uint80 private roundId;
    bool private armed;

    constructor(PegGuard guard_) {
        GUARD = guard_;
    }

    function buy(bytes32 feedId, int256 strike, uint128 notional, uint256 durationDays, uint256 premium)
        external
        payable
        returns (uint256)
    {
        return GUARD.buyCover{value: premium}(feedId, strike, notional, durationDays);
    }

    function arm(uint256 policyId_, uint80 roundId_) external {
        policyId = policyId_;
        roundId = roundId_;
        armed = true;
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        GUARD.claim(policyId, roundId);
    }
}
