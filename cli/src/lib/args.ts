/**
 * Tiny argument reader. docs/04 allows commander or a hand-rolled parser and no other deps —
 * this is the hand-rolled one, kept deliberately dumb.
 */

/** Value of `--name <value>` or `--name=<value>`; undefined when absent. */
export function flag(argv: readonly string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

/** Whether a boolean switch is present. */
export function has(argv: readonly string[], name: string): boolean {
  return argv.includes(name) || argv.some((a) => a.startsWith(`${name}=`));
}

/** `--name <n>` parsed as a number, or `fallback`. Throws on a non-numeric value. */
export function numberFlag(argv: readonly string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} expects a number, got "${raw}"`);
  return n;
}

/** Every value of a repeatable `--name <value>` / `--name=<value>` flag, in order. */
export function flags(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith(`${name}=`)) {
      out.push(a.slice(name.length + 1));
      continue;
    }
    if (a === name) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.push(next);
        i++;
      }
    }
  }
  return out;
}
