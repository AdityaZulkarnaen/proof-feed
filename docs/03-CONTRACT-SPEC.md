# 03 — Contract Specification

All contracts: `pragma solidity ^0.8.28;` (compile with 0.8.30), Foundry, `via_ir=true`,
`evm_version="shanghai"`. Imports:

```solidity
import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
```

`foundry.toml` (contracts root):

```toml
[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["../node_modules", "lib"]
allow_paths = ["../node_modules"]
fs_permissions = [{ access = "read", path = "./test/fixtures" }]
remappings = [
  "@gluwa/asc-contracts/=../node_modules/@gluwa/asc-contracts/",
  "@openzeppelin/=../node_modules/@openzeppelin/",
  "forge-std/=lib/forge-std/src/",
]
solc_version = "0.8.30"
optimizer = true
optimizer_runs = 200
via_ir = true
evm_version = "shanghai"
[lint]
lint_on_build = false
```

Install: `npm i @gluwa/asc-contracts@0.2.1 @openzeppelin/contracts@5` at repo root; `forge install foundry-rs/forge-std` inside `contracts/`.

---

## 1. `ChainlinkLogLib` (library, `src/libraries/ChainlinkLogLib.sol`)

Pure helpers over `EvmV1Decoder.LogEntry`.

```solidity
library ChainlinkLogLib {
    /// keccak256("AnswerUpdated(int256,uint256,uint256)")
    bytes32 internal constant ANSWER_UPDATED_SIG =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    struct AnswerUpdated { address emitter; int256 answer; uint256 aggregatorRoundId; uint256 updatedAt; }

    error BadAnswerUpdatedLog(uint256 topics, uint256 dataLen);

    /// Reverts unless log is a well-formed AnswerUpdated: topics.length == 3, data.length == 32.
    function parseAnswerUpdated(EvmV1Decoder.LogEntry memory log) internal pure returns (AnswerUpdated memory a) {
        if (log.topics.length != 3 || log.data.length != 32) revert BadAnswerUpdatedLog(log.topics.length, log.data.length);
        a.emitter = log.address_;
        a.answer = int256(uint256(log.topics[1]));       // indexed int256 current
        a.aggregatorRoundId = uint256(log.topics[2]);    // indexed uint256 roundId (aggregator-local)
        a.updatedAt = abi.decode(log.data, (uint256));
    }

    /// Chainlink proxy convention.
    function composeRoundId(uint16 phaseId, uint256 aggregatorRoundId) internal pure returns (uint80) {
        require(aggregatorRoundId < (1 << 64), "aggRound too large");
        return uint80((uint256(phaseId) << 64) | aggregatorRoundId);
    }
}
```

---

## 2. `IProvenFeedRegistry` (interface)

```solidity
interface IProvenFeedRegistry {
    struct Feed  { uint64 chainKey; address emitter; uint16 phaseId; uint8 decimals; bool active; string description; }
    struct Round { int256 answer; uint64 updatedAt; uint64 provenAt; address prover; bytes32 queryId; bool exists; }

    event FeedRegistered(bytes32 indexed feedId, uint64 indexed chainKey, address indexed emitter, uint16 phaseId, uint8 decimals, string description);
    event FeedActiveSet(bytes32 indexed feedId, address indexed emitter, bool active);
    event RoundProven(bytes32 indexed feedId, uint80 indexed roundId, int256 answer, uint64 updatedAt, bytes32 queryId, address prover);
    event LatestRoundUpdated(bytes32 indexed feedId, uint80 indexed roundId);

    error InvalidAction(uint8 action);
    error UnsupportedTxType(uint8 txType);
    error SourceTxFailed(uint8 status);
    error NoMatchingLogs(uint256 logsScanned);
    error TooManyLogs(uint256 n);
    error RoundAlreadyProven(bytes32 feedId, uint80 roundId);
    error FeedExists(bytes32 feedId, address emitter);
    error UnknownFeed(bytes32 feedId);
    error NoRoundYet(bytes32 feedId);
    error ZeroAddress();

    function registerFeed(bytes32 feedId, uint64 chainKey, address emitter, uint16 phaseId, uint8 decimals, string calldata description) external;
    function setFeedActive(uint64 chainKey, address emitter, bool active) external;
    function feedOf(uint64 chainKey, address emitter) external view returns (bytes32 feedId);
    function getFeed(bytes32 feedId) external view returns (Feed memory);           // canonical (first-registered) metadata
    function getRound(bytes32 feedId, uint80 roundId) external view returns (Round memory);
    function latestRoundId(bytes32 feedId) external view returns (uint80);
    function latestRoundData(bytes32 feedId) external view returns (uint80 roundId, int256 answer, uint64 updatedAt, uint64 provenAt);
    function isFresh(bytes32 feedId, uint64 maxAge) external view returns (bool);

    error UseRecordRound();
    /// Same proof parameters as ASCBase.execute (minus `action`). See §3.5 and docs/09 D-03.
    function recordRound(
        uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction, bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings, bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots
    ) external returns (uint80[] memory roundIds);
    // execute(...) is inherited from ASCBase and always reverts with UseRecordRound()
}
```

