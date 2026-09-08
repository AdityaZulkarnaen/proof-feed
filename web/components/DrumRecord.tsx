/**
 * The smoked-drum record: Chainlink's real USDC/USD series across the SVB weekend.
 *
 * Ballistic honesty, carried over from the direction contract: this plots the 295 rounds Chainlink
 * actually published, at their true time spacing. Where the publishing gap is long the path breaks
 * rather than interpolating, and the single round ProofFeed has proven is marked separately — the
 * page never implies it holds more of the record than it does.
 *
 * The grid re-counts its columns per viewport rather than scaling. SVG type scales with the
 * viewBox, so one wide drum shrunk onto a phone would set its labels at about three pixels; two
 * geometries are rendered instead and CSS picks one.
 */
import series from '../lib/depeg-series.json';
import { DEPEG, formatAnswer } from '../lib/deployment';

interface Round {
  b: number;
  t: number;
  a: string;
  r: string;
  tx: string;
}

interface Geometry {
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
  /** Hours between time ticks. A narrow drum gets fewer columns, never a squeezed grid. */
  tickHours: number;
  label: number;
  reading: number;
  stamp: number;
}

const WIDE: Geometry = {
  w: 1200,
  h: 380,
  pad: { top: 34, right: 28, bottom: 34, left: 28 },
  tickHours: 6,
  label: 11,
  reading: 15,
  stamp: 11,
};

const NARROW: Geometry = {
  w: 420,
  h: 400,
  pad: { top: 28, right: 14, bottom: 24, left: 14 },
  tickHours: 24,
  label: 11,
  reading: 15,
  stamp: 9,
};

/** A publishing gap wider than this breaks the trace instead of being drawn through. */
const GAP_SECONDS = 3 * 3600;

/** Value rules at each cent, so the drop is measured against something. */
const RULES = [100_000_000, 96_000_000, 92_000_000, 88_000_000];

function Drum({ g, animate }: { g: Geometry; animate: boolean }) {
  const rounds = series.rounds as Round[];
  const times = rounds.map((r) => r.t);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const vMin = 87_000_000;
  const vMax = 100_600_000;

  // Rounded at the source: unrounded floats would ship 16 significant digits into the markup.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const x = (t: number) => r2(g.pad.left + ((t - t0) / (t1 - t0)) * (g.w - g.pad.left - g.pad.right));
  const y = (v: number) =>
    r2(g.pad.top + (1 - (v - vMin) / (vMax - vMin)) * (g.h - g.pad.top - g.pad.bottom));

  // Break the path across long publishing gaps: a gap is information, not something to smooth over.
  const segments: string[] = [];
  let current: string[] = [];
  rounds.forEach((r, i) => {
    const prev = rounds[i - 1];
    if (prev && r.t - prev.t > GAP_SECONDS) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${x(r.t)},${y(Number(r.a))}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const lowX = x(DEPEG.updatedAt);
  const lowY = y(Number(DEPEG.answer));
  /** Keep the annotation on the sheet when the mark sits right of centre. */
  const flip = lowX > g.w * 0.62;

  const ticks: { t: number; major: boolean }[] = [];
  const step = g.tickHours * 3600;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    ticks.push({ t, major: new Date(t * 1000).getUTCHours() === 0 });
  }

  const traceLength = Math.round((g.w - g.pad.left - g.pad.right) * 1.9);

  return (
    <svg
      viewBox={`0 0 ${g.w} ${g.h}`}
      width="100%"
      role="img"
      aria-label="Chainlink USDC/USD across 10 to 12 March 2023. The price holds near one dollar, then falls to 0.88000000 US dollars on 11 March."
      style={{ display: 'block' }}
    >
      {RULES.map((v) => (
        <g key={v}>
          <line className="gridline" x1={g.pad.left} x2={g.w - g.pad.right} y1={y(v)} y2={y(v)} />
          <text
            x={g.pad.left + 4}
            y={y(v) - 6}
            fill="var(--scratch-faint)"
            fontSize={g.label}
            fontFamily="var(--font-label), sans-serif"
            letterSpacing="0.08em"
          >
            {formatAnswer(BigInt(v), 8)}
          </text>
        </g>
      ))}

      {ticks.map(({ t, major }) => (
        <g key={t}>
          <line
            className={major ? 'gridline gridlineStrong' : 'gridline'}
            x1={x(t)}
            x2={x(t)}
            y1={g.pad.top - (major ? 10 : 4)}
            y2={g.h - g.pad.bottom}
          />
          {major && (
            <text
              x={x(t) + 5}
              y={g.pad.top - 13}
              fill="var(--scratch-faint)"
              fontSize={g.stamp}
              fontFamily="var(--font-label), sans-serif"
              letterSpacing="0.08em"
            >
              {new Date(t * 1000).toISOString().slice(0, 10)}
            </text>
          )}
        </g>
      ))}

      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          className={i === 0 && animate ? 'trace traceAnimated' : 'trace'}
          style={
            i === 0 && animate
              ? ({ ['--trace-length' as string]: `${traceLength}` } as React.CSSProperties)
              : undefined
          }
        />
      ))}

      {/* The operator's mark at the low. */}
      <line
        className="annotation"
        x1={lowX}
        x2={lowX}
        y1={lowY}
        y2={g.h - g.pad.bottom}
        strokeDasharray="3 4"
      />
      <circle cx={lowX} cy={lowY} r="4.5" fill="var(--soot-raised)" stroke="var(--amber)" strokeWidth="1.75" />
      <text
        x={flip ? lowX - 12 : lowX + 12}
        y={lowY - 10}
        textAnchor={flip ? 'end' : 'start'}
        fill="var(--amber)"
        fontSize={g.reading}
        fontWeight="600"
        fontFamily="var(--font-label), sans-serif"
        letterSpacing="-0.02em"
      >
        0.88000000
      </text>
      <text
        x={flip ? lowX - 12 : lowX + 12}
        y={lowY + 8}
        textAnchor={flip ? 'end' : 'start'}
        fill="var(--amber-dim)"
        fontSize={g.stamp}
        fontFamily="var(--font-label), sans-serif"
        letterSpacing="0.08em"
      >
        11 MAR 2023 07:51:23 UTC
      </text>
    </svg>
  );
}

export function DrumRecord() {
  return (
    <figure className="drum" aria-labelledby="drum-caption" style={{ margin: 0 }}>
      <div className="onlyWide">
        <Drum g={WIDE} animate />
      </div>
      <div className="onlyNarrow">
        <Drum g={NARROW} animate={false} />
      </div>

      <figcaption id="drum-caption" className="drumCaption">
        <span className="stationLabel">Chainlink USDC/USD · phase-2 aggregator · Ethereum mainnet</span>
        <span className="stationLabel">{series.count} rounds published</span>
        <span className="stationLabel" style={{ color: 'var(--amber)' }}>
          1 proven onto Creditcoin
        </span>
      </figcaption>
    </figure>
  );
}
