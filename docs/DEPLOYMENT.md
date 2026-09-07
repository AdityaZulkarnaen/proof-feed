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

| Contract | Address | Deploy tx | Verified |
|---|---|---|---|
| `ProvenFeedRegistry` | `0x89ab0ad8768CD06d0f3bc134ad2407705a49d309` | `0x49d8c38c12b31f73e1769379935bed6bdac25569365c44968007d3d1ff6edb8d` | yes |
| `ProvenFeedAdapter` (USDC/USD) | `0x678C84Fe193a569FbDAF58e5f0d8f290a4072735` | `0x47b523e97bcd004e359301c900f12a029932a84d7dae2ffbc38a42b090d11ea8` | yes |
| `PegGuard` | `0xB1aBE0D450B778fDb32Df54bb529F72d531ae8CE` | `0x70aab9e57257fa81679f4754a2be991f3107dc9d5030eabaf79b6a2072839c74` | yes |
| `ProbeASC` (Day-1 spike only, **not** part of the demo path) | `0x846D0C55a916e925331599bf086f9B203E68917B` | `0x154a414171c8e0e210f7f5a749d885972dbaa8bf0393d01bfde8c6e4d0c6b7f3` | yes |

## Registered feeds

Aggregator addresses were read from the live proxies at registration time by
`npm run pf -- register` — none was typed by hand (CLAUDE.md rule 3).

| Feed | `feedId` | Chain key | Phase | Aggregator | Tx |
|---|---|---|---|---|---|
| USDC / USD | `0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256` | 3 | 3 (current) | `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7` | `0xe545dee3f704d6094564febe48b0fcc33d068af155e7572dfb82a8bc395d5173` |
| USDC / USD | same | 3 | 2 (historical) | `0x789190466E21a8b78b8027866CBBDc151542A26C` | `0x6600f68ff81acf6016bc0997358bb80c80d5bed4b7c8a19e1b7d2e1f85a6ecbe` |
| ETH / USD | `0x62ddc8c5ffbd077b5a28e92efd10abcc58e66fb2a326401f0efd02e173ac1777` | 3 | 7 (current) | `0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5` | `0x14120825b06788ad93c82b045e918f454a5d5224ffe1e7dd78bee96f34c471ae` |

Registering two phases of USDC/USD under one `feedId` is what lets a 2023 round and a 2026 round
coexist without colliding (D-04).

## Proven rounds — real Ethereum mainnet Chainlink transactions

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

## PegGuard lifecycle

| Step | Tx | Gas |
|---|---|---|
| `configurePool` USDC/USD (50 bps/30d, waiting 0, max 100 CTC) | `0xbe1e8dc0e2e4f035e79b8a9df07fccadfe560cb58fa5a97da40608d2062463d1` | 241,192 |
| `configurePool` ETH/USD | `0x0e3c7e70b7cff917b3abb26d2ad0617b05d1c89cc8ee42cbc1745696608f6028` | — |
| `deposit` 200 CTC (ETH/USD pool) | `0x273d8b442650a58cb2a6b81dac8523322d7375729536a50947163dae97a53f53` | 242,634 |
| `buyCover` policy 0 — strike $2736.21, notional 50 CTC, 7 days, premium 0.0583333 CTC | `0xce91e723678fa3e829a759cb217b609f0fd35216b958e4dd9ebbcab0ad48e88d` | 192,632 |
| `claim` / `proveAndClaim` → `ClaimPaid` | _pending — see "Claim demo" below_ | |

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
| `registerFeed` | — | ~151,000 | 0.201% |
| `deposit` | — | 242,634 | 0.324% |
| `buyCover` | — | 192,632 | 0.257% |

**NFR-01 (≤ 2,000,000 gas per `recordRound`) is met with ~3× margin even on the deepest proof
available.** Cost scales with the continuity-proof length, not with the age of the round per se:
9× the roots cost roughly 2× the gas.

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
cd contracts && forge test            # 89 tests, no network access
cd .. && npm run test:cli             # 18 tests
npm run pf -- spike                   # re-runs every Day-1 gate against the live network
npm run pf -- prove --feed USDC/USD --latest
```

## Known operational issues

1. **`forge script` cannot run against CC3.** The node's `eth_getBlockByNumber` response omits
   `mixHash`, so Foundry's block deserializer fails with `` `prevrandao` not set `` before the script
   executes — `--legacy` and `--skip-simulation` do not help, because the failure is in building the
   execution environment, not in the transaction. `forge create` and `cast send` are unaffected (they
   log the deserialization error and proceed), so the deployment used those. `script/Deploy.s.sol` is
   kept as the documented, chain-agnostic path. This resolves docs/09 **Q5** with a different root
   cause than the one anticipated.
2. **A cold `pf watch` must not back-fill.** The first implementation swept a 20,000-block window on
   startup and began proving all 77 historical ETH/USD rounds it found, spending real gas. Cold-start
   look-back is now `--backfill`, default 300 blocks (~1 h).
3. Prover health reports `"status":"degraded"` with `cc3_rpc_connected:false` as its steady state.
   Proving works regardless; do not treat it as a NO-GO.