---

## 3. `ProvenFeedRegistry is ASCBase, Ownable2Step, IProvenFeedRegistry`

### 3.1 Storage
```
uint8  public constant ACTION_RECORD_ROUND = 0;
uint256 public constant MAX_LOGS = 64;
mapping(bytes32 feedId => Feed)                              private _feeds;        // canonical metadata (decimals/description of first registration)
mapping(bytes32 emitterKey => bytes32 feedId)                private _emitterToFeed;
mapping(bytes32 emitterKey => Feed)                          private _emitterFeed;  // per-emitter chainKey/phaseId/active
mapping(bytes32 feedId => mapping(uint80 => Round))          private _rounds;
mapping(bytes32 feedId => uint80)                            public  latestRoundId;
```
`emitterKey = keccak256(abi.encode(chainKey, emitter))`.

### 3.2 `constructor(address initialOwner)` → `Ownable(initialOwner)`. `ASCBase()` sets `VERIFIER = 0xFD2`.

### 3.3 `registerFeed(feedId, chainKey, emitter, phaseId, decimals, description)` — `onlyOwner`
- `emitter != 0` else `ZeroAddress()`.
- `_emitterToFeed[emitterKey] == 0` else `FeedExists`.
- If `_feeds[feedId]` is new: store canonical metadata (decimals, description, chainKey, emitter, phaseId, active=true).
  If it exists: require same `decimals` (revert `FeedExists` otherwise — mismatched decimals across phases is not supported).
- Store `_emitterFeed[emitterKey] = Feed{chainKey, emitter, phaseId, decimals, true, description}`; `_emitterToFeed[emitterKey] = feedId`.
- Emit `FeedRegistered`.

### 3.4 `setFeedActive(chainKey, emitter, active)` — `onlyOwner`; revert `UnknownFeed` if unmapped; emit `FeedActiveSet`.

### 3.5 `_processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction)` — the core

