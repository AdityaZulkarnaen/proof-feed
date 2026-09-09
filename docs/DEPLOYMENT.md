# DEPLOYMENT — live evidence log

Every address, transaction hash and measurement produced on a real network. Nothing here is
hypothetical: if a row has no hash, the step has not happened.

Explorer: `https://creditcoin-testnet.blockscout.com` — prefix any hash below with `/tx/`.

## Environment

| Item | Value |
|---|---|
| Source chain | Ethereum mainnet, Attestcoin chain key **3** (`getSupportedChainByKey(3).chainId == 1`) |
| Target chain | Creditcoin CC3 testnet, chainId **102031**, RPC `https://rpc.cc3-testnet.creditcoin.network` |
| Prover host | `https://prover.cc3-testnet.creditcoin.network` |
| Source RPC | `https://gateway.tenderly.co/public/mainnet` (docs/05 §4b) |
| Block Prover precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` |
| Deployer / keeper | `0x259559fA11C2247f3fD5E1D87be9BFA816Fd97D7` (funded 10,000 CTC from the faucet) |

## Toolchain (pinned)

| Tool | Version |
|---|---|
| Foundry | `forge 1.8.1 (982849d314 2026-08-28)` |
| solc | `0.8.30`, `via_ir = true`, `evm_version = shanghai`, optimizer 200 runs |
| Node / npm | `v22.20.0` / `10.9.3` |
| `@gluwa/asc-contracts` | `0.2.1` |
| `@gluwa/usc-sdk` | `0.18.0` |
| `ethers` | `6.x` |
| `@openzeppelin/contracts` | `5.x` |

## Contracts — all source-verified on Blockscout

**Current — this is what the README, the CLI defaults and the demo use.**

| Contract | Address | Deploy tx | Verified |
|---|---|---|---|
| `ProvenFeedRegistry` (FR-32, `recordRoundBatch`) | `0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed` | `0xfea9dce82c70f9b600570d8f5500eef97d9befcad94e63d2b036667269bba17f` | yes |
| `ProvenFeedAdapter` (USDC/USD) | `0x639f24D0E4298031Da29E523a81910166596027D` | `0x535c143da1c8ad136e17e092c9263c94cd085c79c8fe013b59695669281edf64` | yes |
| `PegGuard` (FR-30, proportional payout) | `0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e` | `0x2b27416dd6f2b9800beb00048cd397a31d149bde2064c11b0020ab874d8749a3` | yes |
| `ProbeASC` (Day-1 spike only, **not** part of the demo path) | `0x846D0C55a916e925331599bf086f9B203E68917B` | `0x154a414171c8e0e210f7f5a749d885972dbaa8bf0393d01bfde8c6e4d0c6b7f3` | yes |

Total deploy + registration + `configurePool` gas for the current stack: **6,102,241**.

Superseded deployments, kept so the earlier evidence in this file still resolves. They remain on
chain and verified; nothing points at them any more.

| Contract | Address | Superseded by |
|---|---|---|
| `ProvenFeedRegistry` | `0x89ab0ad8768CD06d0f3bc134ad2407705a49d309` | FR-32 (`recordRoundBatch`) |
| `ProvenFeedAdapter` | `0x678C84Fe193a569FbDAF58e5f0d8f290a4072735` | its registry being replaced |
| `PegGuard` | `0x367693043C3E8396252728cAEBfBAB3fF43c78d5` | FR-30 (proportional payout) |
| `PegGuard` | `0xc836457AD046a329E93e40A4B747E90ee53B85bC` | FR-20 (prover bounty) |
| `PegGuard` | `0xB1aBE0D450B778fDb32Df54bb529F72d531ae8CE` | the `PoolWipedOut` fix |

## Registered feeds

Aggregator addresses were read from the live proxies at registration time by
`npm run pf -- register` — none was typed by hand (CLAUDE.md rule 3).

| Feed | `feedId` | Chain key | Phase | Aggregator | Tx |
|---|---|---|---|---|---|
| USDC / USD | `0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256` | 3 | 3 (current) | `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7` | `0x175e2c7cb589317c87487eea0b0dabad04dfaa5f6d058a6bd8e33c59b6570937` |
| USDC / USD | same | 3 | 2 (historical) | `0x789190466E21a8b78b8027866CBBDc151542A26C` | `0x42643f7464104bf0a7c0cfd453999a82825c4685d09fabe1e179a62a4749aa88` |
| USDC / USD | same | 3 | 1 (historical) | `0x3B15a92872435C01c27201AAe0968839fB45217D` | `0x9c567a66320b7dccd0e47ee1e222ea83c682fd84ae70f59046f996e061e30439` |
| ETH / USD | `0x62ddc8c5ffbd077b5a28e92efd10abcc58e66fb2a326401f0efd02e173ac1777` | 3 | 7 (current) | `0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5` | `0xe9a138903d47686bab68c8fcb7195d83675c7bc5ae8e9d5ed8b16a546f389996` |
| USDT / USD (FR-22) | `0xf790b27ce47f4ec92e603d65b16f1ed25bd38cea1ec25e8fe439238ad19af514` | 3 | 3 (current) | `0x0d5F4aADf3fde31BBB55dB5F42C080F18aD54Df5` | `0x3c49623d43e18284c84c226deefba145bb326aa3beded4107ab3b843c7db18a8` |

Registering two phases of USDC/USD under one `feedId` is what lets a 2023 round and a 2026 round
coexist without colliding (D-04).

## Proven rounds — real Ethereum mainnet Chainlink transactions

These were proven into registry `0x89ab0ad8…`, since superseded. The same rounds were re-proven into
the current registry — see **P2** below for the 2023 depeg's current hash, and the batch section for
the ETH/USD rounds. Kept here because the source transactions and gas figures are unchanged, and the
Etherscan side of each row is what a reviewer actually checks.

| Round | Answer | Chainlink `updatedAt` | Source block / tx | CC3 `recordRound` tx | Gas |
|---|---|---|---|---|---|
| USDC/USD `55340232221128656026` (phase 3, agg 1178) | **$0.99988765** | 2026-09-07T08:00:23Z | `25,924,144` / `0x17e282ab446e6df3ac984046c5e17dbc0d47f4967842e2819b23fb91f85fc3ca` | `0xcca535ffa9d73b0e1d6c512fdd0d186acda014ca54248e981e0bc2c063eb3ebf` | **320,546** |
| USDC/USD `36893488147419104215` (phase 2, agg 983) — **the 2023 SVB depeg low** | **$0.88000000** | 2023-03-11T07:51:23Z | `16,803,472` / `0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8` | `0x51391915f812b640d8eafafdfd44205777d37d12d33c7319c9dc467b0f912d06` | **628,299** |
| ETH/USD `129127208515966894708` (phase 7) | $2487.46409473 | 2026-09-07T18:39:35Z | `25,927,324` / `0xf46f33021b2664d6278e831361637abab5186447d3f30aa0eddf5addbaf160bb` | `0x7e122da1a91beaf71df35ebfdf13a57ab1cd64b3cf40880a99cde009e00faff2` (by `pf watch`) | **276,385** |

Each of those receipts contains **both** `TransactionVerified` emitted by the precompile at
`0x…0FD2` **and** `RoundProven` emitted by the registry. Open either hash on Blockscout, then open
the corresponding Etherscan tx, and the `answer` / `roundId` / `updatedAt` match exactly.

`latestRoundId` did **not** regress when the 2023 round was proven after the 2026 one (INV-05,
observed on chain).

## PegGuard lifecycle — P0

On `PegGuard` `0xc836457AD046a329E93e40A4B747E90ee53B85bC`, since superseded twice (FR-20, then
FR-30). This is the original P0 claim-by-proof evidence; the current lifecycle is in **P2** below.

| Step | Tx | Gas |
|---|---|---|
| `configurePool` ETH/USD (50 bps/30d, waiting 0, max 100 CTC) | `0x1740fdc8c0b3f0c8ae6e84da3aed0caafcd1e0b7ef5962ca1b7fafef4e9f6aa7` | — |
| `configurePool` USDC/USD | `0x3ed4bd33421b59ec88a224b027a82368e92a9ffd5a6ab44bccc8313fdf731baa` | — |
| `deposit` 200 CTC (ETH/USD pool) | `0x709f45fa0f21d906bacbf579ef4a7b99b016c8a7d79a81a426151ca9df9d41bd` | 243,180 |
| `buyCover` policy 0 — strike $2736.21, notional 50 CTC, 7 days, premium 0.0583333 CTC | `0x5def8f253acb9ca8df10c90f234b7aa5027f20b718dc7011b3395bef9d372657` | 192,632 |
| **`proveAndClaim` → `ClaimPaid`** | `0xb90dda642a3e77ab296ffdc0dd4521e6225b2653a301dc162123ac0a3776e39c` | **374,374** |

That single transaction contains all four events, in order:
`TransactionVerified(3, 25930684, 0)` from the precompile → `RoundProven` → `LatestRoundUpdated`
→ `ClaimPaid(policyId 0, roundId 129127208515966894720, holder …97D7, 50 CTC)`.

The breaching round: ETH/USD **$2474.22860000** at 2026-09-08T05:53:59Z, mainnet block 25,930,684,
tx `0x2f0aead47a7638027a5dce7225d7738d88593ad388955a8b3ac604b01c083896` — below the $2736.21 strike
and inside the coverage window. Nobody approved the payout; the round did.

Holder balance moved **9599.877471 → 9649.877284 CTC** (+49.999813 net of gas on a 50 CTC notional).

Pool state after settlement, read back on chain:

| Field | Value | Check |
|---|---|---|
| `balance` | 150.058333333333333333 CTC | 200 deposited + 0.0583333 premium − 50 paid out, exact |
| `locked` | 0 | capacity released by the claim |
| `totalShares` | 200 | unchanged — a claim does not burn LP shares |
| contract CTC balance | 150.058333333333333333 | equals `balance` to the wei: solvent |
| policy 0 | `CLAIMED`, `claimRoundId = 129127208515966894720` | pays at most once (INV-08) |

Note the `prover` field in that `RoundProven` is the PegGuard contract, not the wallet — because
`proveAndClaim` is what called `recordRound`. Anyone may pay that gas (INV-09: the payout still goes
to `policy.holder`).

On the superseded `PegGuard` at `0xB1aBE0D450B778fDb32Df54bb529F72d531ae8CE` (kept for history):
`configurePool` `0xbe1e8dc0…`, `0x0e3c7e70…`; `deposit` `0x273d8b44…` (242,634 gas);
`buyCover` `0xce91e723…` (192,632 gas).

### Why PegGuard was redeployed

Self-review found that `claim` reduces `pool.balance` without burning shares, so a pool can be
drained to **exactly** zero while shares are still outstanding — and the next `deposit` then priced
itself against a zero balance and hit `panic 0x12` (division by zero) instead of reverting cleanly.
Reachable whenever the premium rounds to zero, which a `premiumBpsPer30d = 0` pool permits.

`deposit` now reverts `PoolWipedOut(feedId)` in that state, and the worthless shares can be burned
via `withdraw` (which pays 0), after which the pool accepts liquidity again. Regression test:
`test_Deposit_RevertsCleanlyWhenThePoolWasFullyPaidOut` — confirmed to fail with exactly that
`panic 0x12` when the guard is removed.

The superseded instance still holds 200 CTC of testnet liquidity and one ACTIVE policy. It was left
in place rather than drained: it is testnet CTC, and the history is worth more than the funds.

### Why the claim demo does not use the 2023 depeg round

`buyCover` sets `start = block.timestamp + waitingPeriod`, so **cover always begins in the future**.
That is deliberate: it must be impossible to buy cover for a depeg that has already printed.
Consequently the 2023 round — which this project *can* prove, and did — can never satisfy a policy
bought today.

So the demo splits cleanly, and the README says so plainly:

- **Feed import (Branch H):** the real 2023-03-11 USDC/USD depeg round, $0.88, proven on Creditcoin.
- **Claim (Branch L):** an ETH/USD policy whose strike sits above spot, so the next ordinary
  Chainlink round breaches it inside the coverage window. The contract path is identical to a real
  depeg claim; only the strike differs.

## Measurements

### Gas (real receipts, CC3 block cap 75,000,000)

| Operation | Continuity roots | Gas | % of block |
|---|---|---|---|
| `ProbeASC.execute` (live round) | 57 | 182,238 | 0.240% |
| `ProbeASC.execute` (2023 round) | 529 | 511,393 | 0.682% |
| `recordRound` (live round) | 57 | **320,546** | 0.427% |
| `recordRound` (2023 round) | 529 | **628,299** | 0.838% |
| `recordRound` (ETH/USD, keeper) | 57 | 276,385 | 0.369% |
| `recordRound` (2023 round, current registry) | 529 | **650,223** | 0.867% |
| `recordRoundBatch` (3 rounds, 4-block burst) | 24 shared | **769,283** | 1.020% |
| `recordRoundBatch` (3 rounds, 390-block span) | 391 shared | 1,052,808 | 1.400% |
| `registerFeed` | — | ~151,000–176,456 | 0.235% |
| `deposit` | — | 243,180–315,840 | 0.421% |
| `buyCover` (FULL) | — | 241,212 | 0.322% |
| `buyCover` (PROPORTIONAL) | — | 190,060 | 0.253% |
| `proveAndClaim` (FR-20 + FR-30) | 41 | 449,666 | 0.600% |
| `claim` on an already-proven round | — | 339,346 | 0.453% |
| `withdrawBounty` | — | 158,032 | 0.211% |

**NFR-01 (≤ 2,000,000 gas per `recordRound`) is met with ~3× margin even on the deepest proof
available.** Cost scales with the continuity-proof length, not with the age of the round per se:
9× the roots cost roughly 2× the gas. `recordRoundBatch` obeys the same law — which is exactly why
its saving depends on the batch's block span rather than on how many rounds it carries (see **P2**).

Gas estimation via `eth_estimateGas` **worked on every call** — the documented pallet-evm fallback
(docs/04 §5) was never needed. It remains in the code for other chains.

### Attestation

| Metric | Value |
|---|---|
| Attestation lag (mainnet head → attested) | **7.4–8.8 min** (37–44 blocks), stable across five measurements |
| `getProof` latency, fresh transaction | 1.9–2.4 s (`cached=true`) |
| `getProof` latency, 2023 transaction | ~18 s (`cached=true`) |
| Deep-history coverage | continuity bounds attested at least back to block 16,810,000 (March 2023) |

## Reproducing

```bash
npm ci
cd contracts && forge test            # 130 tests, no network access
cd .. && npm run test:cli             # 25 tests
npm run pf -- spike                   # re-runs every Day-1 gate against the live network
npm run pf -- prove --feed USDC/USD --latest
npm run pf -- prove-batch --feed ETH/USD --count 3 --compare --dry-run   # FR-32 gas comparison
```

## P1 — prover bounty (FR-20)

Run on PegGuard `0x367693043C3E8396252728cAEBfBAB3fF43c78d5`, since superseded by the FR-30
deployment. The evidence stands: the bounty mechanism is unchanged in the current contract, and the
P2 lifecycle below exercises it again on the live addresses.

| Step | Tx | Gas |
|---|---|---|
| `deposit` 200 CTC (ETH/USD) | `0x6e40dc1e7955fdbec1e43372be14dac2b4e685846a864bf5fa1a7080c5edcbe3` | — |
| `buyCover` — strike $2766.65, 50 CTC, 7 days, premium 0.0583333 CTC | `0x1f842510a731c348e3ef7a0e3470ec5204c93fec3ef214c31359c0d3027d6962` | 237,897 |
| **`proveAndClaim`** — five events incl. `BountyAccrued` | `0x9427273f95483be97491eee0010960710ab938865756de85855cb1cd7f4b4e52` | **394,142** |
| `withdrawBounty` | `0xa3ca0e60de8f7b54c22fcbbd079a787816b705ff5d2ae80ecb5412dcab1d353d` | 125,776 |

Breaching round: ETH/USD **$2491.46085391** at 2026-09-09T05:46:47Z, mainnet block 25,937,816,
tx `0xae0e83e13386d4f1fbf3a7fa36349cb6d4d9533bceb0d193f6569c6f897ac8a2`.

The premium split, verified on chain: premium **0.058333333333333333** CTC, of which
**0.011666666666666666** (20%) was escrowed as bounty and **0.046666666666666667** reached the pool.
`bountyEscrow()` read back exactly the escrowed figure while the policy was live, and zero after the
withdrawal.

Final accounting, read back after settlement:

| Field | Value | Check |
|---|---|---|
| pool `balance` | 150.046666666666666667 CTC | 200 deposited + 0.0466666 kept premium − 50 paid, exact |
| pool `locked` | 0 | released by the claim |
| `bountyEscrow` | 0 | accrued, then withdrawn |
| `bountyOwed(prover)` | 0 | cleared by the withdrawal |
| contract CTC balance | 150.046666666666666667 | equals `balance` to the wei, escrow empty: solvent |

Note which address earned it. The registry recorded PegGuard as the prover on the `proveAndClaim`
path, so the bounty fell through to the caller who proved it in that same transaction — the designed
behaviour, and the reason a keeper that proves a round separately still earns it.

## Keeper (`pf watch`) run

| Metric | Value |
|---|---|
| Run window | 2026-09-08 14:17Z - 2026-09-09 06:14Z (**~16 hours**) |
| Poll iterations | 120 s interval, unattended overnight |
| Rounds proven unattended | **8** |
| Errors | **1**, recovered |
| Behaviour observed | detected a new round, found its block not yet attested, waited ~4 min via `waitUntilHeightAttested`, fetched the proof, dry-ran it, submitted (272,801 gas) - with no intervention |

`docs/06` Day 4 asks for a **>= 6 h** soak. This run was ~16 hours and satisfies it.

The single error is the designed failure path, not a crash: `Timeout waiting for height 25933335 to
be attested on chain key 3`. One round's block did not attest inside the 20-minute wait, the keeper
logged it and continued to the next iteration, proving seven more rounds afterwards. Full log in
`docs/watch-log.txt`. Re-run with `npm run pf -- watch --feed ETH/USD`.

## Deploy path, verified

`npm run pf -- deploy --proxy USDC/USD --all-phases` deploys the whole stack in one command and
registers the feed from values read off the live Chainlink proxy. It was executed end-to-end on CC3
to prove the documented path actually works:

| Contract | Address (verification run) | Gas |
|---|---|---|
| `ProvenFeedRegistry` | `0x2BC0B4A5ab33E9F0105664FA92DEAF87381BD12c` | 2,077,932 |
| `ProvenFeedAdapter` | `0x0dCe76c6660216C1FE0D810C723A9C6eD85Ef57b` | 549,744 |
| `PegGuard` | `0xC2763E1b76519C5808Ad502a1309E5Da35fa73Fa` | 1,517,627 |
| 3 × `registerFeed` (phases 3, 2, 1) + `configurePool` | — | 693,966 |
| **total** | | **4,839,269** |

**This is a verification deployment, not the demo one.** The canonical addresses at the top of this
file are what the README, the CLI defaults and the demo use, because they hold the proven rounds and
the settled claim. The run above exists so that "here is how you deploy it" is a tested claim rather
than an untested one.

## P2 — proportional payout (FR-30) and batch proving (FR-32)

Run on the current stack: registry `0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed`,
PegGuard `0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e`.

### The 2023 depeg, re-proven into the current registry

| Step | Tx | Gas |
|---|---|---|
| `recordRound` — USDC/USD **$0.88000000**, 2023-03-11T07:51:23Z | `0x5c5f1c6d7351ccd1c2418c75bff1ae345734b026f12d7b7ea483b211aadb3a7c` | 650,223 |

Source: Ethereum mainnet block 16,803,472, tx
`0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8`, proof carrying 7 Merkle
siblings and 529 continuity roots.

### FR-30 — two payout modes, one round, side by side

Both policies were written on ETH/USD at the **same strike** ($2754.35680339, 10% above spot so the
next natural round breaches it — Branch L, as documented below) and the **same 50 CTC notional**,
then settled against the **same proven round**: ETH/USD **$2511.25370000** at 2026-09-09T07:23:59Z,
mainnet block 25,938,300.

| Step | Tx | Gas |
|---|---|---|
| `configurePool` ETH/USD — 50 bps/30d full, 30 bps/30d proportional, 20% bounty | `0xb6fad70e7d3a785756c320dde44f5e12bfe8c45249c0ed3e077e555268b6ac0e` | 315,294 |
| `deposit` 200 CTC | `0xe95cf6aa07d8c5a8b13552936a7eb905d5412c7508dfb8f8f0466a2216c9cd54` | 315,840 |
| `buyCover` policy 0 — **FULL**, premium 0.058333333333333333 CTC | `0x7d0b1af562f6d24b42d3677ba34a3a6f55edb0653b0bab1f047a3db66db019ab` | 241,212 |
| `buyCover` policy 1 — **PROPORTIONAL**, premium 0.035 CTC | `0xef6a9d22c36ea4f1918916a76a0fade711c663a8c955c9ba0b6546f054e37198` | 190,060 |
| `proveAndClaim` policy 0 — five events | `0xa6c5ffa8f670e590d2b1b36f559a48e03cb4eadb97c333e56c72703e4dbd36b6` | 449,666 |
| `claim` policy 1 — round already proven, so no second proof is paid for | `0x013188937ea2bede2fe7e41657bfe0a029b4cbd464dd2b11be049a0f9d701d52` | 339,346 |
| `withdrawBounty` — both bounties at once | `0xf73096088d9b7adcd027c20601fa7052a9e4f4596c183cd62116c67c09ab171e` | 158,032 |

The two `ClaimPaid` events, from the identical round:

| Policy | Mode | Premium | Payout | Released to the pool |
|---|---|---|---|---|
| 0 | `FULL` | 0.058333333333333333 CTC | **50.000000000000000000 CTC** | 0 |
| 1 | `PROPORTIONAL` | 0.035 CTC | **4.413064841323284691 CTC** | 45.586935158676715309 CTC |

That is the formula, checked against the chain:
`50 × (275435680339 − 251125370000) / 275435680339 = 4.413064841323284691`.
Proportional cover cost **40% less** (30 bps against 50 bps) because it pays only the depth of the
breach. Both policies reserved the full 50 CTC while live — the pool's worst case — and the
proportional policy handed 45.58 CTC back the moment it settled.

Final accounting, read back after settlement:

| Field | Value | Check |
|---|---|---|
| pool `balance` | 145.661601825343381976 CTC | 200 + 0.046666666666666667 + 0.028 − 50 − 4.413064841323284691, exact |
| pool `locked` | 0 | both policies released their full reserve |
| `bountyEscrow` | 0 | 0.018666666666666666 CTC accrued across both policies, then withdrawn |
| contract CTC balance | 145.661601825343381976 | equals `balance` to the wei: solvent |

### FR-32 — several rounds, one continuity proof

| Step | Tx | Rounds | Gas |
|---|---|---|---|
| `recordRoundBatch` — 3 ETH/USD rounds inside a **4-block** burst | `0x882c6ae14cb691ce9d1da231ea4d1733b09e5b986d833f17b529c4217ea33da2` | 3 | **769,283** |
| `recordRoundBatch` — 3 ETH/USD rounds across **390 blocks** | `0xbe6c6e4be6a2d961d7d250152e1654d55d14af40b88298437a5c0ccb4813eef2` | 3 | 1,052,808 |

Each receipt carries one `TransactionVerified` from `0x…0FD2` per transaction and one `RoundProven`
per round, from a **single** call to the precompile's batch overload.

**Batching is not automatically cheaper, and the numbers say so.** A shared continuity proof must
reach from the first block in the set to the last, while each single proof only reaches its own
nearest attestation checkpoint — roughly 100 blocks away. Measured with
`npm run pf -- prove-batch --compare --dry-run`, which estimates both sides against the live chain
without spending anything:

| Rounds | Span | Σ single-proof roots | Shared roots | Separately | Batched | Δ |
|---|---|---|---|---|---|---|
| 3 | **4 blocks** | 24 + 20 + 20 = 64 | **24** | 939,766 | **769,283** | **−18.1%** |
| 3 | 390 blocks | 91 + 85 + 1 = 177 | 391 | 1,084,232 | 1,052,808 | −2.9% |
| 2 | 247 blocks | 41 + 94 = 135 | 341 | 691,338 | 792,207 | **+14.6%** |
| 4 | 845 blocks | — | 939 | 1,340,319 | 1,727,572 | **+28.9%** |
| 5–6 | 1,148–1,451 blocks | — | — | — | prover returns **HTTP 400** | refused |

So batching pays for a burst — a volatility cluster, or several feeds transmitting together — and
costs more for rounds spread across a quiet hour. `pf prove-batch` warns when the span exceeds 100
blocks rather than letting a keeper discover this by spending gas. What batching buys unconditionally
is atomicity: N rounds land in one transaction or none do.

The two rows that are actual on-chain transactions are the first and second; the rest are
`--dry-run` estimates against the same live contract, reproducible with the command above.

The prover's own limit is worth recording: `/api/v1/proof-batch-by-tx` refuses spans beyond roughly
a thousand blocks with HTTP 400, so `MAX_BATCH = 16` in the registry is never the binding constraint
in practice.

### FR-31 — researched, and deliberately not shipped

FR-32's sibling was "permissionless feed registration gated by proving the proxy's
`AggregatorUpdated`-style upgrade event (research)". The research answer is that the event does not
occur.

Chainlink's `AggregatorProxy` emits `AggregatorConfirmed(address,address)`
(`0x33745f67a407dcb785417f9c123dd3641479a102674b6e35c1f10975625b90e9`) when the aggregator behind a
proxy is rotated. Scanning Ethereum mainnet from block **16,500,000** (February 2023, the start of
the attestable window) to **25,938,051** found **zero** such events across thirteen major feeds:
USDC/USD, USDT/USD, ETH/USD, BTC/USD, DAI/USD, LINK/USD, WBTC/BTC, stETH/USD, AAVE/USD, UNI/USD,
MATIC/USD, SNX/USD and CRV/USD. Established mainnet feeds are upgraded by changing OCR configuration
inside the same aggregator contract, not by swapping the aggregator behind the proxy.

The feature would therefore have shipped as an owner-bypass path into the registry that no proof
could ever exercise — untestable against reality, and a security surface with no evidence behind it.
Registration stays `onlyOwner`, which the README already discloses as centralization of
*configuration*, never of data. Reproduce the scan by proving any `AggregatorConfirmed` transaction
you can find; if Chainlink rotates an aggregator in future, the mechanism described here becomes
implementable exactly as specified.

## Known operational issues

1. **`forge script` cannot run against CC3.** The node's `eth_getBlockByNumber` response omits
   `mixHash`, so Foundry's block deserializer fails with `` `prevrandao` not set `` before the script
   executes — `--legacy` and `--skip-simulation` do not help, because the failure is in building the
   execution environment, not in the transaction. `forge create` and `cast send` are unaffected (they
   log the deserialization error and proceed), so the deployment used those. `script/Deploy.s.sol` is
   kept as the documented, chain-agnostic path, and `npm run pf -- deploy` is the tested one. This
   resolves docs/09 **Q5** with a different root cause than the one anticipated.
2. **A cold `pf watch` must not back-fill.** The first implementation swept a 20,000-block window on
   startup and began proving all 77 historical ETH/USD rounds it found, spending real gas. Cold-start
   look-back is now `--backfill`, default 300 blocks (~1 h).
3. Prover health reports `"status":"degraded"` with `cc3_rpc_connected:false` as its steady state.
   Proving works regardless; do not treat it as a NO-GO.
