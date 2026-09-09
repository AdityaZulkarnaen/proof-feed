// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {BaseTest} from "./BaseTest.t.sol";
import {TxBytesBuilder} from "./utils/TxBytesBuilder.sol";
import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {PegGuard} from "../src/PegGuard.sol";

/// @notice FR-33 — the underwriting bound on strikes.
/// @dev The hole this closes: a premium is `notional × rate × days`, with no term for how far the
///      strike sits from the market. Without a ceiling, anyone could name a strike above spot, pay
///      0.058 CTC and collect 50 CTC on the very next round — the pool would be drained by its
///      first customer. The ceiling is read from the latest *proven* answer, because that is the
///      only price this system has (INV-01), and that answer must be fresh enough to mean anything.
///
///      These tests use a real captured mainnet round as the reference, so the numbers below are
///      the numbers Chainlink actually printed.
contract StrikeGuardTest is BaseTest {
    PegGuard internal guard;

    address internal lp = makeAddr("lp");
    address internal holder = makeAddr("holder");

    uint16 internal constant PREMIUM_BPS_30D = 50;
    uint128 internal constant MAX_NOTIONAL = 100 ether;
    uint128 internal constant NOTIONAL = 50 ether;

    function setUp() public override {
        super.setUp();
        guard = new PegGuard(IProvenFeedRegistry(address(registry)), owner);
        vm.prank(owner);
        guard.configurePool(USDC_FEED_ID, PREMIUM_BPS_30D, 0, MAX_NOTIONAL, true, 2_000, 30);

        vm.deal(lp, 1000 ether);
        vm.deal(holder, 1000 ether);
        vm.prank(lp);
        guard.deposit{value: 200 ether}(USDC_FEED_ID);
    }

    // ── The ceiling itself ───────────────────────────────────────────────────────────────────────

    /// @dev A pool that has never been configured for strikes still gets the safe default.
    function test_StrikeCap_DefaultsToTheLatestProvenAnswer() public {
        _record(_loadFixture(FIXTURE_LIVE));
        assertEq(guard.strikeCap(USDC_FEED_ID), LIVE_ANSWER, "cap is the proven price, at the money");

        PegGuard.Pool memory p = guard.getPool(USDC_FEED_ID);
        assertEq(p.maxStrikeBps, 0, "unset");
        assertEq(p.maxReferenceAge, 0, "unset");
    }

    /// @dev The exploit, asserted as a rejection: cover that is already in the money cannot be sold.
    function test_BuyCover_RejectsAStrikeAboveTheLatestProvenPrice() public {
        _record(_loadFixture(FIXTURE_LIVE));

        int256 aboveSpot = LIVE_ANSWER + 1;
        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.StrikeTooHigh.selector, aboveSpot, LIVE_ANSWER));
        vm.prank(holder);
        guard.buyCover{value: premium}(USDC_FEED_ID, aboveSpot, NOTIONAL, 7);
    }

    /// @dev A strike exactly at the cap is the most aggressive cover a default pool will write.
    function test_BuyCover_AcceptsAStrikeAtOrBelowTheCap() public {
        _record(_loadFixture(FIXTURE_LIVE));
        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);

        vm.prank(holder);
        uint256 atTheMoney = guard.buyCover{value: premium}(USDC_FEED_ID, LIVE_ANSWER, NOTIONAL, 7);
        vm.prank(holder);
        uint256 outOfTheMoney = guard.buyCover{value: premium}(USDC_FEED_ID, 97_000_000, NOTIONAL, 7);

        assertEq(guard.getPolicy(atTheMoney).strike, LIVE_ANSWER, "at the cap");
        assertEq(guard.getPolicy(outOfTheMoney).strike, 97_000_000, "below the cap");
    }

    /// @dev A pool can demand real distance from the market rather than merely "not in the money".
    function test_StrikeCap_TightensWithMaxStrikeBps() public {
        _record(_loadFixture(FIXTURE_LIVE));
        vm.prank(owner);
        guard.configureStrikeBounds(USDC_FEED_ID, 9_500, 0);

        int256 expected = (LIVE_ANSWER * 9_500) / 10_000; // 94_989_326, floored
        assertEq(guard.strikeCap(USDC_FEED_ID), expected, "95% of the proven price");

        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.StrikeTooHigh.selector, expected + 1, expected));
        vm.prank(holder);
        guard.buyCover{value: premium}(USDC_FEED_ID, expected + 1, NOTIONAL, 7);

        vm.prank(holder);
        guard.buyCover{value: premium}(USDC_FEED_ID, expected, NOTIONAL, 7);
    }

    /// @dev Proving history does not move the reference: `latestRoundId` is monotonic, so importing
    ///      the 2023 depeg after a 2026 round cannot drag the ceiling down to $0.88.
    function test_StrikeCap_IsNotMovedByProvingAnOlderRound() public {
        _record(_loadFixture(FIXTURE_LIVE));
        _record(_loadFixture(FIXTURE_DEPEG));
        assertEq(guard.strikeCap(USDC_FEED_ID), LIVE_ANSWER, "still the latest round, not the oldest");
    }

    // ── The reference must exist, and be fresh ───────────────────────────────────────────────────

    function test_BuyCover_RevertsWhenNoRoundHasEverBeenProven() public {
        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.NoReferencePrice.selector, USDC_FEED_ID));
        vm.prank(holder);
        guard.buyCover{value: premium}(USDC_FEED_ID, 97_000_000, NOTIONAL, 7);
    }

    /// @dev A pool whose keeper died stops selling cover rather than selling it against a price
    ///      nobody has refreshed. This is PegGuard obeying the staleness rule the adapter's NatSpec
    ///      demands of every consumer.
    function test_BuyCover_RevertsWhenTheReferenceIsStale() public {
        _record(_loadFixture(FIXTURE_LIVE));
        vm.warp(uint256(LIVE_UPDATED_AT) + 1 days + 1);

        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.expectRevert(
            abi.encodeWithSelector(
                PegGuard.ReferencePriceStale.selector, LIVE_UPDATED_AT, guard.DEFAULT_MAX_REFERENCE_AGE()
            )
        );
        vm.prank(holder);
        guard.buyCover{value: premium}(USDC_FEED_ID, 97_000_000, NOTIONAL, 7);
    }

    /// @dev Exactly at the boundary is still fresh; one second later is not (asserted above).
    function test_StrikeCap_IsFreshAtExactlyTheMaximumAge() public {
        _record(_loadFixture(FIXTURE_LIVE));
        vm.warp(uint256(LIVE_UPDATED_AT) + 1 days);
        assertEq(guard.strikeCap(USDC_FEED_ID), LIVE_ANSWER, "24h old is still usable");
    }

    function test_StrikeCap_HonoursACustomReferenceAge() public {
        _record(_loadFixture(FIXTURE_LIVE));
        vm.prank(owner);
        guard.configureStrikeBounds(USDC_FEED_ID, 0, uint24(1 hours));

        vm.warp(uint256(LIVE_UPDATED_AT) + 1 hours);
        assertEq(guard.strikeCap(USDC_FEED_ID), LIVE_ANSWER, "inside the tighter window");

        vm.warp(uint256(LIVE_UPDATED_AT) + 1 hours + 1);
        vm.expectRevert(
            abi.encodeWithSelector(PegGuard.ReferencePriceStale.selector, LIVE_UPDATED_AT, uint64(1 hours))
        );
        guard.strikeCap(USDC_FEED_ID);
    }

    /// @dev A non-positive reference is refused rather than turned into a ceiling. A zero or
    ///      negative answer would otherwise produce a cap of zero or below, and `strike > 0` would
    ///      then make every purchase revert with a confusing error — or, worse, a negative cap could
    ///      be reasoned about as if it meant something. Chainlink feeds can legitimately print
    ///      negative values (spreads, rates), so this is not hypothetical for a future feed; it uses
    ///      synthetic bytes because no USDC/USD round has ever printed one.
    function test_StrikeCap_RefusesANonPositiveReference() public {
        bytes memory txBytes =
            TxBytesBuilder.singleRound(LIVE_AGGREGATOR, -1, LIVE_AGG_ROUND + 1, block.timestamp);
        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](2);
        siblings[0] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s0"), isLeft: true});
        siblings[1] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256("s1"), isLeft: false});
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("root");
        vm.prank(keeper);
        registry.recordRound(
            MAINNET_KEY, 1_001, txBytes, keccak256("merkleRoot"), siblings, keccak256("lower"), roots
        );

        // The round really is stored and really is the latest — the refusal is about its value.
        assertEq(registry.getRound(USDC_FEED_ID, LIVE_ROUND_ID + 1).answer, -1, "stored as proven");

        vm.expectRevert(abi.encodeWithSelector(PegGuard.NoReferencePrice.selector, USDC_FEED_ID));
        guard.strikeCap(USDC_FEED_ID);
    }

    // ── Configuration ────────────────────────────────────────────────────────────────────────────

    function test_ConfigureStrikeBounds_RejectsACeilingAboveTheReference() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PegGuard.InvalidStrikeBounds.selector, uint16(10_001)));
        guard.configureStrikeBounds(USDC_FEED_ID, 10_001, 0);
    }

    function test_ConfigureStrikeBounds_IsOwnerOnlyAndFeedChecked() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        guard.configureStrikeBounds(USDC_FEED_ID, 9_000, 0);

        bytes32 unknown = keccak256("NOPE / USD");
        vm.expectRevert(abi.encodeWithSelector(PegGuard.UnknownFeed.selector, unknown));
        vm.prank(owner);
        guard.configureStrikeBounds(unknown, 9_000, 0);
    }

    function test_ConfigureStrikeBounds_EmitsWhatItSet() public {
        vm.expectEmit(true, true, true, true, address(guard));
        emit PegGuard.PoolStrikeBoundsConfigured(USDC_FEED_ID, 9_000, uint24(2 hours));
        vm.prank(owner);
        guard.configureStrikeBounds(USDC_FEED_ID, 9_000, uint24(2 hours));

        PegGuard.Pool memory p = guard.getPool(USDC_FEED_ID);
        assertEq(p.maxStrikeBps, 9_000, "stored");
        assertEq(p.maxReferenceAge, uint24(2 hours), "stored");
    }

    /// @dev The escape hatch, tested as what it is: an unbounded pool really will sell cover that is
    ///      already in the money. It exists so a breach can be staged on testnet, it announces
    ///      itself on chain, and no pool has it by default.
    function test_UnboundedPool_SellsInTheMoneyCover() public {
        _record(_loadFixture(FIXTURE_LIVE));
        uint16 unbounded = guard.UNBOUNDED_STRIKE();
        vm.prank(owner);
        guard.configureStrikeBounds(USDC_FEED_ID, unbounded, 0);

        assertEq(guard.strikeCap(USDC_FEED_ID), type(int256).max, "no ceiling");

        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.prank(holder);
        uint256 policyId = guard.buyCover{value: premium}(USDC_FEED_ID, LIVE_ANSWER * 2, NOTIONAL, 7);
        assertEq(guard.getPolicy(policyId).strike, LIVE_ANSWER * 2, "sold above the market");
    }

    /// @dev An unbounded pool does not even need a reference price to exist.
    function test_UnboundedPool_NeedsNoReferenceAtAll() public {
        uint16 unbounded = guard.UNBOUNDED_STRIKE();
        vm.prank(owner);
        guard.configureStrikeBounds(USDC_FEED_ID, unbounded, 0);
        assertEq(guard.strikeCap(USDC_FEED_ID), type(int256).max, "no reference read");
    }

    // ── The bound constrains selling, never settling ─────────────────────────────────────────────

    /// @dev INV-08 is untouched by FR-33: once a policy exists, only the proven round decides it.
    ///      Here the owner tightens the ceiling to half the market *after* the policy is written,
    ///      and the 2023 depeg still pays it in full.
    function test_TighteningBoundsDoesNotAffectAPolicyAlreadyWritten() public {
        // The reference is the 2026 round; freshness only rejects a reference that is too OLD, so
        // reading it from a block dated 2023 is fine — the check is one-sided on purpose.
        vm.warp(uint256(DEPEG_UPDATED_AT) - 1 days);
        _record(_loadFixture(FIXTURE_LIVE));

        uint256 premium = guard.quote(USDC_FEED_ID, NOTIONAL, 7);
        vm.prank(holder);
        uint256 policyId = guard.buyCover{value: premium}(USDC_FEED_ID, 97_000_000, NOTIONAL, 7);

        vm.prank(owner);
        guard.configureStrikeBounds(USDC_FEED_ID, 5_000, 0);

        _record(_loadFixture(FIXTURE_DEPEG));
        uint256 before = holder.balance;
        vm.prank(keeper);
        guard.claim(policyId, DEPEG_ROUND_ID);

        assertEq(holder.balance, before + NOTIONAL, "the round decided it, not the owner");
        assertEq(uint8(guard.getPolicy(policyId).status), uint8(PegGuard.Status.CLAIMED), "claimed");
    }
}
