# ProofFeed + PegGuard

**Real Ethereum-mainnet Chainlink price rounds, proven onto Creditcoin by the Attestcoin Protocol —
and parametric depeg cover that pays by proof, not by permission.**

> Remove Attestcoin and this repository has no inputs. Every price that reaches Creditcoin is a
> Chainlink `AnswerUpdated` event whose transaction was cryptographically verified by the Block
> Prover precompile. There is no `setPrice`. There is no backend that asserts a number. The contract
> owner can register a feed; it cannot write, alter, or delete a price.

Live on **Creditcoin CC3 testnet** · BUIDL CTC 2026 Fall · track: **DeFi**

| | |
|---|---|
| `ProvenFeedRegistry` | [`0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed`](https://creditcoin-testnet.blockscout.com/address/0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed) |
| `ProvenFeedAdapter` (USDC/USD) | [`0x639f24D0E4298031Da29E523a81910166596027D`](https://creditcoin-testnet.blockscout.com/address/0x639f24D0E4298031Da29E523a81910166596027D) |
| `PegGuard` | [`0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e`](https://creditcoin-testnet.blockscout.com/address/0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e) |

All source-verified on Blockscout. Every hash below is real; full log in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## The problem

Creditcoin has no trust-minimised external price data. The oracle that ships in
`@gluwa/asc-contracts` (`TWAPReader`) is fed by a single off-chain `oracleService` address that
*pushes* observations — a trusted-push model. So every DeFi primitive on Creditcoin that needs a USD
price must either trust an operator or not exist.

Meanwhile Ethereum mainnet already has the most battle-tested price data there is, and the Attestcoin
Protocol can cryptographically prove any mainnet **transaction** to Creditcoin. A Chainlink round
update *is* just a mainnet transaction whose receipt contains
`AnswerUpdated(current, roundId, updatedAt)`. Nobody had connected those two facts.

## How it works

```
ETHEREUM MAINNET (Attestcoin chain key 3)          CREDITCOIN CC3 TESTNET (chainId 102031)
──────────────────────────────────────────         ────────────────────────────────────────────
Chainlink USDC/USD proxy 0x8fFf…18f6
  └─ aggregator() ──emits──►
       AnswerUpdated(current, roundId, updatedAt)   ┌───────────────────────────────────────────┐
             │                                      │ ProvenFeedRegistry (extends ASCBase)      │
             │ (1) tx hash                          │  recordRound(proof)                       │
             ▼                                      │   ├─ 0xFD2.verifyAndEmit ─► TransactionVerified
┌───────────────────────────────┐                   │   ├─ EvmV1Decoder ─► receipt.logs         │
│ pf CLI / keeper (TypeScript)  │                   │   ├─ emitter registered for THIS chainKey?│
│  @gluwa/usc-sdk 0.18.0        │                   │   └─ rounds[feedId][roundId] = {answer,…} │
│  (2) waitUntilHeightAttested  │                   │      emit RoundProven                     │
│  (3) getProof(txHash)         │                   └──────────────┬────────────────────────────┘
│  (4) verifySingle  (dry run)  │                                  │ read
│  (5) recordRound / claim      │──── tx ─────────►  ┌─────────────▼────────────────────────────┐
└───────────────────────────────┘                    │ ProvenFeedAdapter                        │
             ▲                                       │  AggregatorV3Interface-shaped views      │
             │                                       └──────────────────────────────────────────┘
Prover service (hosted):                             ┌──────────────────────────────────────────┐
  GET /api/v1/health                                 │ PegGuard                                 │
  GET /api/v1/attested-height/{chainKey}             │  deposit / buyCover / claim / expire     │
  GET /api/v1/proof-by-tx/{chainKey}/{txHash}        │  proveAndClaim = recordRound + claim     │
                                                     └──────────────────────────────────────────┘
```

The CLI never *decides* anything. It fetches a proof for a transaction that already exists, and the
contract either verifies it or reverts. The CLI's private key is a gas payer, not an oracle.

## Live evidence

### We imported the actual 2023 USDC depeg into Creditcoin

On 2023-03-11, during the SVB collapse, Chainlink's USDC/USD feed printed **$0.88**. That round is
now stored on Creditcoin, proven from the original mainnet transaction:

| | |
|---|---|
| Answer | **$0.88000000** (`88000000`, 8 decimals) |
| Chainlink `updatedAt` | 2023-03-11T07:51:23Z |
| Mainnet block / tx | `16,803,472` / [`0x24500a30…acd8`](https://etherscan.io/tx/0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8) |
| Emitter | `0x789190466E21a8b78b8027866CBBDc151542A26C` (phase-2 aggregator, discovered via `phaseAggregators(2)`) |
| **Creditcoin `recordRound`** | [`0x5c5f1c6d…3a7c`](https://creditcoin-testnet.blockscout.com/tx/0x5c5f1c6d7351ccd1c2418c75bff1ae345734b026f12d7b7ea483b211aadb3a7c) |
| Gas | 650,223 (529 continuity roots) |

That receipt carries `TransactionVerified(chainKey=3, height=16803472, txIndex=61)` from the
precompile at `0x…0FD2`, and `RoundProven(answer=88000000, updatedAt=1678521083)` from the registry.

### And a current round, proven the same way

| | |
|---|---|
| Answer | $0.99988765, `updatedAt` 2026-09-07T08:00:23Z |
| Mainnet block / tx | `25,924,144` / [`0x17e282ab…c3ca`](https://etherscan.io/tx/0x17e282ab446e6df3ac984046c5e17dbc0d47f4967842e2819b23fb91f85fc3ca) |
| **Creditcoin `recordRound`** | [`0xcca535ff…3ebf`](https://creditcoin-testnet.blockscout.com/tx/0xcca535ffa9d73b0e1d6c512fdd0d186acda014ca54248e981e0bc2c063eb3ebf) |
| Gas | 320,546 |

Proving the 2023 round *after* the 2026 one did **not** move `latestRoundId` backwards — the
monotonicity invariant, observed on chain rather than only in tests.

### A claim settled by proof — one transaction, no adjuster

| | |
|---|---|
| Policy | pay 50 CTC if ETH/USD prints below $2754.36 within 7 days |
| Breaching round | **$2511.25370000** at 2026-09-09T07:23:59Z |
| Mainnet block / tx | `25,938,300` / [`0xcc75aa35…035c`](https://etherscan.io/tx/0xcc75aa354d3ab92f1d4ac02fb63e14e3cb270c2726a878899c8e2ddab627035c) |
| **Creditcoin `proveAndClaim`** | [`0xa6c5ffa8…36b6`](https://creditcoin-testnet.blockscout.com/tx/0xa6c5ffa8f670e590d2b1b36f559a48e03cb4eadb97c333e56c72703e4dbd36b6) |
| Gas | 449,666 |
| Payout | holder +49.999775 CTC (50 CTC notional, net of gas) |
| Prover bounty | 0.011666666666666666 CTC accrued, [withdrawn separately](https://creditcoin-testnet.blockscout.com/tx/0xf73096088d9b7adcd027c20601fa7052a9e4f4596c183cd62116c67c09ab171e) |

One transaction carries the whole chain of custody, five events in order:
`TransactionVerified` from the precompile → `RoundProven` → `LatestRoundUpdated` → `BountyAccrued`
→ `ClaimPaid`. Nobody approved that payout; the round did.

### Two payout modes, same round, side by side (FR-30)

A second policy was written at the **identical strike and notional**, differing only in how a breach
settles, and both were claimed against the **same** proven round:

| Policy | Mode | Premium | Payout | Returned to the pool |
|---|---|---|---|---|
| 0 | `FULL` | 0.058333333333333333 CTC | **50.000000000000000000 CTC** | 0 |
| 1 | [`PROPORTIONAL`](https://creditcoin-testnet.blockscout.com/tx/0x013188937ea2bede2fe7e41657bfe0a029b4cbd464dd2b11be049a0f9d701d52) | 0.035 CTC | **4.413064841323284691 CTC** | 45.586935158676715309 CTC |

`FULL` is a trigger: any breach, however shallow, pays the whole notional. `PROPORTIONAL` pays
`notional × (strike − answer) / strike` — a 8.8% breach pays 8.8% — which is what somebody hedging
an actual position wants. Because it pays strictly less, it is written at its own lower rate (30 bps
against 50 bps per 30 days); charging the same for both would leave nobody a reason to buy it.

The pool reserves the **full** notional against either mode, because that is its worst case, and the
proportional policy handed 45.58 CTC back to free liquidity the instant it settled. Afterwards the
pool holds exactly `200 + 0.046666666666666667 + 0.028 − 50 − 4.413064841323284691 =`
**145.661601825343381976 CTC**, `locked` back to 0, escrow empty, and the contract's CTC balance
equals its own accounting to the wei.

### The prover bounty (FR-20)

A share of every premium — 20% on these pools — is carved **out of** the premium, so the buyer's
cost is unchanged, and escrowed separately from pool liquidity. When a policy settles it accrues to
whoever *first proved* the breaching round, which is what makes running the keeper the feed depends
on worth someone's gas.

Two decisions in there are load-bearing:

- **The bounty follows the work, not the caller.** The registry already records a prover per round,
  so a keeper running `pf watch` earns it even when somebody else settles the policy. On the
  `proveAndClaim` path the recorded prover is PegGuard itself, so it falls through to the caller —
  who did prove it, in that transaction.
- **Pull payment, not push.** Pushing CTC to the prover inside `claim` would let a prover *contract*
  that reverts on `receive` hold every holder's payout hostage. `claim` only credits a ledger;
  `withdrawBounty()` collects. There is a test with a hostile prover asserting the holder is still
  paid in full.

Escrow is never pool liquidity: an LP cannot withdraw it, and a claim cannot spend it as notional.
An unearned bounty returns to the pool when the policy expires.

### Several rounds, one continuity proof (FR-32)

`recordRoundBatch` hands the Attestcoin prover's batch response straight to the precompile's batch
`verifyAndEmit` overload: one shared continuity proof, one Merkle proof per transaction, one
Creditcoin transaction. Three ETH/USD rounds from a single volatility burst, proven together:

| | |
|---|---|
| **Creditcoin `recordRoundBatch`** | [`0x882c6ae1…3da2`](https://creditcoin-testnet.blockscout.com/tx/0x882c6ae14cb691ce9d1da231ea4d1733b09e5b986d833f17b529c4217ea33da2) |
| Rounds | 3, across mainnet blocks 25,903,977–25,903,981 (two of them in the *same* block) |
| Gas | **769,283** — against **939,766** proving them one at a time |
| Events | 3 × `TransactionVerified` from `0x…0FD2`, 3 × `RoundProven`, from **one** precompile call |

**Batching is not automatically cheaper, and the tool says so rather than letting you find out by
spending gas.** A shared continuity proof has to reach from the first block in the set to the last,
while each single proof only reaches its own nearest attestation checkpoint — about 100 blocks away.
So the win depends on how *clustered* the rounds are, not on how many there are:

| Rounds | Span | Separately | Batched | Δ |
|---|---|---|---|---|
| 3 | **4 blocks** | 939,766 | **769,283** | **−18.1%** |
| 3 | 390 blocks | 1,084,232 | 1,052,808 | −2.9% |
| 2 | 247 blocks | 691,338 | 792,207 | **+14.6%** |
| 4 | 845 blocks | 1,340,319 | 1,727,572 | **+28.9%** |

Measure it yourself against the live chain, without spending anything:

```bash
npm run pf -- prove-batch --feed ETH/USD --count 3 --compare --dry-run
```

`pf prove-batch` warns whenever the span exceeds 100 blocks. What batching buys unconditionally is
atomicity — N rounds land in one transaction or none do — and every element still passes every check
`recordRound` applies: its own query id, its own emitter lookup, its own round-exists guard.

### Reading it as a Chainlink consumer

```console
$ cast call $ADAPTER "latestRoundData()(uint80,int256,uint256,uint256,uint80)"
55340232221128656026     # (phaseId 3 << 64) | aggregator round 1178
99988765                 # $0.99988765
1788768023               # Chainlink's mainnet timestamp
1788768023
55340232221128656026
```

Any Creditcoin contract already written against `AggregatorV3Interface` compiles and runs against
this unmodified — there is a test that does exactly that with its own locally-declared interface.

## Reproduce in three commands

```bash
git clone https://github.com/AdityaZulkarnaen/proof-feed.git && cd proof-feed
npm ci && (cd contracts && forge test)          # 130 tests, zero network access
npm run pf -- demo --yes                        # read the live deployment back off CC3
```

**No `.env` is needed for any of that.** The CLI defaults to the live CC3 deployment and to public
RPC endpoints, so a fresh clone can read the registry, confirm the 2023 depeg round is stored, and
see the settled policy without configuring anything. Verified by actually doing it — see
"Fresh-clone check" below.

Two more, still with no configuration:

```bash
npm run pf -- spike                             # re-runs every Day-1 gate against the live network
npm run pf -- prove --feed USDC/USD --latest    # idempotent: exits 0 if the round is already stored
```

`pf prove` only needs `CREDITCOIN_WALLET_PRIVATE_KEY` when it actually has a *new* round to submit.

### Fresh-clone check

Run on a clean `git clone` into an empty directory, with no `.env`:

| Step | Result |
|---|---|
| `npm ci` | 50 packages, clean |
| `forge test` | **130 passed, 0 failed** — Foundry auto-fetches the pinned `forge-std` v1.16.2 submodule on first run (needs network once; or clone with `--recurse-submodules`) |
| `npm run typecheck` | clean |
| `npm run test:cli` | **25 passed** |
| `npm run pf -- spike` | G1, G2, G3a, G3b all **PASS** with no `.env` |
| `npm run pf -- demo --yes` | reads the live registry and the settled policy |

## Attestcoin Protocol integration

Split honestly by which command actually exercises them. Every `pf` command ends by printing the
surfaces it just used, so you can check this table against the tool's own output rather than trusting
it.

**On the default `npm run pf -- prove` path — the load-bearing set:**

| Surface | Where | What it does here |
|---|---|---|
| `INativeQueryVerifier.verifyAndEmit` | on chain, `0x…0FD2` | the only thing that makes transaction bytes trustworthy |
| `INativeQueryVerifier.verifyAndEmit` (batch overload) | on chain, `0x…0FD2`, on `pf prove-batch` | N transactions against one shared continuity proof (FR-32) |
| `INativeQueryVerifier.calculateTxIndex` | on chain, via `ASCBase._computeQueryId` | derives the query id used for replay protection |
| `ASCBase._verifyProof` / `_computeQueryId` / `processedQueries` | on chain | inherited base-layer plumbing |
| `EvmV1Decoder.getTransactionType` / `isValidTransactionType` | on chain | rejects transaction types the decoder cannot handle |
| `EvmV1Decoder.decodeReceiptFields` | on chain | receipt status + logs, decoded from the *verified* bytes |
| `EvmV1Decoder.getLogsByEventSignature` | on chain | filters to `AnswerUpdated` |
| `chainInfo.getLatestAttestedHeightAndHash` | CLI | picks a round at or below the attested tip |
| `ProofBuilder.waitUntilHeightAttested` | CLI | blocks until the round's block is attested |
| `ProofBuilder.getProof` | CLI | fetches inclusion + continuity proof |
| `PrecompileBlockProver.verifySingle` | CLI (`eth_call`) | pre-flight; we never submit when it is false |
| `utils.gas.MAX_GAS_CAP` / `gasAsPercentageOfMax` | CLI | every gas number in this README |
| precompile `TransactionVerified` event | CLI | read back out of each receipt as proof of work done |

**On `npm run pf -- spike` only** — used to establish the facts in `docs/05`, not on the hot path:

| Surface | What it established |
|---|---|
| `chainInfo.getSupportedChains` / `getSupportedChainByKey` | chain key 3 really is Ethereum mainnet (chainId 1) |
| `chainInfo.getContinuityBounds` | deep history is covered — the basis for trying a 2023 round at all |
| `chainInfo.getAttestationGenesisHeight` | probed, and found **ambiguous** (returns 0); replaced as the branch decider |
| `PrecompileBlockProver.computeTransactionIndex` | cross-checks the prover's own `txIndex` off chain |

**On `npm run pf -- prove-batch` only** (FR-32):

| Surface | What it does here |
|---|---|
| `ProofBuilder.getBatchProof` | `POST /api/v1/proof-batch-by-tx` — one continuity proof spanning every block in the set |
| `PrecompileBlockProver.verifyBatch` | pre-flight `eth_call` against the batch overload; we never submit when it is false |

**On `pf claim`:** everything in the first table, plus `PegGuard.proveAndClaim`, which calls
`recordRound` and settles in one transaction.

### Why `recordRound` instead of `execute`

`ASCBase.execute` is not `virtual`, and its hook `_processAndEmitEvent(action, queryId,
encodedTransaction)` **does not receive `chainKey`**. Our security model requires binding the
aggregator check to the chain key the precompile actually verified: without it, a proof verified
against Sepolia (chain key 1) could be processed as though it were mainnet (chain key 3), and an
attacker who controlled that address on the cheaper chain could inject a price.

So `ProvenFeedRegistry` keeps the standard `ASCBase` shape — `VERIFIER`, `processedQueries`,
`_verifyProof`, `_computeQueryId` — but adds its own entrypoint `recordRound(...)` taking exactly the
same proof arguments, and carries `chainKey` all the way down to the emitter lookup. The inherited
`execute` is neutered: its hook reverts `UseRecordRound()`, before any state is written. There is a
test for that, and a second one proving a failed `execute` does not burn the query id.

## Security model

| Question | Answer |
|---|---|
| Who can submit a round? | **Anyone.** Submission is permissionless; correctness is enforced by the precompile, the decoder and the emitter check. |
| What can a malicious submitter do? | Pay gas. A forged log comes from an unregistered emitter → revert. A tampered proof → the precompile rejects it. A replayed proof → `processedQueries` rejects it. |
| What can the owner do? | Register and deactivate feeds — *configuration*. The owner cannot insert, alter, or delete a price, and deactivating a feed does not erase rounds already proven under it. Both are tested. |
| What does a consumer trust? | Ethereum consensus, Chainlink's aggregator (the same trust any mainnet Chainlink consumer takes), and Creditcoin's attestor set. No project-run server is in the trust path. |

Every proven round satisfies all of these, in order: query id unused → `verifyAndEmit` returned true
→ transaction type supported → `receiptStatus == 1` → emitter is an **active** feed **for that
chainKey** → log shape is exactly `AnswerUpdated` (3 topics, 32 bytes of data) → round not already
stored.

`recordRoundBatch` (FR-32) applies that same list to **every** element, and is all-or-nothing: the
precompile returns one verdict for the whole set, so there is no partial success in which an
unverified round could survive alongside verified ones. A batch cannot contain the same transaction
twice, and cannot re-prove one the single-proof path already consumed — both directions are tested.

## Limitations — disclosed, not discovered

- **This proves transaction history, not state.** It can prove that round *R* happened and printed
  *X*. It can never prove that *R* is the latest round, that no newer round exists, or what
  `latestRoundData()` currently returns on mainnet. Anyone claiming otherwise about an Attestcoin
  integration is overselling it.
- **The feed is therefore a lower bound.** `updatedAt` is Chainlink's mainnet timestamp;
  `latestProvenAt` is Creditcoin's. Consumers **must** apply their own staleness check, exactly as a
  careful mainnet Chainlink consumer does. Liveness depends on somebody running `pf watch`.
- **PegGuard is immune to that specific limitation**, which is the point of pairing them: the policy
  pays if *any* round in the window breached the strike. Existence is exactly what a transaction
  proof establishes.
- **You cannot buy cover for a depeg that already printed.** `buyCover` sets `start =
  block.timestamp + waitingPeriod`, so cover always begins in the future. This is a deliberate
  safety property, and it is why the claim demo uses a live ETH/USD round with a strike set above
  spot rather than the 2023 depeg round: the contract path is identical, only the strike differs.
- **One-directional.** Creditcoin reads Ethereum. Writability is not available on testnet, and
  nothing here depends on sending a message back.
- **Feed registration is owner-managed** (`Ownable2Step`) — a centralisation point of
  *configuration*, not of *data*. Making it permissionless by proving the proxy's own
  `AggregatorConfirmed` event was specified as P2 (FR-31), researched, and **deliberately not
  shipped**: scanning Ethereum mainnet from block 16,500,000 — the start of the attestable window —
  to 25,938,051 found **zero** such events across thirteen major Chainlink feeds. Established feeds
  are upgraded by changing OCR configuration inside the same aggregator, not by swapping the
  aggregator behind the proxy. The feature would have been an owner-bypass path that no proof could
  ever exercise, so it stays unbuilt until the event actually occurs. Evidence in
  `docs/DEPLOYMENT.md`.
- **Batching is not always cheaper.** `recordRoundBatch` wins for clustered rounds and loses for
  scattered ones, because the shared continuity proof spans the whole batch. Measured both ways
  above; the CLI warns before you spend gas on the losing case.
- Testnet CTC, unaudited, premiums are non-refundable.

## Tests

```
contracts: 130 tests, 8 suites — forge test          (no network access)
cli:        25 tests                                  — npm run test:cli
coverage:   98.7% of lines on src/ (233/236), excluding the Day-1 spike contract
```

Coverage below was measured on the P1 tree (`forge coverage --ir-minimum`). The P2 additions —
`recordRoundBatch` and the proportional-payout path — ship with 29 dedicated tests plus a new
invariant, but the percentages have not been re-run since; re-measure with:

```bash
cd contracts && forge coverage --ir-minimum --no-match-coverage "(test|script)" --report summary
```

| Contract | Lines | Branches |
|---|---|---|
| `ProvenFeedRegistry` | 100.00% (97/97) | 72.73% (16/22) |
| `ProvenFeedAdapter` | 100.00% (23/23) | 100.00% (4/4) |
| `ChainlinkLogLib` | 100.00% (13/13) | 100.00% (2/2) |
| `PegGuard` | 97.09% (100/103) | 87.50% (21/24) |
| `ProbeASC` | 0% — Day-1 spike only, deliberately not in the demo path or the suite |

- The happy paths decode **real Ethereum mainnet bytes**: two proofs captured by `pf capture` and
  committed as fixtures, including the 2023 depeg transaction. Only the precompile's *verdict* is
  mocked, because Foundry has no precompiles — everything after it is the production code path.
- Negative cases use a synthetic `EvmV1` encoder (`test/utils/TxBytesBuilder.sol`), because states
  like "reverted source receipt" or "65 rounds in one transaction" do not occur in real Chainlink
  traffic.
- Security suite: forged aggregator, cross-chain spoof, failed source receipt, malformed log,
  replay, log-count cap, duplicate round, owner-cannot-write-a-price, reentrant claim holder.
- `cli/test/abi.test.ts` walks the **compiled ABI** and fails if any state-changing registry
  function ever gains a signed-integer input — a structural guard on "no `setPrice`".
- The PegGuard invariant suite carries ghost counters and a deterministic lifecycle test, because an
  invariant run whose handler swallows every revert can pass while doing nothing. (It did, at first.
  The counters caught it.)

Two bugs found by our own review rather than by the tests, both now fixed and regression-tested:

1. **`deposit` could panic instead of revert.** A claim reduces `pool.balance` without burning
   shares, so a pool can be drained to exactly zero with shares still outstanding; the next deposit
   then divided by that zero balance and hit `panic 0x12`. `deposit` now reverts
   `PoolWipedOut(feedId)`, and the worthless shares can be burned via `withdraw`. The regression test
   was verified to fail with exactly that panic when the guard is removed. PegGuard was redeployed
   with the fix — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
2. **A cold `pf watch` back-filled 20,000 blocks** and started proving all 77 historical rounds it
   found, spending real gas. Cold-start look-back is now `--backfill`, default 300 blocks.

## Project structure

```
contracts/
  src/ProvenFeedRegistry.sol      the registry — proof in, round out
  src/ProvenFeedAdapter.sol       AggregatorV3Interface-shaped view
  src/PegGuard.sol                parametric cover
  src/ProbeASC.sol                Day-1 spike only, not in the demo path
  src/libraries/ChainlinkLogLib.sol
  test/                           89 tests + real mainnet fixtures
cli/
  src/commands/{spike,register,prove,watch,claim,capture}.ts
  src/lib/{attestcoin,chainlink,creditcoin,config,log,retry,args}.ts
docs/                             the specification bundle + DEPLOYMENT.md + spike-output.json
```

## License

MIT
