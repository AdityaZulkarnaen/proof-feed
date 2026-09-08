# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router, TypeScript), chosen by the user. Deployed to Vercel with the project root set to
`web/`. Standalone package inside the `proof-feed` monorepo, deliberately outside the root
`workspaces: ["cli"]` array so Vercel can install it in isolation.

## Users

**Primary: hackathon judges (BUIDL CTC 2026 Fall, DeFi track).** Skeptical, time-boxed to roughly
five minutes per project, evaluating "depth of Attestcoin Protocol utilization". They arrive from
DoraHacks, want to know quickly whether the thing is real, and will click through to Blockscout and
Etherscan to check. Overclaiming loses them; disclosed limitations earn them.

**Secondary: Creditcoin developers.** Arrive asking "can I use this for a USD price in my contract,
and what exactly am I trusting?" They need the adapter's shape and the honest trust boundary.

Judges are served first in page order; developers get a dedicated section below.

## Product Purpose

ProofFeed makes real Ethereum-mainnet Chainlink price rounds usable on Creditcoin without a trusted
relayer, by proving the mainnet transaction that carried each round through the Attestcoin Protocol.
PegGuard is a parametric depeg cover built on it that settles claims by proof rather than by an
adjuster.

This page is the single link the project is judged and shared from. Success is a judge concluding,
without help, that the numbers shown are real and the claims are not inflated.

## Positioning

A Chainlink round update *is* a mainnet transaction whose receipt contains
`AnswerUpdated(current, roundId, updatedAt)`. The Attestcoin Protocol can prove any mainnet
transaction to Creditcoin. Connecting those two facts means a price can enter Creditcoin with no
project-run server anywhere in the trust path.

The claim a neighbouring project cannot truthfully copy: **there is no `setPrice`.** The contract
owner can register which aggregator belongs to which feed - configuration - but cannot write, alter,
or delete a price. A structural test over the compiled ABI enforces it.

The second, sharper claim: the actual 2023-03-11 USDC depeg round, $0.88, is stored on Creditcoin,
proven from the original mainnet transaction.

## Operating Context

Judges open the page cold, on desktop or phone, from a DoraHacks listing, alongside a 3-minute video.
They cross-check by opening a Creditcoin Blockscout transaction and the matching Etherscan
transaction and comparing the values. The page must survive that comparison exactly.

## Capabilities and Constraints

- **Read-only.** No wallet connection, no write path. This is consistent with the security story and
  is not a limitation to apologise for.
- Reads live state from Creditcoin CC3 testnet RPC `https://rpc.cc3-testnet.creditcoin.network`
  (chainId 102031), which sends `access-control-allow-origin: *`.
- **FR-23 requirement:** the page must show whether the data displayed is live or cached. A failed
  RPC read must fall back to a committed snapshot that is labelled as such - never stale data
  presented as live.
- Two distinct clocks must never be conflated: Chainlink's mainnet `updatedAt` (when the price was
  published) and Creditcoin's `provenAt` (when the proof was accepted).
- Everything shown is **testnet**. Unaudited. Payout asset is testnet CTC.
- Deadline: 2026-09-14 03:59.

## Brand Commitments

- Names are `ProofFeed` (infrastructure) and `PegGuard` (product). "Chainlink" is referenced only as
  the data source, never as part of a product name (decision D-11, trademark caution).
- No logo, wordmark, or pinned palette exists. The user confirmed the identity is free to author;
  no image assets are pending from them.
- **Binding visual constraint the user set:** no nested cards, no gradient glow, no card border glow.
  Recorded as given, not expanded.
- Voice: plain and exact. The repository's own documents disclose limitations rather than discovering
  them later; the page must not adopt a more promotional register than the README it links to.

## Evidence on Hand

All real, all verifiable, all already on chain:

- 2023-03-11 USDC/USD depeg round, `$0.88000000`, Chainlink `updatedAt` 2023-03-11T07:51:23Z,
  mainnet block 16,803,472, proven on Creditcoin in `0x51391915…2d06` (628,299 gas).
- A current USDC/USD round proven in `0xcca535ff…3ebf` (320,546 gas).
- A PegGuard claim settled by proof in one transaction, `0xb90dda64…e39c` (374,374 gas), paying
  50 CTC.
- Contracts, all source-verified on Blockscout: registry `0x89ab0ad8…d309`, adapter
  `0x678C84Fe…2735`, PegGuard `0xc836457A…85bC`.
- 90 Foundry tests and 23 CLI tests, 98.7% line coverage on `src/`.
- Full evidence log at `../docs/DEPLOYMENT.md`; measurements at `../docs/spike-output.json`.

**Absences future work must not fabricate:** there is no demo video yet, no audit, no mainnet
deployment, no users, no testimonials, no benchmarks against competitors, and no uptime record. The
keeper has been observed running for 40 minutes, not the 6 hours the plan aspired to.

## Product Principles

1. **Every claim on the page links to something a stranger can verify.** A number without a
   transaction hash behind it does not belong here.
2. **Disclosed beats discovered.** The limitations section is a credibility asset; it is placed where
   a judge will actually read it, not buried.
3. **The data is the product.** Values, timestamps and hashes carry the argument; copy supports them.
4. **Two clocks, never merged.** Price time and proof time are always distinguishable.
5. **Match the repository's register.** The page may be striking, but it may not claim more than
   `README.md` claims.

## Accessibility & Inclusion

No product-specific standard was established. As a public submission page read on unknown devices,
the floor is: text contrast meeting WCAG AA, a layout that survives a phone viewport, and no meaning
carried by colour alone - transaction status and live/cached labels must read as text.
