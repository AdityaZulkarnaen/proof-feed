// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IProvenFeedRegistry} from "./interfaces/IProvenFeedRegistry.sol";

/// @title PegGuard
/// @author ProofFeed
/// @notice Parametric "price-below-strike" cover, settled entirely by proof. A holder buys cover
///         "pay me `notional` if `feed` prints below `strike` between `start` and `expiry`". To
///         collect, somebody proves the Chainlink round that breached the strike. There is no
///         adjuster, no vote, and no admin function that can approve or deny a claim.
/// @dev Why the freshness limitation of ProofFeed does not matter here: a proof establishes that a
///      round *existed* and printed a value. That is precisely the predicate this policy pays on —
///      "any round in the window below the strike" — so the inability to prove "this is the latest
///      round" costs the product nothing.
///
///      Money invariants (docs/02 §5): `locked <= balance` always (INV-07); a policy pays at most
///      once, only while ACTIVE, only on a round inside its window and below its strike (INV-08);
///      the payout recipient is always `policy.holder` no matter who calls (INV-09).
contract PegGuard is Ownable2Step, ReentrancyGuard {
    /// @notice Lifecycle of a policy. `NONE` only ever appears for an out-of-range id.
    enum Status {
        NONE,
        ACTIVE,
        CLAIMED,
        EXPIRED
    }

    /// @param balance Total native CTC held for this feed's pool (deposits + premiums − payouts).
    /// @param locked Portion of `balance` reserved against live policies.
    /// @param totalShares LP share supply.
    /// @param premiumBpsPer30d Premium rate in basis points of notional per 30 days.
    /// @param waitingPeriod Seconds between purchase and the start of coverage.
    /// @param maxNotional Largest single policy this pool will write.
    /// @param active Whether new cover may be bought.
    /// @param proverBountyBps Share of each premium, in basis points, carved out and escrowed as a
    ///        bounty for whoever proves the breaching round (FR-20). Taken OUT of the premium, not
    ///        added on top, so a buyer's cost is unchanged by the incentive.
    struct Pool {
        uint256 balance;
        uint256 locked;
        uint256 totalShares;
        uint16 premiumBpsPer30d;
        uint32 waitingPeriod;
        uint128 maxNotional;
        bool active;
        uint16 proverBountyBps;
    }

    /// @param feedId The ProofFeed feed this policy is written against.
    /// @param holder Who gets paid. Never changes.
    /// @param strike Payout trigger, in the feed's decimals (8 for USD feeds).
    /// @param notional Payout amount in wei of native CTC.
    /// @param premiumPaid Premium collected at purchase (non-refundable, D-06).
    /// @param start First source-chain timestamp a breaching round may carry.
    /// @param expiry Last source-chain timestamp a breaching round may carry.
    /// @param status Lifecycle state.
    /// @param claimRoundId The round that paid this policy, once claimed.
    struct Policy {
        bytes32 feedId;
        address holder;
        int256 strike;
        uint128 notional;
        uint128 premiumPaid;
        uint64 start;
        uint64 expiry;
        Status status;
        uint80 claimRoundId;
        uint128 proverBounty;
    }

    /// @notice The registry of proven rounds. Immutable: PegGuard's only source of truth.
    IProvenFeedRegistry public immutable REGISTRY;

    mapping(bytes32 feedId => Pool) private _pools;
    mapping(bytes32 feedId => mapping(address lp => uint256)) public sharesOf;
    Policy[] private _policies;

    /// @notice CTC escrowed against live policies as prover bounties. Never part of any pool
    ///         balance, so it can never be withdrawn by an LP or paid out as a claim.
    uint256 public bountyEscrow;

    /// @notice Bounties earned and not yet withdrawn (FR-20).
    /// @dev Pull payment on purpose. Pushing the bounty inside `claim` would let a prover contract
    ///      that reverts on receive block the holder's payout entirely; the holder must never
    ///      depend on a third party's fallback.
    mapping(address prover => uint256) public bountyOwed;

    event PoolConfigured(
        bytes32 indexed feedId, uint16 premiumBpsPer30d, uint32 waitingPeriod, uint128 maxNotional, bool active
    );
    event PoolBountyConfigured(bytes32 indexed feedId, uint16 proverBountyBps);
    event Deposited(bytes32 indexed feedId, address indexed lp, uint256 amount, uint256 shares);
    event Withdrawn(bytes32 indexed feedId, address indexed lp, uint256 amount, uint256 shares);
    event CoverBought(
        uint256 indexed policyId,
        bytes32 indexed feedId,
        address indexed holder,
        int256 strike,
        uint128 notional,
        uint256 premium,
        uint64 start,
        uint64 expiry
    );
    event ClaimPaid(
        uint256 indexed policyId,
        uint80 indexed roundId,
        address indexed holder,
        uint256 notional,
        address caller
    );
    event PolicyExpired(uint256 indexed policyId, bytes32 indexed feedId, uint128 notionalReleased);
    /// @notice A bounty was earned by whoever first proved the breaching round (FR-20).
    event BountyAccrued(uint256 indexed policyId, address indexed prover, uint256 amount);
    /// @notice An earned bounty was withdrawn.
    event BountyWithdrawn(address indexed prover, uint256 amount);
    /// @notice An unearned bounty returned to the pool because the policy expired unclaimed.
    event BountyReleased(uint256 indexed policyId, bytes32 indexed feedId, uint256 amount);

    /// @notice No feed with this id is registered in ProofFeed.
    error UnknownFeed(bytes32 feedId);
    /// @notice The pool is not accepting new cover.
    error PoolInactive(bytes32 feedId);
    /// @notice Strike must be positive.
    error InvalidStrike(int256 strike);
    /// @notice Notional must be non-zero and within the pool's per-policy cap.
    error InvalidNotional(uint256 notional, uint256 maxNotional);
    /// @notice Duration must be 1–365 days.
    error InvalidDuration(uint256 durationDays);
    /// @notice The pool does not have enough unlocked liquidity to back this cover.
    error InsufficientCapacity(uint256 available, uint256 requested);
    /// @notice Withdrawal would eat into liquidity reserved against live policies.
    error InsufficientLiquidity(uint256 available, uint256 requested);
    /// @notice `msg.value` did not equal the quoted premium exactly.
    error WrongPremium(uint256 expected, uint256 sent);
    /// @notice The policy is not in a state that allows this action.
    error PolicyNotActive(uint256 id);
    /// @notice The round has never been proven onto Creditcoin.
    error RoundNotProven(bytes32 feedId, uint80 roundId);
    /// @notice The round happened outside the coverage window.
    error RoundOutsideWindow(uint64 updatedAt, uint64 start, uint64 expiry);
    /// @notice The round's price was not below the strike.
    error StrikeNotBreached(int256 answer, int256 strike);
    /// @notice The submitted proof did not contain the round being claimed.
    error RoundNotInProof(uint80 roundId);
    /// @notice The policy has not reached its expiry yet.
    error NotExpired(uint256 id, uint64 expiry);
    /// @notice A native CTC transfer failed.
    error TransferFailed(address to, uint256 amount);
    /// @notice Deposit of zero.
    error ZeroAmount();
    /// @notice Nothing to withdraw.
    error NothingOwed(address prover);
    /// @notice The bounty share must leave something for the pool.
    error InvalidBountyShare(uint16 bps);
    /// @notice Every unit of this pool was paid out; the shares still outstanding are worthless.
    error PoolWipedOut(bytes32 feedId);
    /// @notice No such policy id.
    error UnknownPolicy(uint256 id);
    /// @notice The registry address was zero.
    error ZeroAddress();

    /// @param registry The `ProvenFeedRegistry` this product settles against.
    /// @param initialOwner Configures pools. Cannot approve, deny, or influence any claim.
    constructor(IProvenFeedRegistry registry, address initialOwner) Ownable(initialOwner) {
        if (address(registry) == address(0)) revert ZeroAddress();
        REGISTRY = registry;
    }

    // ── Admin: pool parameters only, never claim outcomes ────────────────────────────────────────

    /// @notice Configure the pool for a feed.
    /// @dev The owner sets pricing and capacity. It has no way to insert a price, alter a proven
    ///      round, or decide a claim — those follow from the registry alone.
    function configurePool(
        bytes32 feedId,
        uint16 premiumBpsPer30d,
        uint32 waitingPeriod,
        uint128 maxNotional,
        bool active,
        uint16 proverBountyBps
    ) external onlyOwner {
        if (REGISTRY.getFeed(feedId).emitter == address(0)) revert UnknownFeed(feedId);
        // A full-premium bounty would leave the pool underwriting for nothing.
        if (proverBountyBps > 5_000) revert InvalidBountyShare(proverBountyBps);
        Pool storage p = _pools[feedId];
        p.premiumBpsPer30d = premiumBpsPer30d;
        p.waitingPeriod = waitingPeriod;
        p.maxNotional = maxNotional;
        p.active = active;
        p.proverBountyBps = proverBountyBps;
        emit PoolConfigured(feedId, premiumBpsPer30d, waitingPeriod, maxNotional, active);
        emit PoolBountyConfigured(feedId, proverBountyBps);
    }

    // ── Liquidity ────────────────────────────────────────────────────────────────────────────────

    /// @notice Back a feed's cover with native CTC and receive pool shares.
    /// @param feedId The pool to underwrite.
    /// @return shares Shares minted to `msg.sender`.
    function deposit(bytes32 feedId) external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        Pool storage p = _pools[feedId];
        if (REGISTRY.getFeed(feedId).emitter == address(0)) revert UnknownFeed(feedId);

        // A claim reduces `balance` without burning shares, so a pool can end up with shares
        // outstanding and nothing behind them. Pricing a deposit against that would divide by
        // zero and panic; refuse it with a real error instead. Those shares are worthless and
        // their holders can burn them via `withdraw` (which pays 0), after which the pool
        // accepts deposits again.
        if (p.totalShares != 0 && p.balance == 0) revert PoolWipedOut(feedId);

        // Shares price off the pool balance BEFORE this deposit lands.
        shares = p.totalShares == 0 ? msg.value : (msg.value * p.totalShares) / p.balance;
        if (shares == 0) revert ZeroAmount();

        p.totalShares += shares;
        p.balance += msg.value;
        sharesOf[feedId][msg.sender] += shares;

        emit Deposited(feedId, msg.sender, msg.value, shares);
    }

    /// @notice Redeem shares for native CTC, limited to liquidity not reserved against live cover.
    /// @param feedId The pool to withdraw from.
    /// @param shareAmount Shares to burn.
    /// @return amount CTC paid out.
    function withdraw(bytes32 feedId, uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        if (shareAmount == 0) revert ZeroAmount();
        Pool storage p = _pools[feedId];
        uint256 held = sharesOf[feedId][msg.sender];
        if (shareAmount > held) revert InsufficientLiquidity(held, shareAmount);

        amount = (shareAmount * p.balance) / p.totalShares;
        uint256 free = p.balance - p.locked;
        // INV-07: locked liquidity is untouchable, whatever the share maths says.
        if (amount > free) revert InsufficientLiquidity(free, amount);

        // Effects.
        sharesOf[feedId][msg.sender] = held - shareAmount;
        p.totalShares -= shareAmount;
        p.balance -= amount;

        // Interaction.
        _pay(msg.sender, amount);
        emit Withdrawn(feedId, msg.sender, amount, shareAmount);
    }

    // ── Cover ────────────────────────────────────────────────────────────────────────────────────

    /// @notice Premium for a given notional and duration.
    /// @dev `notional × premiumBpsPer30d × durationDays / 30 / 10_000`.
    function quote(bytes32 feedId, uint256 notional, uint256 durationDays)
        public
        view
        returns (uint256 premium)
    {
        if (durationDays == 0 || durationDays > 365) revert InvalidDuration(durationDays);
        return (notional * _pools[feedId].premiumBpsPer30d * durationDays) / 30 / 10_000;
    }

    /// @notice The share of that premium escrowed as a prover bounty (FR-20).
    /// @dev Carved out of the premium, so the buyer pays exactly `quote()` either way.
    function quoteBounty(bytes32 feedId, uint256 notional, uint256 durationDays)
        public
        view
        returns (uint256 bounty)
    {
        return (quote(feedId, notional, durationDays) * _pools[feedId].proverBountyBps) / 10_000;
    }

    /// @notice Buy cover. Pays `notional` if the feed prints below `strike` inside the window.
    /// @param feedId The feed to cover.
    /// @param strike Trigger price in feed decimals (e.g. $0.97 on an 8-decimal feed = 97_000_000).
    /// @param notional Payout amount in wei of native CTC.
    /// @param durationDays Coverage length, counted from the end of the waiting period.
    /// @return policyId The new policy's id.
    function buyCover(bytes32 feedId, int256 strike, uint128 notional, uint256 durationDays)
        external
        payable
        nonReentrant
        returns (uint256 policyId)
    {
        Pool storage p = _pools[feedId];
        if (!p.active) revert PoolInactive(feedId);
        if (strike <= 0) revert InvalidStrike(strike);
        if (notional == 0 || notional > p.maxNotional) revert InvalidNotional(notional, p.maxNotional);

        uint256 freeLiquidity = p.balance - p.locked;
        if (notional > freeLiquidity) revert InsufficientCapacity(freeLiquidity, notional);

        uint256 premium = quote(feedId, notional, durationDays);
        if (msg.value != premium) revert WrongPremium(premium, msg.value);

        // FR-20: the bounty is carved OUT of the premium and escrowed, so it is never part of pool
        // balance and can never be withdrawn by an LP or spent on a payout.
        uint256 bounty = (premium * p.proverBountyBps) / 10_000;

        // The rest of the premium joins the pool immediately; it is not refundable (D-06).
        p.balance += premium - bounty;
        bountyEscrow += bounty;
        p.locked += notional;

        uint64 start = uint64(block.timestamp) + p.waitingPeriod;
        uint64 expiry = start + uint64(durationDays * 1 days);

        policyId = _policies.length;
        _policies.push(
            Policy({
                feedId: feedId,
                holder: msg.sender,
                strike: strike,
                notional: notional,
                premiumPaid: uint128(premium),
                start: start,
                expiry: expiry,
                status: Status.ACTIVE,
                claimRoundId: 0,
                proverBounty: uint128(bounty)
            })
        );

        emit CoverBought(policyId, feedId, msg.sender, strike, notional, premium, start, expiry);
    }

    /// @notice Settle a policy against an already-proven round.
    /// @dev Callable by ANYONE — a keeper, a friend, a bot. The payout always goes to the holder
    ///      (INV-09), so there is nothing to gain by front-running the caller slot.
    /// @param policyId The policy to settle.
    /// @param roundId The proven round that breached the strike.
    function claim(uint256 policyId, uint80 roundId) external nonReentrant {
        _claim(policyId, roundId);
    }

    /// @notice Prove the breaching round and settle the policy in ONE Creditcoin transaction.
    /// @dev Atomic by design (INV-10): if the claim is invalid the whole transaction reverts and
    ///      the round is not recorded either. That is simpler to reason about than partial state,
    ///      and anyone who merely wants the round on-chain can call `registry.recordRound` directly.
    /// @param policyId The policy to settle.
    /// @param roundId The round expected to appear in the proof.
    /// @return roundIds Every round the proof recorded.
    function proveAndClaim(
        uint256 policyId,
        uint80 roundId,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external nonReentrant returns (uint80[] memory roundIds) {
        roundIds = REGISTRY.recordRound(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleRoot,
            siblings,
            lowerEndpointDigest,
            continuityRoots
        );

        bool found;
        for (uint256 i; i < roundIds.length; ++i) {
            if (roundIds[i] == roundId) {
                found = true;
                break;
            }
        }
        if (!found) revert RoundNotInProof(roundId);

        _claim(policyId, roundId);
    }

    /// @notice Release the capacity of a policy that ran to expiry without a claim.
    /// @dev Callable by anyone; it only ever frees liquidity.
    function expire(uint256 policyId) external {
        Policy storage p = _policyAt(policyId);
        if (p.status != Status.ACTIVE) revert PolicyNotActive(policyId);
        if (block.timestamp <= p.expiry) revert NotExpired(policyId, p.expiry);

        p.status = Status.EXPIRED;
        Pool storage pool = _pools[p.feedId];
        pool.locked -= p.notional;

        // No round breached, so nobody earned the bounty. It returns to the LPs who carried the
        // risk rather than sitting in escrow forever.
        uint128 bounty = p.proverBounty;
        if (bounty > 0) {
            p.proverBounty = 0;
            bountyEscrow -= bounty;
            pool.balance += bounty;
            emit BountyReleased(policyId, p.feedId, bounty);
        }

        emit PolicyExpired(policyId, p.feedId, p.notional);
    }

    /// @notice Withdraw bounties earned for proving breaching rounds (FR-20).
    /// @dev Pull payment: `claim` only credits the ledger, so a prover that cannot receive CTC can
    ///      never block a holder's payout.
    /// @return amount The CTC withdrawn.
    function withdrawBounty() external nonReentrant returns (uint256 amount) {
        amount = bountyOwed[msg.sender];
        if (amount == 0) revert NothingOwed(msg.sender);
        bountyOwed[msg.sender] = 0;
        bountyEscrow -= amount;
        _pay(msg.sender, amount);
        emit BountyWithdrawn(msg.sender, amount);
    }

    /// @dev The whole settlement decision, in one place. Checks → effects → interaction.
    function _claim(uint256 policyId, uint80 roundId) private {
        Policy storage p = _policyAt(policyId);
        if (p.status != Status.ACTIVE) revert PolicyNotActive(policyId);

        // The ONLY source of truth. No parameter of this function carries a price.
        IProvenFeedRegistry.Round memory r = REGISTRY.getRound(p.feedId, roundId);
        if (!r.exists) revert RoundNotProven(p.feedId, roundId);
        if (r.updatedAt < p.start || r.updatedAt > p.expiry) {
            revert RoundOutsideWindow(r.updatedAt, p.start, p.expiry);
        }
        if (r.answer >= p.strike) revert StrikeNotBreached(r.answer, p.strike);

        // Effects before the transfer (INV-08: a policy can pay at most once).
        uint128 notional = p.notional;
        address holder = p.holder;
        p.status = Status.CLAIMED;
        p.claimRoundId = roundId;

        Pool storage pool = _pools[p.feedId];
        pool.locked -= notional;
        pool.balance -= notional;

        // FR-20. The registry records who first proved each round, so the bounty follows the work
        // rather than the caller: a keeper running `pf watch` earns it even when somebody else
        // settles the policy. On the `proveAndClaim` path the recorded prover is this contract, so
        // it falls through to the caller, who did prove it in that same transaction.
        uint128 bounty = p.proverBounty;
        if (bounty > 0) {
            address prover = r.prover;
            if (prover == address(this) || prover == address(0)) prover = msg.sender;
            p.proverBounty = 0;
            bountyOwed[prover] += bounty;
            emit BountyAccrued(policyId, prover, bounty);
        }

        // Interaction. INV-09: the holder is paid regardless of who called.
        _pay(holder, notional);
        emit ClaimPaid(policyId, roundId, holder, notional, msg.sender);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }

    function _policyAt(uint256 policyId) private view returns (Policy storage) {
        if (policyId >= _policies.length) revert UnknownPolicy(policyId);
        return _policies[policyId];
    }

    // ── Views ────────────────────────────────────────────────────────────────────────────────────

    /// @notice Liquidity not reserved against live policies.
    function available(bytes32 feedId) external view returns (uint256) {
        Pool storage p = _pools[feedId];
        return p.balance - p.locked;
    }

    /// @notice Full pool state for a feed.
    function getPool(bytes32 feedId) external view returns (Pool memory) {
        return _pools[feedId];
    }

    /// @notice A policy by id.
    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _policyAt(policyId);
    }

    /// @notice Number of policies ever written.
    function policyCount() external view returns (uint256) {
        return _policies.length;
    }
}
