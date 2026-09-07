# CLAUDE.md — proof-feed

Project: **ProofFeed** (Chainlink rounds on Creditcoin, verified by the Attestcoin Protocol) and
**PegGuard** (parametric price-below-strike cover built on ProofFeed).
Hackathon: BUIDL CTC 2026 Fall, DeFi track. Submission deadline 2026-09-14 03:59 (verify timezone).

Full specification lives in `docs/`. This file is the short version you must never violate.

## Stack (fixed — do not substitute)

- Contracts: Solidity, **Foundry**. `solc 0.8.30`, `via_ir = true`, `evm_version = "shanghai"`.
  Dependencies from npm: `@gluwa/asc-contracts@0.2.1`, `@openzeppelin/contracts@5.x`.
  Base contract: `@gluwa/asc-contracts/contracts/readability/ASCBase.sol`.
  Decoder: `@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol` (internal library, no linking).
- Off-chain: **TypeScript** (Node 20+), `ethers@6`, `@gluwa/usc-sdk@0.18.0`, run with `tsx`.
- Target chain: **Creditcoin CC3 Testnet**, chainId `102031`, RPC `https://rpc.cc3-testnet.creditcoin.network`,
  explorer `https://creditcoin-testnet.blockscout.com`.
- Source chain: **Ethereum Mainnet = Attestcoin chain key 3** (primary). Sepolia = chain key 1 (fallback/tests only).
- Prover: `https://prover.cc3-testnet.creditcoin.network` (candidate B: `https://proof-gen-api.cc3-testnet.creditcoin.network`). Health-check both on Day 1; keep the one that answers `GET /api/v1/health`.

## Hard rules

1. **Attestcoin is the only way a price enters the system.** No admin function may write a price.
   No backend may assert a price. If you find yourself adding `setPrice`, stop.
2. **Every proven transaction must pass all of:** precompile verification (`recordRound` → inherited `ASCBase._verifyProof` → `0xFD2.verifyAndEmit`),
   `receiptStatus == 1`, decoded tx type valid, log emitter == registered aggregator for that
   `chainKey`, event signature == `AnswerUpdated(int256,uint256,uint256)`, `topics.length == 3`,
   `data.length == 32`. Missing any one is a security bug, not a nice-to-have.
3. **Never hardcode a Chainlink aggregator address in Solidity.** Aggregators are registered at
   deploy/registration time from `proxy.aggregator()` + `proxy.phaseId()` read at runtime by the CLI.
4. **No state proofs.** Attestcoin commits transaction history (tx + receipt + logs), not state.
   Never claim to prove `latestRoundData()`, balances, or "no newer round exists".
5. **One-directional.** Creditcoin reads Ethereum. Writability is not available on testnet. Never
   design a step that requires sending a message back to Ethereum.
6. **Mocks only under `contracts/test/`.** The demo path (`cli`, deploy scripts, README claims) must
   use the real prover, real precompile, real mainnet transactions.
7. **Facts come from `docs/05-TECH-REFERENCE.md`.** Anything marked `[VERIFY]` must be verified in the
   Day-1 spike and the result written back into that file with the evidence (URL / tx hash / output).
8. **Scope freeze.** Build P0 (see `docs/01-PRD.md`) end-to-end on CC3 testnet before any P1 work.
   When in doubt, cut.
9. **Reference IDs.** Commits and PR descriptions cite the FR-/INV-/T- IDs they implement.
10. **Ask, don't guess**, on anything listed in `docs/09-DECISIONS-AND-OPEN-QUESTIONS.md` as OPEN.

## Repo layout (create exactly this)

```
proof-feed/
  CLAUDE.md
  .env.example
  docs/                       # the specification bundle
  contracts/                  # Foundry root
    foundry.toml
    src/
      ProvenFeedRegistry.sol
      ProvenFeedAdapter.sol
      PegGuard.sol
      ProbeASC.sol            # Day-1 spike contract only
      interfaces/IProvenFeedRegistry.sol
      libraries/ChainlinkLogLib.sol
    script/Deploy.s.sol
    test/
      mocks/MockNativeQueryVerifier.sol
      fixtures/*.json         # real proofs captured by `pf capture`
      *.t.sol
  cli/
    package.json
    src/index.ts              # `pf` entrypoint
    src/commands/{spike,watch,prove,claim,capture,demo}.ts
    src/lib/{config,attestcoin,chainlink,creditcoin,log}.ts
  web/                        # optional (P2) — one static status page
```

## Commands (must work from a clean clone)

```
cd contracts && forge build && forge test              # all tests green, no skipped tests in CI
cd cli && npm ci && npm run typecheck && npm run lint
npm run pf -- spike                                     # Day-1 gates, prints table
npm run pf -- prove --feed USDC/USD --tx <hash>         # prove one mainnet round into the registry
npm run pf -- watch --feed USDC/USD                     # permissionless keeper loop
npm run pf -- claim --policy <id> --tx <hash>           # proveAndClaim
npm run pf -- capture --tx <hash> --out contracts/test/fixtures/<name>.json
```

## Definition of done (P0)

- `ProvenFeedRegistry`, `ProvenFeedAdapter`, `PegGuard` deployed + source-verified on CC3 testnet.
- At least one **real Ethereum mainnet** Chainlink `AnswerUpdated` transaction proven on-chain
  (Blockscout tx hash in README) with `TransactionVerified` and `RoundProven` events in the receipt.
- One full PegGuard lifecycle on testnet: deposit → buyCover → proven breaching round → claim paid
  (tx hashes in README), using whichever demo branch Day-1 selected (see docs/06).
- Foundry suite: registry, adapter, PegGuard, replay, security rejections; decode of a **real**
  captured mainnet tx fixture.
- README with: Attestcoin surfaces table, limitations section, reproduction commands.
- Demo video ≤ 3 minutes.

## Style

- Solidity: custom errors, NatSpec on every external function, checks-effects-interactions,
  `nonReentrant` on value-moving functions, no `tx.origin`, no unbounded loops over user-controlled arrays
  (log arrays come from a verified receipt and are bounded by block gas — acceptable, but cap at 64).
- TypeScript: strict mode, no `any` in `src/lib`, every RPC call wrapped with timeout + retry.
- Log every gate/decision to `docs/spike-output.json` and `docs/DEPLOYMENT.md` — judges read these.
