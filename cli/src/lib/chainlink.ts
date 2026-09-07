/**
 * Chainlink reads on the SOURCE chain (Ethereum mainnet). Aggregator addresses are ALWAYS read
 * from the proxy at runtime — never typed by hand (CLAUDE.md rule 3, docs/09 §C).
 */
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes, type Log } from 'ethers';
import { log } from './log.js';
import { errMessage, retry } from './retry.js';

/** keccak256("AnswerUpdated(int256,uint256,uint256)") — docs/05 §4. */
export const ANSWER_UPDATED_TOPIC =
  '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f';

/** keccak256("NewTransmission(uint32,int192,address,uint32,bytes,bytes,bytes32,uint40)") — probe only (docs/09 Q2). */
export const NEW_TRANSMISSION_TOPIC =
  '0xab70da5573104158dc13ef16d8871863903098c07de08b26b6318bb68cbf4a03';

const PROXY_ABI = [
  'function aggregator() view returns (address)',
  'function phaseId() view returns (uint16)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function phaseAggregators(uint16) view returns (address)',
];

export interface ResolvedFeed {
  proxy: string;
  aggregator: string;
  phaseId: number;
  decimals: number;
  description: string;
  /** keccak256(bytes(description)) — the canonical feedId (docs/05 §6). */
  feedId: string;
}

export interface AnswerUpdatedRecord {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  emitter: string;
  answer: bigint;
  aggregatorRoundId: bigint;
  updatedAt: bigint;
}

/** Read every field of a Chainlink AggregatorProxy needed to register a feed. */
export async function resolveFeed(eth: JsonRpcProvider, proxy: string): Promise<ResolvedFeed> {
  const c = new Contract(proxy, PROXY_ABI, eth);
  const [aggregator, phaseId, decimals, description] = await retry('chainlink proxy reads', async () => {
    return Promise.all([
      c.aggregator!() as Promise<string>,
      c.phaseId!() as Promise<bigint>,
      c.decimals!() as Promise<bigint>,
      c.description!() as Promise<string>,
    ]);
  });
  const resolved: ResolvedFeed = {
    proxy,
    aggregator,
    phaseId: Number(phaseId),
    decimals: Number(decimals),
    description,
    feedId: keccak256(toUtf8Bytes(description)),
  };
  log.surface(
    'chainlink AggregatorProxy.{aggregator,phaseId,decimals,description}',
    `${proxy} -> "${resolved.description}" phase ${resolved.phaseId}, aggregator ${resolved.aggregator}, ${resolved.decimals} decimals`,
  );
  return resolved;
}

/** `proxy.phaseAggregators(phase)` — used to reach historical aggregators (Branch H). */
export async function phaseAggregator(eth: JsonRpcProvider, proxy: string, phase: number): Promise<string> {
  const c = new Contract(proxy, PROXY_ABI, eth);
  return retry('chainlink phaseAggregators', () => c.phaseAggregators!(phase) as Promise<string>);
}

/** `proxy.latestRoundData()` on the source chain — reference value only, never a ProofFeed input. */
export async function proxyLatestRoundData(
  eth: JsonRpcProvider,
  proxy: string,
): Promise<{ roundId: bigint; answer: bigint; updatedAt: bigint }> {
  const c = new Contract(proxy, PROXY_ABI, eth);
  const r = (await retry('chainlink latestRoundData', () => c.latestRoundData!())) as unknown as {
    roundId: bigint;
    answer: bigint;
    updatedAt: bigint;
  };
  return { roundId: r.roundId, answer: r.answer, updatedAt: r.updatedAt };
}

/** Decode one raw `AnswerUpdated` log. topics[1]=int256 current, topics[2]=uint256 roundId, data=uint256 updatedAt. */
export function decodeAnswerUpdated(l: Pick<Log, 'topics' | 'data' | 'address' | 'transactionHash' | 'blockNumber' | 'index'>): AnswerUpdatedRecord {
  if (l.topics.length !== 3) throw new Error(`AnswerUpdated log has ${l.topics.length} topics, expected 3`);
  if (l.data.length !== 66) throw new Error(`AnswerUpdated data is ${(l.data.length - 2) / 2} bytes, expected 32`);
  return {
    txHash: l.transactionHash,
    blockNumber: l.blockNumber,
    logIndex: l.index,
    emitter: l.address,
    answer: BigInt.asIntN(256, BigInt(l.topics[1]!)),
    aggregatorRoundId: BigInt(l.topics[2]!),
    updatedAt: BigInt(l.data),
  };
}

/** Chainlink proxy convention: `(phaseId << 64) | aggregatorRoundId` as uint80 (D-04). */
export function composeRoundId(phaseId: number, aggregatorRoundId: bigint): bigint {
  if (aggregatorRoundId >= 1n << 64n) throw new Error(`aggregatorRoundId ${aggregatorRoundId} >= 2^64`);
  return (BigInt(phaseId) << 64n) | aggregatorRoundId;
}

export function decomposeRoundId(roundId: bigint): { phaseId: number; aggregatorRoundId: bigint } {
  return { phaseId: Number(roundId >> 64n), aggregatorRoundId: roundId & ((1n << 64n) - 1n) };
}

