/**
 * docs/07 §6 — CLI unit tests. No network access: every case is driven from the fixtures that
 * `pf capture` froze from real Ethereum mainnet transactions.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AbiCoder, Interface } from 'ethers';

import {
  ANSWER_UPDATED_TOPIC,
  composeRoundId,
  decomposeRoundId,
  decodeAnswerUpdated,
  feedIdOf,
  formatAnswer,
  parseAnswer,
} from '../src/lib/chainlink.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Fixture {
  txHash: string;
  phaseId: number | null;
  decimals: number;
  proof: {
    chainKey: number;
    headerNumber: number;
    txBytes: string;
    merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] };
    continuityProof: { lowerEndpointDigest: string; roots: string[] };
  };
  decoded: {
    emitter: string;
    answer: string;
    aggregatorRoundId: string;
    updatedAt: string;
    updatedAtIso: string;
  }[];
}

function fixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(resolve(ROOT, 'contracts', 'test', 'fixtures', `${name}.json`), 'utf8'),
  ) as Fixture;
}

const LIVE = 'usdc_usd_live_25924144';
const DEPEG = 'usdc_usd_depeg_16803472';

test('the AnswerUpdated topic is keccak256 of the exact event signature', () => {
  const iface = new Interface([
    'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  ]);
  assert.equal(iface.getEvent('AnswerUpdated')!.topicHash, ANSWER_UPDATED_TOPIC);
});

test('decodeAnswerUpdated reproduces the values captured from mainnet', () => {
  const f = fixture(LIVE);
  const d = f.decoded[0]!;
  const record = decodeAnswerUpdated({
    topics: [
      ANSWER_UPDATED_TOPIC,
      '0x' + BigInt(d.answer).toString(16).padStart(64, '0'),
      '0x' + BigInt(d.aggregatorRoundId).toString(16).padStart(64, '0'),
    ],
    data: '0x' + BigInt(d.updatedAt).toString(16).padStart(64, '0'),
    address: d.emitter,
    transactionHash: f.txHash,
    blockNumber: f.proof.headerNumber,
    index: 0,
  });
  assert.equal(record.answer, BigInt(d.answer));
  assert.equal(record.aggregatorRoundId, BigInt(d.aggregatorRoundId));
  assert.equal(record.updatedAt, BigInt(d.updatedAt));
  assert.equal(record.emitter, d.emitter);
});

test('decodeAnswerUpdated rejects a log with the wrong shape', () => {
  const base = {
    address: '0x0000000000000000000000000000000000000001',
    transactionHash: '0x' + '11'.repeat(32),
    blockNumber: 1,
    index: 0,
  };
  assert.throws(
    () => decodeAnswerUpdated({ ...base, topics: [ANSWER_UPDATED_TOPIC], data: '0x' + '00'.repeat(32) }),
    /has 1 topics, expected 3/,
  );
  assert.throws(
    () =>
      decodeAnswerUpdated({
        ...base,
        topics: [ANSWER_UPDATED_TOPIC, '0x' + '00'.repeat(32), '0x' + '00'.repeat(32)],
        data: '0x' + '00'.repeat(64),
      }),
    /expected 32/,
  );
});

test('a negative answer decodes as a negative int256, not a huge unsigned number', () => {
  const minusOne = '0x' + 'ff'.repeat(32);
  const r = decodeAnswerUpdated({
    topics: [ANSWER_UPDATED_TOPIC, minusOne, '0x' + '01'.padStart(64, '0')],
    data: '0x' + '00'.repeat(32),
    address: '0x0000000000000000000000000000000000000001',
    transactionHash: '0x' + '11'.repeat(32),
    blockNumber: 1,
    index: 0,
  });
  assert.equal(r.answer, -1n);
});

test('roundId composition matches the value the live USDC/USD proxy reports', () => {
  // Captured Day 1: proxy.latestRoundData().roundId for phase 3 / aggregator round 1178.
  assert.equal(composeRoundId(3, 1178n), 55340232221128656026n);
  // And the phase-2 depeg round.
  assert.equal(composeRoundId(2, 983n), 36893488147419104215n);
});

test('roundId decomposition round-trips', () => {
  for (const [phase, round] of [
    [3, 1178n],
    [2, 983n],
    [7, 24463n],
  ] as const) {
    const id = composeRoundId(phase, round);
    const back = decomposeRoundId(id);
    assert.equal(back.phaseId, phase);
    assert.equal(back.aggregatorRoundId, round);
  }
});

test('composeRoundId refuses an aggregator round that will not fit 64 bits', () => {
  assert.throws(() => composeRoundId(1, 1n << 64n), /2\^64/);
});

test('feedId is keccak256 of the exact description string, spaces included', () => {
  assert.equal(
    feedIdOf('USDC / USD'),
    '0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256',
  );
  // Normalising the string would silently produce a different, unusable feed.
  assert.notEqual(feedIdOf('USDC/USD'), feedIdOf('USDC / USD'));
});

test('answer formatting and parsing round-trip at feed decimals', () => {
  assert.equal(formatAnswer(99988765n, 8), '0.99988765');
  assert.equal(formatAnswer(88000000n, 8), '0.88000000');
  assert.equal(formatAnswer(273621050420n, 8), '2736.21050420');
  assert.equal(parseAnswer('0.97', 8), 97000000n);
  assert.equal(parseAnswer('2736.2105042', 8), 273621050420n);
  assert.equal(parseAnswer(formatAnswer(88000000n, 8), 8), 88000000n);
});

test('the captured fixtures encode exactly the recordRound argument list', () => {
  const iface = new Interface(
    JSON.parse(
      readFileSync(resolve(ROOT, 'cli', 'src', 'abi', 'ProvenFeedRegistry.json'), 'utf8'),
    ).abi,
  );
  const recordRound = iface.getFunction('recordRound')!;
  const types = recordRound.inputs.map((i) => i.format('full'));

  for (const name of [LIVE, DEPEG]) {
    const hex = readFileSync(
      resolve(ROOT, 'contracts', 'test', 'fixtures', `${name}.abi.hex`),
      'utf8',
    ).trim();
    // If this decode throws, the fixture and the contract signature have drifted apart.
    const decoded = AbiCoder.defaultAbiCoder().decode(types, hex);
    const f = fixture(name);
    assert.equal(Number(decoded[0]), f.proof.chainKey, `${name}: chainKey`);
    assert.equal(Number(decoded[1]), f.proof.headerNumber, `${name}: headerNumber`);
    assert.equal(decoded[2], f.proof.txBytes, `${name}: txBytes`);
    assert.equal(decoded[3], f.proof.merkleProof.root, `${name}: merkle root`);
    assert.equal(decoded[4].length, f.proof.merkleProof.siblings.length, `${name}: siblings`);
    assert.equal(decoded[6].length, f.proof.continuityProof.roots.length, `${name}: continuity roots`);
  }
});

test('the depeg fixture really is the 2023-03-11 USDC low', () => {
  const f = fixture(DEPEG);
  const d = f.decoded[0]!;
  assert.equal(d.answer, '88000000', '$0.88');
  assert.equal(d.updatedAtIso, '2023-03-11T07:51:23.000Z');
  assert.equal(d.emitter, '0x789190466E21a8b78b8027866CBBDc151542A26C', 'phase-2 aggregator');
  assert.equal(f.proof.headerNumber, 16803472);
  assert.equal(f.proof.chainKey, 3, 'Ethereum mainnet');
  assert.ok(f.proof.continuityProof.roots.length > 500, 'deep history needs a long continuity proof');
});
