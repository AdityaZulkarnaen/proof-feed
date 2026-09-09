# Design — Station Record

<!-- Written at finish, from the built world. The durable visual decisions for `web/`. -->

The world is a **smoked seismograph drum**: soot-blackened paper that a stylus scratches a
bone-white line through. It was chosen because the instrument carries the product's central claim
without needing a sentence — you cannot draw on the paper yourself, the pen is driven by the ground,
and there is no `setPrice`.

Direction contract and its provenance live in
[`.impeccable/surfaces/app-page-tsx.md`](.impeccable/surfaces/app-page-tsx.md).

## Ground and ink

| Token | Value | Role |
|---|---|---|
| `--soot` | `#14110e` | The ground. Warm brown-black, never neutral. Owns the whole surface. |
| `--soot-raised` | `#1b1712` | The drum sheet, one step off the ground. The only elevation change on the page. |
| `--grid` | `#2b251e` | Rules and hairlines. |
| `--grid-strong` | `#3b332a` | Midnight ticks on the time base. |
| `--scratch` | `#f2ede1` | Bone white. The stylus, and all primary text. |
| `--scratch-dim` | `#9a9082` | Secondary text. Tinted from the ground's hue, not grey. 5.07:1 on soot. |
| `--scratch-faint` | `#6b6357` | Instrument markings only, never body copy. |
| `--amber` | `#d9a441` | The annotation. Reserved for the breach, the live indicator, links on hover, and focus. |
| `--amber-dim` | `#8a6a2c` | The annotation's timestamp. |

Colour strategy is **Committed**: the soot owns well over 60% of the surface as a field, not as a
backdrop for scattered accents. Amber is rationed — if it appears, something was measured or
breached.

Dark was chosen from the physical scene, not from category habit: a smoked drum record *is* dark,
and the page is read at a desk during a review session.

### What this world refuses

Both named AI-interface clusters were live risks here and both were rejected at execution:

- **Cream chart paper with a terracotta pencil** is the obvious rendition of a chart recorder, and
  is the first cluster exactly (warm cream ground, signal-red accent). Smoked drum is the earlier
  and materially stronger reading.
- **Near-black with a neon accent and glowing edges** is the second. The distinction is real and
  must be preserved: the ink is a *matte scratch*, there is no bloom, no shadow, no glass, and amber
  is a varnish colour rather than a light source. Nothing on this page glows.

## Type

Faces are instrument parts, not genre signals. No face from the training-default list is used.

| Variable | Face | Used for |
|---|---|---|
| `--font-label` | Archivo Narrow | Headings, station labels, all readings. The condensed engineering grotesque a station label is stamped in. |
| `--font-body` | Archivo | Running text. |
| `--font-mono` | JetBrains Mono | Hashes and addresses **only**. |

Mono is confined to hex because distinguishing `0`/`O` and `1`/`l` against a block explorer is a real
task a visitor performs. It is never used as a costume for "technical": the large readings are set in
Archivo Narrow with `tabular-nums`, not in mono.

`font-variant-numeric: tabular-nums` is set on `body`, so every figure on the page aligns in its
column without per-element opt-in.

## Structure

**Rows, never cards.** The page's structural unit is `.row` — a ruled annotation line with a station
label in the left column and its value in the right, exactly as an operator annotates a chart. There
is no card anywhere on the page, and therefore no nested card. Sections are separated by 1px rules,
never by boxes.

Elevation is declared once: the drum sits on `--soot-raised` with a border above and below. Nothing
else on the page has a background, a shadow, or a radius.

- `.shell` — 78rem max, fluid gutters
- `.rows` / `.row` — the ruled record; single column below 46rem, `13rem 1fr` above
- `.prose` — capped at `--measure` (68ch)
- `.stationLabel` — 0.6875rem, uppercase, 0.14em tracking
- `.reading` — tabular figures, -0.03em tracking

## The drum

`components/DrumRecord.tsx` plots the 295 real Chainlink USDC/USD rounds of 10–12 March 2023.

Two rules govern it, and both are load-bearing rather than decorative:

1. **Gaps are gaps.** Where the publishing interval exceeds three hours the path breaks instead of
   interpolating. Drawing a smooth continuous line would assert continuity this feed does not have.
2. **The grid re-counts, it never stretches.** SVG type scales with its viewBox, so one wide drum
   shrunk to a phone would set its labels at roughly three pixels. Two geometries are rendered —
   1200×380 at six-hour ticks, 420×400 at daily ticks — and CSS shows one.

The caption states what the trace is and what has been proven from it: 295 published, 1 proven. The
feed's lower-bound nature is therefore visible in the hero rather than only confessed in prose.

## The mark

`components/Logo.tsx`. A stylus scratch that holds, drops, and holds lower — the product's own event
reduced to geometry. The two flats are bone-white `--scratch`; the drop is `--amber`, because this
world reserves amber for a breach and the drop *is* the breach. Square caps, one stroke weight
(2.6 on a 20-unit box), no fill, no radius, no container: the same instrument language as the drum's
linework.

It is a logotype, not a chart. The page's real data is drawn by `DrumRecord` from 295 actual rounds;
the mark is the shape of that record at the size of a favicon, and it never stands in for a reading.

Shipped as three files, all the same geometry:

| File | Purpose |
|---|---|
| `components/Logo.tsx` | the mark in the page, drawn from the CSS variables so it follows the palette |
| `app/icon.svg` | the favicon — literal hex, on a full-bleed soot square so it survives a light tab bar |
| `app/apple-icon.tsx` | 180×180 PNG via `next/og`, because iOS will not render an SVG icon |

The favicon keeps its soot ground rather than going transparent: a bone-white line alone would
disappear against a light browser chrome, and the smoked sheet is the brand's material anyway.

## The header plate

`components/Nav.tsx`. A sticky ruled bar: the mark and wordmark on the left, section markings and
the source link on the right, one hairline underneath. It is **opaque soot with no blur, no shadow
and no radius** — a floating translucent pill is the category default, and this world already
declared its single elevation on the drum.

Section labels use the `.stationLabel` voice (0.6875rem, uppercase, 0.14em tracking) because they
are instrument markings, not navigation chrome. Below 46rem they step aside and the bar keeps what
a visitor needs on a phone: who this is, and the way to go verify it.

`--scratch-faint` was rejected for "Creditcoin CC3": it is 3.21:1 on soot, which is fine for a tick
label the eye skips and wrong for a word the visitor reads. It is `--scratch-dim` (5.07:1).

## Motion

One authored moment: the trace lays itself down once, `stroke-dashoffset` over 2600ms on
`cubic-bezier(0.16, 1, 0.3, 1)` — an exponential ease-out, the way a drum recorder draws. It runs on
the wide drum only, and is disabled entirely under `prefers-reduced-motion`, where the finished
record renders immediately. There is no second animation anywhere.

## Browser surfaces

Themed from the palette rather than left to the browser: text selection (amber on soot), the focus
ring (2px amber, 3px offset), scrollbars (`scrollbar-color` plus the WebKit pseudo-elements), link
underline offset and thickness, and tabular numerals.

## Rules this world keeps

- No card is the page's structural unit; nested cards do not exist here.
- No gradient text, no glass, no blur, no glow, no coloured left borders, no offset shadows.
- No kicker or eyebrow above any heading.
- Icons: authored SVG only, in the instrument's own stroke language — the mark, and the external-link
  arrow in the nav. Never a unicode glyph or emoji standing in for one.
- The header plate stays opaque. Sticky is allowed; glass is not.
- Every figure on the page is real and carries its provenance beside it — chain key, block height,
  transaction index, gas. Nothing is illustrative.
