/**
 * One-shot: capture the real Chainlink USDC/USD series for the SVB depeg day.
 *
 * This is immutable history, so it is fetched once and committed as data rather than read at
 * request time. The page draws this series as what Chainlink *published*, and marks separately the
 * rounds ProofFeed has actually *proven* onto Creditcoin - which is the honest picture, and makes
 * the feed's lower-bound nature visible instead of hiding it.
 *
 *   node scripts/fetch-depeg-series.mjs
 */
import { JsonRpcProvider } from 'ethers';
import { writeFileSync } from 'node:fs';

const RPC = process.env.ETH_MAINNET_RPC_URL ?? 'https://gateway.tenderly.co/public/mainnet';
const ANSWER_UPDATED = '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f';
/** USDC/USD phase-2 aggregator - the one live on 2023-03-11. Read from proxy.phaseAggregators(2). */
const PHASE2 = '0x789190466E21a8b78b8027866CBBDc151542A26C';
const FROM = 16_795_000;
const TO = 16_812_000;

const eth = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });

const rows = [];
for (let start = FROM; start <= TO; start += 5000) {
  const end = Math.min(TO, start + 4999);
  const logs = await eth.getLogs({ address: PHASE2, topics: [ANSWER_UPDATED], fromBlock: start, toBlock: end });
  for (const l of logs) {
    rows.push({
      b: l.blockNumber,
      t: Number(BigInt(l.data)),
      a: BigInt.asIntN(256, BigInt(l.topics[1])).toString(),
      r: BigInt(l.topics[2]).toString(),
      tx: l.transactionHash,
    });
  }
  process.stderr.write(`  ${start}-${end}: ${rows.length} total\n`);
}

rows.sort((x, y) => x.t - y.t);

const answers = rows.map((r) => Number(r.a));
const min = Math.min(...answers);
const low = rows.find((r) => Number(r.a) === min);

const out = {
  note: 'Real Chainlink USDC/USD AnswerUpdated logs, Ethereum mainnet, phase-2 aggregator, around 2023-03-11. Immutable history, captured once.',
  capturedAt: new Date().toISOString(),
  source: { aggregator: PHASE2, phaseId: 2, decimals: 8, fromBlock: FROM, toBlock: TO },
  count: rows.length,
  low: { answer: low.a, updatedAt: low.t, block: low.b, tx: low.tx, aggregatorRoundId: low.r },
  rounds: rows,
};

writeFileSync('lib/depeg-series.json', JSON.stringify(out, null, 0) + '\n');
console.log(`wrote lib/depeg-series.json - ${rows.length} rounds, low $${(min / 1e8).toFixed(8)} at ${new Date(low.t * 1000).toISOString()}`);
