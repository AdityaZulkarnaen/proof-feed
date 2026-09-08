# Demo recording checklist

Everything below is real and already on chain. Nothing needs to be set up first — the CLI defaults
to the live deployment, so even a fresh clone works.

## ⚠️ You need internet to record

Every step reads a live chain. **Without wifi almost nothing in this demo works:**

| Step | Needs internet? |
|---|---|
| Etherscan / Blockscout in the browser | **yes** |
| `npm run pf -- demo` | **yes** — reads CC3 and Ethereum mainnet live |
| `npm run pf -- prove` / `claim` | **yes** |
| `cast call` against CC3 | **yes** |
| `cd contracts && forge test` | no — the only thing that runs offline |

So: do not plan to record on the move. The one thing worth filming offline is `forge test`
(90 tests, green, no network) — and even that needs `npm ci` to have run once before.

## Before you hit record

```bash
cd <repo>
npm ci                        # once
cd contracts && forge test    # warm the cache so it is fast on camera
cd .. && npm run pf -- demo --yes   # confirm the live state still reads
```

`docs/demo-output.txt` holds a captured run if you want to check what the output should look like.

## Shot list (≤ 3 min)

**0:00 — Title card, 10 s**
> "Every price here is a real Ethereum mainnet Chainlink transaction, cryptographically verified on
> Creditcoin. No relayer. No admin key can insert a number."

**0:10 — Etherscan, the 2023 depeg**

`https://etherscan.io/tx/0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8`

Point at the `AnswerUpdated` log: `current = 88000000`.
> "March 11th, 2023. Silicon Valley Bank has failed, USDC has lost its peg, and this is the Chainlink
> round that printed 88 cents."

**0:30 — Terminal**

```bash
npm run pf -- demo --yes
```

Let it run. Narrate the `[surface]` lines — they name the exact Attestcoin call being made.
> "The CLI reads the aggregator off the proxy, never a hardcoded address. Then it asks the registry
> what it already holds."

**0:55 — Blockscout, the proof**

`https://creditcoin-testnet.blockscout.com/tx/0x51391915f812b640d8eafafdfd44205777d37d12d33c7319c9dc467b0f912d06`

Scroll to the logs. Two things must be visible together:
- `TransactionVerified` emitted by `0x…0FD2` — the precompile
- `RoundProven` emitted by the registry, `answer = 88000000`

> "The precompile verified inclusion and continuity. The contract then decoded the log out of the
> bytes the precompile had just verified. 628,000 gas — under one percent of a Creditcoin block."

**1:20 — The Chainlink interface**

```bash
cast call 0x678C84Fe193a569FbDAF58e5f0d8f290a4072735 \
  "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 36893488147419104215 \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network
```

> "A three-year-old Chainlink round, readable on Creditcoin through the ordinary
> AggregatorV3Interface. Any contract already written for Chainlink works unmodified."

**1:40 — Blockscout, the claim**

`https://creditcoin-testnet.blockscout.com/tx/0xb90dda642a3e77ab296ffdc0dd4521e6225b2653a301dc162123ac0a3776e39c`

Four events in one transaction: `TransactionVerified` → `RoundProven` → `LatestRoundUpdated` →
`ClaimPaid`.
> "A policy paid 50 CTC because a Chainlink round printed below its strike. Proved and settled in a
> single transaction. Nobody approved it — the round did."

**2:20 — README limitations**

> "What it does not do: prove state, prove freshness, or write back to Ethereum. It proves a round
> happened, which is exactly what a parametric claim needs. And you cannot buy cover for a depeg
> that already printed — cover always starts in the future. That is why the claim demo uses a live
> round, and the README says so."

**2:45 — Repo + links.** End.

## Rules

- Show real hashes, never slides after the title card.
- If anything is pre-recorded or cached, say so on screen.
- Do not claim "latest price" or "real-time" — the feed is a **lower bound** (CLAUDE.md, docs/09 §C).

## The links, in one place

| What | URL |
|---|---|
| Repo | https://github.com/AdityaZulkarnaen/proof-feed |
| Registry | https://creditcoin-testnet.blockscout.com/address/0x89ab0ad8768CD06d0f3bc134ad2407705a49d309 |
| Adapter | https://creditcoin-testnet.blockscout.com/address/0x678C84Fe193a569FbDAF58e5f0d8f290a4072735 |
| PegGuard | https://creditcoin-testnet.blockscout.com/address/0xc836457AD046a329E93e40A4B747E90ee53B85bC |
| 2023 depeg proven | https://creditcoin-testnet.blockscout.com/tx/0x51391915f812b640d8eafafdfd44205777d37d12d33c7319c9dc467b0f912d06 |
| Claim paid | https://creditcoin-testnet.blockscout.com/tx/0xb90dda642a3e77ab296ffdc0dd4521e6225b2653a301dc162123ac0a3776e39c |
| Source depeg tx (Etherscan) | https://etherscan.io/tx/0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8 |
