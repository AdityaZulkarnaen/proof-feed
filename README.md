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
| `ProvenFeedRegistry` | [`0x89ab0ad8768CD06d0f3bc134ad2407705a49d309`](https://creditcoin-testnet.blockscout.com/address/0x89ab0ad8768CD06d0f3bc134ad2407705a49d309) |
| `ProvenFeedAdapter` (USDC/USD) | [`0x678C84Fe193a569FbDAF58e5f0d8f290a4072735`](https://creditcoin-testnet.blockscout.com/address/0x678C84Fe193a569FbDAF58e5f0d8f290a4072735) |
| `PegGuard` | [`0xc836457AD046a329E93e40A4B747E90ee53B85bC`](https://creditcoin-testnet.blockscout.com/address/0xc836457AD046a329E93e40A4B747E90ee53B85bC) |

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
| **Creditcoin `recordRound`** | [`0x51391915…2d06`](https://creditcoin-testnet.blockscout.com/tx/0x51391915f812b640d8eafafdfd44205777d37d12d33c7319c9dc467b0f912d06) |
| Gas | 628,299 (529 continuity roots) |

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
| Policy | pay 50 CTC if ETH/USD prints below $2736.21 within 7 days |
| Breaching round | **$2474.22860000** at 2026-09-08T05:53:59Z |
| Mainnet block / tx | `25,930,684` / [`0x2f0aead4…3896`](https://etherscan.io/tx/0x2f0aead47a7638027a5dce7225d7738d88593ad388955a8b3ac604b01c083896) |
| **Creditcoin `proveAndClaim`** | [`0xb90dda64…e39c`](https://creditcoin-testnet.blockscout.com/tx/0xb90dda642a3e77ab296ffdc0dd4521e6225b2653a301dc162123ac0a3776e39c) |
| Gas | 374,374 |
| Payout | holder +49.999813 CTC (50 CTC notional, net of gas) |

One transaction carries the whole chain of custody: `TransactionVerified` from the precompile →
`RoundProven` from the registry → `ClaimPaid` from PegGuard. Afterwards the pool holds exactly
200 deposited + 0.0583333 premium − 50 paid = **150.058333333333333333 CTC**, `locked` back to 0,
and the contract's CTC balance equals its own accounting to the wei.

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
npm ci && (cd contracts && forge test)          # 90 tests, zero network access
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
| `forge test` | **90 passed, 0 failed** — Foundry auto-fetches the pinned `forge-std` v1.16.2 submodule on first run (needs network once; or clone with `--recurse-submodules`) |
| `npm run typecheck` | clean |
| `npm run test:cli` | **23 passed** |
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
  *configuration*, not of *data*. Permissionless registration by proving the proxy's own upgrade
  event is future work.
- Testnet CTC, unaudited, binary payout, premiums are non-refundable.

## Tests

```
contracts:  90 tests, 5 suites — forge test          (no network access)
cli:        23 tests                                  — npm run test:cli
coverage:   98.7% of lines on src/ (233/236), excluding the Day-1 spike contract
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
