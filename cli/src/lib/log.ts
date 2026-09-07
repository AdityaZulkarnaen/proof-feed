/**
 * Structured logger. Every Attestcoin/Chainlink surface we exercise is printed with `surface()`
 * so the README "Attestcoin surfaces" table can be built from real command output (NFR-06).
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const threshold: number = LEVELS[(envLevel in LEVELS ? envLevel : 'info') as Level];

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

/** Every surface string printed during this process, in call order (deduped, order-preserving). */
const exercised: string[] = [];

function emit(level: Level, prefix: string, msg: string): void {
  if (LEVELS[level] < threshold) return;
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
  stream.write(`${prefix} ${msg}\n`);
}

export const log = {
  debug: (msg: string): void => emit('debug', `${C.dim}[debug]${C.reset}`, msg),
  info: (msg: string): void => emit('info', `${C.blue}[info] ${C.reset}`, msg),
  warn: (msg: string): void => emit('warn', `${C.yellow}[warn] ${C.reset}`, msg),
  error: (msg: string): void => emit('error', `${C.red}[error]${C.reset}`, msg),
  ok: (msg: string): void => emit('info', `${C.green}[ok]   ${C.reset}`, msg),
  step: (msg: string): void => emit('info', `\n${C.bold}${C.cyan}▸`, `${msg}${C.reset}`),

  /**
   * Record and print an SDK / precompile / contract surface that just did real work.
   * @param name dotted surface name, e.g. `chainInfo.getLatestAttestedHeightAndHash`
   * @param detail short human summary of the call and its result
   */
  surface(name: string, detail: string): void {
    if (!exercised.includes(name)) exercised.push(name);
    emit('info', `${C.magenta}[surface]${C.reset}`, `${C.bold}${name}${C.reset} ${C.dim}→${C.reset} ${detail}`);
  },

  /** The list captured so far, for the trailing SURFACES EXERCISED block (docs/04 §7). */
  surfaces: (): readonly string[] => exercised,

  /** Print the trailing block every command ends with. */
  printSurfaces(): void {
    if (exercised.length === 0) return;
    process.stdout.write(`\n${C.bold}SURFACES EXERCISED:${C.reset}\n`);
    for (const s of exercised) process.stdout.write(`  • ${s}\n`);
  },
};

/** Right-aligned fixed-width table renderer used by `pf spike`. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').replace(/\x1b\[[0-9;]*m/g, '').length)),
  );
  const line = (cells: readonly string[]): string =>
    '| ' +
    cells
      .map((c, i) => {
        const visible = (c ?? '').replace(/\x1b\[[0-9;]*m/g, '').length;
        return (c ?? '') + ' '.repeat(Math.max(0, (widths[i] ?? 0) - visible));
      })
      .join(' | ') +
    ' |';
  const sep = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|';
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

export const colors = C;