Problem: `ASCBase.execute` (0.2.1) is not `virtual`, and its hook
`_processAndEmitEvent(action, queryId, encodedTransaction)` does **not** receive `chainKey`. Our
emitter check must be keyed on the same `chainKey` the precompile verified the proof against
(INV-03); otherwise a proof verified for Sepolia (key 1) could be processed as if it were mainnet
(key 3). The address-collision attack this enables is impractical (it needs Chainlink's deployer key),
but "impractical" is not an invariant, and judges will ask.

> **Decision (docs/09 D-03):** inherit `ASCBase` (standard shape, `processedQueries`, `VERIFIER`) but
> add our own entrypoint `recordRound(...)` with identical proof parameters. It **reuses the inherited
> internal helpers** `_computeQueryId(...)` and `_verifyProof(...)` (both `internal` in `ASCBase`) and
> writes `processedQueries` itself, then calls `_record(chainKey, queryId, encodedTransaction)`.
> `_processAndEmitEvent` is implemented as `revert UseRecordRound();` so the inherited `execute`
> can never record anything (it reverts before any state persists). README explains this in one
> paragraph under "Why `recordRound` instead of `execute`".

Final entrypoint:

```solidity
function recordRound(
    uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction, bytes32 merkleRoot,
    INativeQueryVerifier.MerkleProofEntry[] calldata siblings, bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots
) external returns (uint80[] memory roundIds);
```

Validation order (each step reverts on failure; order matters for cheap-first and for security):
1. `queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings)`; require `!processedQueries[queryId]` (`"Query already processed"`).
2. `_verifyProof(...)` → `VERIFIER.verifyAndEmit`; require true (`"Proof of inclusion verification failed"`).
3. `processedQueries[queryId] = true`.
4. `txType = EvmV1Decoder.getTransactionType(encodedTransaction)`; require `isValidTransactionType` else `UnsupportedTxType`.
5. `receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction)`; require `receipt.receiptStatus == 1` else `SourceTxFailed`.
6. `logs = EvmV1Decoder.getLogsByEventSignature(receipt, ANSWER_UPDATED_SIG)`; require `logs.length ≤ MAX_LOGS` else `TooManyLogs`.
7. For each log: `feedId = _emitterToFeed[keccak256(abi.encode(chainKey, log.address_))]`; if `feedId == 0` or `!_emitterFeed[..].active` → **skip** (do not revert; unrelated aggregators may share a tx).
   Else `a = ChainlinkLogLib.parseAnswerUpdated(log)`; `roundId = composeRoundId(phaseId, a.aggregatorRoundId)`;
   require `!_rounds[feedId][roundId].exists` else `RoundAlreadyProven`;
   store `Round{answer, uint64(updatedAt), uint64(block.timestamp), msg.sender, queryId, true}`;
   emit `RoundProven`; if `roundId > latestRoundId[feedId]` → update + emit `LatestRoundUpdated`; push to `roundIds`.
8. require `roundIds.length > 0` else `NoMatchingLogs(logs.length)`.

`_processAndEmitEvent` (required by `ASCBase`) reverts `UseRecordRound()`.

### 3.6 Views
- `latestRoundData(feedId)`: revert `NoRoundYet` if `latestRoundId == 0`.
- `isFresh(feedId, maxAge)`: `latest.updatedAt + maxAge ≥ block.timestamp` (false if no round).
- `getRound` returns the struct (`exists=false` if missing; do not revert).

---

## 4. `ProvenFeedAdapter` (`src/ProvenFeedAdapter.sol`)

Immutable `(registry, feedId)`. Implements the Chainlink `AggregatorV3Interface` shape so existing
consumers compile against it unchanged:

```solidity
function decimals() external view returns (uint8);
function description() external view returns (string memory);
function version() external pure returns (uint256) { return 1; }
function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
function getRoundData(uint80 _roundId) external view returns (...same...);
/// Extra, non-Chainlink: when Creditcoin recorded it (staleness of the proof itself)
function latestProvenAt() external view returns (uint64);
```
`startedAt = updatedAt`, `answeredInRound = roundId`. Revert `NoRoundYet` / `UnknownRound` as appropriate.
NatSpec must state: "Lower-bound feed. `updatedAt` is Chainlink's mainnet timestamp; `latestProvenAt`
is Creditcoin's. Consumers MUST apply a staleness check on `updatedAt`."

---

## 5. `PegGuard` (`src/PegGuard.sol`) — `Ownable2Step, ReentrancyGuard`

### 5.1 Types
```
enum Status { NONE, ACTIVE, CLAIMED, EXPIRED }
struct Pool   { uint256 balance; uint256 locked; uint256 totalShares; uint16 premiumBpsPer30d; uint32 waitingPeriod; uint128 maxNotional; bool active; }
struct Policy { bytes32 feedId; address holder; int256 strike; uint128 notional; uint128 premiumPaid; uint64 start; uint64 expiry; Status status; uint80 claimRoundId; }
```
Storage: `IProvenFeedRegistry public immutable registry; mapping(bytes32 => Pool) pools; mapping(bytes32 => mapping(address => uint256)) shares; Policy[] policies;` (policyId = index).

### 5.2 Admin
- `configurePool(feedId, premiumBpsPer30d, waitingPeriod, maxNotional, active)` — `onlyOwner`; revert `UnknownFeed` if `registry.getFeed(feedId).emitter == 0`. Emit `PoolConfigured`.
  Demo defaults: USDC/USD: 50 bps/30d, waitingPeriod 0 (demo) / 3600 (default), maxNotional 100 CTC.

### 5.3 Liquidity
- `deposit(feedId) payable nonReentrant`: `msg.value > 0`; shares minted = `totalShares == 0 ? msg.value : msg.value * totalShares / balance`; `balance += msg.value`. Emit `Deposited(feedId, lp, amount, shares)`.
- `withdraw(feedId, shareAmount) nonReentrant`: `amount = shareAmount * balance / totalShares`; require `amount ≤ balance − locked` else `InsufficientLiquidity(available, amount)`; burn shares; `balance −= amount`; transfer via `call`; emit `Withdrawn`.
- `available(feedId) view = balance − locked`.

### 5.4 Cover
- `quote(feedId, notional, durationDays) view returns (uint256 premium)`:
  `premium = notional * premiumBpsPer30d * durationDays / 30 / 10_000`; require `1 ≤ durationDays ≤ 365`.
- `buyCover(feedId, strike, notional, durationDays) payable nonReentrant returns (uint256 policyId)`:
  - pool active; `strike > 0`; `0 < notional ≤ maxNotional`; `notional ≤ available` else `InsufficientCapacity`;
  - `msg.value == quote(...)` else `WrongPremium(expected, sent)`;
  - `balance += msg.value; locked += notional`;
  - `start = block.timestamp + waitingPeriod; expiry = start + durationDays * 1 days`;
  - push Policy(ACTIVE); emit `CoverBought(policyId, feedId, holder, strike, notional, premium, start, expiry)`.
- `claim(policyId, roundId) nonReentrant` — **anyone may call**:
  - `p.status == ACTIVE` else `PolicyNotActive`;
  - `r = registry.getRound(p.feedId, roundId)`; `r.exists` else `RoundNotProven(feedId, roundId)`;
  - `p.start ≤ r.updatedAt ≤ p.expiry` else `RoundOutsideWindow(r.updatedAt, p.start, p.expiry)`;
  - `r.answer < p.strike` else `StrikeNotBreached(r.answer, p.strike)`;
  - effects: `status = CLAIMED; claimRoundId = roundId; locked −= notional; balance −= notional`;
  - interaction: `call{value: notional}(p.holder)`; require success; emit `ClaimPaid(policyId, roundId, holder, notional, msg.sender)`.
- `proveAndClaim(policyId, roundId, chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots) nonReentrant`:
  - `uint80[] memory ids = registry.recordRound(...)`; require `ids` contains `roundId` else `RoundNotInProof(roundId)`;
  - then `_claim(policyId, roundId)` (internal version of claim). Whole tx reverts if the claim fails (INV-10).
- `expire(policyId)`: `ACTIVE && block.timestamp > expiry` → `status = EXPIRED; locked −= notional`; emit `PolicyExpired`.

### 5.5 Events / errors (complete list)
Events: `PoolConfigured, Deposited, Withdrawn, CoverBought, ClaimPaid, PolicyExpired`.
Errors: `UnknownFeed, PoolInactive, InvalidStrike, InvalidNotional, InvalidDuration, InsufficientCapacity(uint256 available, uint256 requested), InsufficientLiquidity(uint256 available, uint256 requested), WrongPremium(uint256 expected, uint256 sent), PolicyNotActive(uint256 id), RoundNotProven(bytes32, uint80), RoundOutsideWindow(uint64,uint64,uint64), StrikeNotBreached(int256,int256), RoundNotInProof(uint80), NotExpired, TransferFailed`.

### 5.6 Notes
- Strike is in feed decimals (USDC/USD: 8 decimals → `0.97 USD = 97_000_000`).
- Binary payout (full notional). Proportional is P2 (FR-30).
- Premium accrues to the pool at purchase (no refunds). Simplicity over fairness; say so in README.

---

## 6. `ProbeASC` (`src/ProbeASC.sol`) — Day-1 spike only

Minimal contract inheriting `ASCBase`, action 0: decodes receipt, finds `AnswerUpdated` logs, emits
`Probe(address emitter, int256 answer, uint256 aggRound, uint256 updatedAt, bytes32 queryId)` for
each. No emitter check (it is a probe, not a product). Used to obtain the first real on-chain
verification tx hash and the real gas number before writing product code. Delete from the demo path
afterwards (keep file for `docs/spike-output.json` provenance).

---

## 7. `MockNativeQueryVerifier` (`test/mocks/`) — tests only

Implements `INativeQueryVerifier` fully:
- `verifyAndEmit(single)`: emits `TransactionVerified(chainKey, height, calculateTxIndex(proof))`, returns `result` (storage bool, default true; `setResult(bool)`); if `rejectRoot != 0 && merkleProof.root == rejectRoot` return false.
- `verify(single)`: same without emit. Batch variants: revert `NotSupported()`.
- `calculateTxIndex`: `for i in siblings: if (siblings[i].isLeft) index |= 1 << i` (a sibling on the left means the leaf is the right child → bit 1). Matches index41's off-chain `indexFromLaterality`.
- Tests etch it: `vm.etch(address(0x0FD2), address(new MockNativeQueryVerifier()).code);` then configure via `MockNativeQueryVerifier(address(0x0FD2)).setResult(...)` (state lives at 0xFD2).

---

## 8. Deploy script (`script/Deploy.s.sol`)

Reads env: `OWNER`, `FEED_DESCRIPTION` (e.g. "USDC / USD"), `FEED_CHAIN_KEY` (3), `FEED_EMITTER`, `FEED_PHASE_ID`, `FEED_DECIMALS`.
Steps: deploy `ProvenFeedRegistry(owner)` → `registerFeed(keccak256(bytes(FEED_DESCRIPTION)), …)` →
deploy `ProvenFeedAdapter(registry, feedId)` → deploy `PegGuard(registry, owner)` → `configurePool(...)`.
Print all addresses as JSON to stdout and append to `docs/DEPLOYMENT.md`.
Run: `forge script script/Deploy.s.sol --rpc-url $CREDITCOIN_RPC_URL --private-key $CREDITCOIN_WALLET_PRIVATE_KEY --broadcast` (add `--legacy` if EIP-1559 fields are rejected by the node `[VERIFY]`).
Verify: `forge verify-contract --verifier blockscout --verifier-url https://creditcoin-testnet.blockscout.com/api <addr> <Contract>`.
