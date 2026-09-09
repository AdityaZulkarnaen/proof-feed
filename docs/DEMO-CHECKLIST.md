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
(131 tests, green, no network) — and even that needs `npm ci` to have run once before.

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

`https://creditcoin-testnet.blockscout.com/tx/0x5c5f1c6d7351ccd1c2418c75bff1ae345734b026f12d7b7ea483b211aadb3a7c`

Scroll to the logs. Two things must be visible together:
- `TransactionVerified` emitted by `0x…0FD2` — the precompile
- `RoundProven` emitted by the registry, `answer = 88000000`

> "The precompile verified inclusion and continuity. The contract then decoded the log out of the
> bytes the precompile had just verified. 650,000 gas — under one percent of a Creditcoin block."

**1:10 — The Chainlink interface**

```bash
cast call 0x639f24D0E4298031Da29E523a81910166596027D   "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 36893488147419104215   --rpc-url https://rpc.cc3-testnet.creditcoin.network
```

> "A three-year-old Chainlink round, readable on Creditcoin through the ordinary
> AggregatorV3Interface. Any contract already written for Chainlink works unmodified."

**1:25 — Blockscout, the claim**

`https://creditcoin-testnet.blockscout.com/tx/0xa6c5ffa8f670e590d2b1b36f559a48e03cb4eadb97c333e56c72703e4dbd36b6`

Five events in one transaction: `TransactionVerified` → `RoundProven` → `LatestRoundUpdated` →
`BountyAccrued` → `ClaimPaid`.
> "A policy paid 50 CTC because a Chainlink round printed below its strike. Proved and settled in a
> single transaction. Nobody approved it — the round did. And a slice of the premium went to whoever
> proved that round, which is what makes running the keeper worth someone's gas."

**1:50 — The same round, paid two ways**

`https://creditcoin-testnet.blockscout.com/tx/0x013188937ea2bede2fe7e41657bfe0a029b4cbd464dd2b11be049a0f9d701d52`

Put policy 1's `ClaimPaid` next to policy 0's. Same strike, same notional, same round.
> "Fifty CTC and four-point-four CTC, from the identical Chainlink round. Full cover is a trigger.
> Proportional cover pays the depth of the breach — an eight-point-eight percent drop pays
> eight-point-eight percent — and costs forty percent less, because it pays less. The rest of the
> reserve goes straight back to the liquidity providers."

**2:15 — Three rounds, one proof**

`https://creditcoin-testnet.blockscout.com/tx/0x882c6ae14cb691ce9d1da231ea4d1733b09e5b986d833f17b529c4217ea33da2`

Point at the three `TransactionVerified` logs from `0x…0FD2`.
> "Three Chainlink rounds, one shared continuity proof, one transaction. Eighteen percent cheaper
> than proving them separately — but only because these three landed inside four blocks. Spread them
> across an hour and batching costs more, because the shared proof has to span the gap. The README
> publishes both numbers, and the CLI warns you before you spend the gas."

**2:35 — README limitations**

> "What it does not do: prove state, prove freshness, or write back to Ethereum. It proves a round
> happened, which is exactly what a parametric claim needs. And you cannot buy cover for a depeg
> that already printed — cover always starts in the future. That is why the claim demo uses a live
> round, and the README says so."

**2:50 — Repo + links.** End.

## Rules

- Show real hashes, never slides after the title card.
- If anything is pre-recorded or cached, say so on screen.
- Do not claim "latest price" or "real-time" — the feed is a **lower bound** (CLAUDE.md, docs/09 §C).

## The links, in one place

| What | URL |
|---|---|
| Repo | https://github.com/AdityaZulkarnaen/proof-feed |
| Registry | https://creditcoin-testnet.blockscout.com/address/0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed |
| Adapter | https://creditcoin-testnet.blockscout.com/address/0x639f24D0E4298031Da29E523a81910166596027D |
| PegGuard | https://creditcoin-testnet.blockscout.com/address/0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e |
| 2023 depeg proven | https://creditcoin-testnet.blockscout.com/tx/0x5c5f1c6d7351ccd1c2418c75bff1ae345734b026f12d7b7ea483b211aadb3a7c |
| Claim paid (FULL) | https://creditcoin-testnet.blockscout.com/tx/0xa6c5ffa8f670e590d2b1b36f559a48e03cb4eadb97c333e56c72703e4dbd36b6 |
| Claim paid (PROPORTIONAL) | https://creditcoin-testnet.blockscout.com/tx/0x013188937ea2bede2fe7e41657bfe0a029b4cbd464dd2b11be049a0f9d701d52 |
| Batch — 3 rounds, one proof | https://creditcoin-testnet.blockscout.com/tx/0x882c6ae14cb691ce9d1da231ea4d1733b09e5b986d833f17b529c4217ea33da2 |
| Landing page | `cd web && npm run dev`, or your Vercel URL |
| Project deck (PDF) | [`docs/ProofFeed-Deck.pdf`](ProofFeed-Deck.pdf) — or `/deck` on the deployed site |
| Source depeg tx (Etherscan) | https://etherscan.io/tx/0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8 |