/** Format a feed answer for humans, e.g. 99993000 @ 8 decimals -> "0.99993000". */
export function formatAnswer(answer: bigint, decimals: number): string {
  const neg = answer < 0n;
  const abs = neg ? -answer : answer;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Parse a decimal price string into feed units, e.g. "0.97" @ 8 -> 97000000n. */
export function parseAnswer(price: string, decimals: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(price.trim());
  if (!m) throw new Error(`Not a decimal price: "${price}"`);
  const frac = (m[3] ?? '').padEnd(decimals, '0').slice(0, decimals);
  const v = BigInt(m[2]! + (decimals > 0 ? frac : ''));
  return m[1] === '-' ? -v : v;
}

export interface ScanOptions {
  /** Upper bound on a single eth_getLogs range. Halved automatically on RPC rejection (docs/09 Q7). */
  maxChunk?: number;
  /** Stop as soon as this many logs have been collected (scanning newest-first). */
  limit?: number;
}

/**
 * Scan `[fromBlock, toBlock]` for `AnswerUpdated` logs of one aggregator, newest range first.
 * Public RPCs cap `eth_getLogs` ranges; on rejection the chunk size is halved down to 50 blocks
 * (the official example's constant) before giving up.
 */
export async function findAnswerUpdatedLogs(
  eth: JsonRpcProvider,
  aggregator: string,
  fromBlock: number,
  toBlock: number,
  opts: ScanOptions = {},
): Promise<AnswerUpdatedRecord[]> {
  let chunk = Math.max(50, opts.maxChunk ?? 20_000);
  const out: AnswerUpdatedRecord[] = [];
  let end = toBlock;
  let requests = 0;

  while (end >= fromBlock) {
    const start = Math.max(fromBlock, end - chunk + 1);
    try {
      const logs = await retry(
        `eth_getLogs ${start}-${end}`,
        () =>
          eth.getLogs({
            address: aggregator,
            topics: [ANSWER_UPDATED_TOPIC],
            fromBlock: start,
            toBlock: end,
          }),
        { attempts: 2, timeoutMs: 30_000 },
      );
      requests++;
      for (const l of logs) out.push(decodeAnswerUpdated(l));
      if (opts.limit && out.length >= opts.limit) break;
      end = start - 1;
    } catch (err) {
      if (chunk <= 50) throw new Error(`eth_getLogs failed even at 50-block range: ${errMessage(err)}`);
      chunk = Math.max(50, Math.floor(chunk / 4));
      log.warn(`eth_getLogs range rejected, reducing chunk to ${chunk} blocks`);
    }
  }

  out.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  log.surface(
    'eth_getLogs(aggregator, AnswerUpdated)',
    `${out.length} logs over blocks ${fromBlock.toLocaleString()}-${toBlock.toLocaleString()} in ${requests} request(s), chunk ${chunk}`,
  );
  return out;
}

/** Q2 fallback probe: does the aggregator emit `NewTransmission` instead? Diagnostics only. */
export async function countNewTransmission(
  eth: JsonRpcProvider,
  aggregator: string,
  fromBlock: number,
  toBlock: number,
): Promise<number> {
  const logs = await retry('eth_getLogs NewTransmission', () =>
    eth.getLogs({ address: aggregator, topics: [NEW_TRANSMISSION_TOPIC], fromBlock, toBlock }),
  );
  return logs.length;
}

export function feedIdOf(description: string): string {
  return keccak256(toUtf8Bytes(description));
}

/** Binary-search the first block whose timestamp is >= `unixSeconds` (docs/09 Q3 procedure). */
export async function blockAtTimestamp(
  eth: JsonRpcProvider,
  unixSeconds: number,
  lo: number,
  hi: number,
): Promise<number> {
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = (low + high) >> 1;
    const b = await retry(`eth_getBlockByNumber ${mid}`, () => eth.getBlock(mid));
    if (!b) throw new Error(`block ${mid} not found on the source RPC`);
    if (b.timestamp < unixSeconds) low = mid + 1;
    else high = mid;
  }
  log.surface('eth_getBlockByNumber (binary search)', `timestamp ${unixSeconds} -> block ${low.toLocaleString()}`);
  return low;
}

export interface PhaseRound extends AnswerUpdatedRecord {
  phaseId: number;
  /** (phaseId << 64) | aggregatorRoundId */
  roundId: bigint;
}

/**
 * Find the LOWEST `AnswerUpdated` print of a feed inside a block window, across every phase
 * aggregator the proxy has ever used. Aggregators are enumerated via `phaseAggregators()` at
 * runtime — never hardcoded (CLAUDE.md rule 3). Used to locate the 2023 USDC depeg round (Branch H).
 */
export async function findMinAnswerRound(
  eth: JsonRpcProvider,
  proxy: string,
  fromBlock: number,
  toBlock: number,
  opts: ScanOptions = {},
): Promise<{ min: PhaseRound | null; scanned: { phaseId: number; aggregator: string; logs: number }[] }> {
  const c = new Contract(proxy, PROXY_ABI, eth);
  const currentPhase = Number(await retry('chainlink phaseId', () => c.phaseId!() as Promise<bigint>));
  const scanned: { phaseId: number; aggregator: string; logs: number }[] = [];
  let min: PhaseRound | null = null;

  for (let phase = 1; phase <= currentPhase; phase++) {
    const aggregator = await phaseAggregator(eth, proxy, phase);
    if (/^0x0{40}$/i.test(aggregator)) continue;
    const found = await findAnswerUpdatedLogs(eth, aggregator, fromBlock, toBlock, opts);
    scanned.push({ phaseId: phase, aggregator, logs: found.length });
    for (const l of found) {
      if (min === null || l.answer < min.answer) {
        min = { ...l, phaseId: phase, roundId: composeRoundId(phase, l.aggregatorRoundId) };
      }
    }
  }
  return { min, scanned };
}
