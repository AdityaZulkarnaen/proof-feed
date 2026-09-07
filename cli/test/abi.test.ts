/**
 * T-S04 / INV-11, asserted structurally over the COMPILED ABI: there is no way to hand the registry
 * a price. If someone ever adds a `setPrice`-shaped function, this test fails before the demo does.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface AbiParam {
  name: string;
  type: string;
  components?: AbiParam[];
}
interface AbiEntry {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
}

function loadAbi(name: string): AbiEntry[] {
  const p = resolve(ROOT, 'cli', 'src', 'abi', `${name}.json`);
  return (JSON.parse(readFileSync(p, 'utf8')) as { abi: AbiEntry[] }).abi;
}

/** Flatten tuple components so a price hidden inside a struct is still caught. */
function flatten(params: readonly AbiParam[] | undefined): AbiParam[] {
  const out: AbiParam[] = [];
  for (const p of params ?? []) {
    out.push(p);
    if (p.components) out.push(...flatten(p.components));
  }
  return out;
}

const isStateChanging = (e: AbiEntry): boolean =>
  e.type === 'function' && e.stateMutability !== 'view' && e.stateMutability !== 'pure';

test('T-S04: no state-changing registry function accepts a price', () => {
  const abi = loadAbi('ProvenFeedRegistry');
  const offenders: string[] = [];

  for (const e of abi.filter(isStateChanging)) {
    for (const input of flatten(e.inputs)) {
      // int256/int192 are how a Chainlink answer would have to arrive.
      if (/^int\d*$/.test(input.type)) offenders.push(`${e.name}(${input.name}: ${input.type})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a price can only enter through proof bytes, but these accept a signed integer: ${offenders.join(', ')}`,
  );
});

test('T-S04: the registry has no setter-shaped function for round data', () => {
  const abi = loadAbi('ProvenFeedRegistry');
  const forbidden = /^(setprice|setround|setanswer|pushprice|updateprice|writeround|submitprice)$/i;
  const names = abi.filter(isStateChanging).map((e) => e.name ?? '');
  const offenders = names.filter((n) => forbidden.test(n));
  assert.deepEqual(offenders, [], `forbidden setters present: ${offenders.join(', ')}`);
});

test('T-S04: the only state-changing entrypoints are registration, recordRound and ownership', () => {
  const abi = loadAbi('ProvenFeedRegistry');
  const names = abi
    .filter(isStateChanging)
    .map((e) => e.name ?? '')
    .sort();

  assert.deepEqual(names, [
    'acceptOwnership',
    'execute',
    'recordRound',
    'registerFeed',
    'renounceOwnership',
    'setFeedActive',
    'transferOwnership',
  ]);
});

test('recordRound takes the same proof arguments as ASCBase.execute, minus `action`', () => {
  const abi = loadAbi('ProvenFeedRegistry');
  const record = abi.find((e) => e.name === 'recordRound');
  const execute = abi.find((e) => e.name === 'execute');
  assert.ok(record && execute, 'both entrypoints exist');

  const recordTypes = (record.inputs ?? []).map((i) => i.type);
  const executeTypes = (execute.inputs ?? []).map((i) => i.type);

  assert.equal(executeTypes[0], 'uint8', 'execute leads with the action discriminator');
  assert.deepEqual(
    recordTypes,
    executeTypes.slice(1),
    'recordRound must carry exactly the proof arguments, so no proof field is silently dropped',
  );
});

test('PegGuard never accepts a price except as a strike chosen by the buyer', () => {
  const abi = loadAbi('PegGuard');
  const offenders: string[] = [];
  for (const e of abi.filter(isStateChanging)) {
    for (const input of flatten(e.inputs)) {
      if (/^int\d*$/.test(input.type) && !(e.name === 'buyCover' && input.name === 'strike')) {
        offenders.push(`${e.name}(${input.name}: ${input.type})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `unexpected signed-integer inputs: ${offenders.join(', ')}`);
});

test('the adapter is read-only: it has no state-changing functions at all', () => {
  const abi = loadAbi('ProvenFeedAdapter');
  const names = abi.filter(isStateChanging).map((e) => e.name ?? '');
  assert.deepEqual(names, [], `adapter should be a pure view surface, found: ${names.join(', ')}`);
});

test('the adapter exposes the Chainlink AggregatorV3Interface shape', () => {
  const abi = loadAbi('ProvenFeedAdapter');
  const sig = (name: string): string => {
    const e = abi.find((x) => x.name === name);
    assert.ok(e, `${name} missing`);
    return `${name}(${(e.inputs ?? []).map((i) => i.type).join(',')})->(${(e.outputs ?? []).map((o) => o.type).join(',')})`;
  };
  assert.equal(sig('decimals'), 'decimals()->(uint8)');
  assert.equal(sig('description'), 'description()->(string)');
  assert.equal(sig('version'), 'version()->(uint256)');
  assert.equal(
    sig('latestRoundData'),
    'latestRoundData()->(uint80,int256,uint256,uint256,uint80)',
  );
  assert.equal(
    sig('getRoundData'),
    'getRoundData(uint80)->(uint80,int256,uint256,uint256,uint80)',
  );
});
