---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: []
---

Scope: the single landing route `app/page.tsx`. Visitor mode: Persuade.

Audience: hackathon judges first (skeptical, five minutes, will cross-check Blockscout against
Etherscan), Creditcoin developers second (want the adapter shape and the trust boundary).
Job: decide whether this project is real, then find the integration surface.
Action: open a Blockscout transaction and compare it to the mainnet original.
Proof on hand: the 2023-03-11 USDC depeg round at $0.88000000 proven on Creditcoin, a settled
PegGuard claim, three verified contracts, live registry state read from CC3 RPC.
Constraints: read-only, no wallet; testnet only; live-vs-cached must be labelled (FR-23); Chainlink
`updatedAt` and Creditcoin `provenAt` are two clocks and must never merge; user ban on nested cards,
gradient glow and card border glow.

## Direction contract

THESIS: A price feed is an instrument. The pen is driven by the ground, never by the operator —
there is no `setPrice`. Refuses the centred hero, three feature cards and glow.

OWN-WORLD: Smoked-drum record. Soot ground, bone-white stylus scratch as the working ink, dim
scratch grid, one sulphur-amber reserved for the breach annotation. Condensed engineering labels,
hairline ticks, tabular figures. No cards, no fills, no bloom.

STORY: The visitor sees a real 2023 price sitting on another chain, believes it because every
figure carries its own transaction, and clicks through to verify.

FIRST VIEWPORT: Full-bleed drum. Time base ruled left to right; the USDC trace flat at 1.00000000
then scratched down to 0.88000000 right of centre, annotated in amber. Station block lower left:
chain key, block height, both hashes. Primary action sits on the annotation.

FORM: Station Record, candidate 7 of 7 on the grounded list, seed 2e6b33da.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance

## Calibration note

The obvious rendition of this world — cream chart paper with a terracotta annotation pencil — is
the first named AI cluster (warm cream ground, signal-red accent) and was rejected at execution.
Smoked drum is the historically earlier and materially stronger reading: soot-blackened paper the
stylus scratches white. It is also not the second cluster: the ink is a matte bone-white scratch,
never a neon accent, and nothing glows.

Banned faces from the training-data default list are not used. Labels are Archivo Narrow; hashes
use JetBrains Mono, justified because hex disambiguation against a block explorer is a real user
task, not a genre reflex. Large readings are set in the label face with tabular figures, not mono.

## Unresolved

None blocking. Demo video URL is still absent and must render as an honest empty state, never a
dead link.
