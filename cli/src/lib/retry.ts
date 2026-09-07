/**
 * Timeout + retry wrapper required by CLAUDE.md ("every RPC call wrapped with timeout + retry")
 * and docs/04 §6: 15 s timeout, 5 attempts, exponential backoff 1/2/4/8/16 s.
 */
import { log } from './log.js';

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  /** Return false to abort immediately (non-retriable, docs/04 §6). */
  retriable?: (err: unknown) => boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retry<T>(label: string, fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const baseDelayMs = opts.baseDelayMs ?? 1_000;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(label, timeoutMs, fn);
    } catch (err) {
      lastErr = err;
      if (opts.retriable && !opts.retriable(err)) throw err;
      if (i === attempts - 1) break;
      const delay = baseDelayMs * 2 ** i;
      log.warn(`${label} failed (attempt ${i + 1}/${attempts}): ${errMessage(err)} — retrying in ${delay} ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const short = (err as { shortMessage?: string }).shortMessage;
    return short ?? err.message;
  }
  return String(err);
}

export { sleep };
