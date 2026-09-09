/**
 * The CLI must be useful straight from a clone (CLAUDE.md "Commands (must work from a clean
 * clone)"). These tests pin the two things that make that true: the live deployment addresses are
 * baked in as defaults, and they agree with what docs/DEPLOYMENT.md and the README publish.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isAddress } from 'ethers';

import { DEPLOYED } from '../src/lib/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

test('every baked-in deployment address is a valid checksummed address', () => {
  for (const [name, address] of Object.entries(DEPLOYED)) {
    assert.ok(isAddress(address), `${name} is not a valid address: ${address}`);
  }
});

test('the baked-in addresses match docs/DEPLOYMENT.md', () => {
  const doc = read('docs/DEPLOYMENT.md');
  for (const [name, address] of Object.entries(DEPLOYED)) {
    assert.ok(
      doc.includes(address),
      `${name} (${address}) is not in docs/DEPLOYMENT.md — the CLI default and the deployment log have drifted apart`,
    );
  }
});

test('the README publishes the same registry, adapter and PegGuard', () => {
  const readme = read('README.md');
  for (const name of ['registry', 'adapter', 'pegGuard'] as const) {
    assert.ok(
      readme.includes(DEPLOYED[name]),
      `README does not mention the ${name} address ${DEPLOYED[name]}`,
    );
  }
});

test('no superseded deployment is what the CLI points at', () => {
  // Each of these was replaced for a reason, and pointing at one would quietly cost a feature or
  // reintroduce a bug: the PoolWipedOut panic, the missing prover bounty, the missing proportional
  // payout, and a registry with no batch entrypoint.
  const superseded: Record<string, readonly string[]> = {
    pegGuard: [
      '0xb1abe0d450b778fdb32df54bb529f72d531ae8ce', // before the PoolWipedOut fix
      '0xc836457ad046a329e93e40a4b747e90ee53b85bc', // before FR-20
      '0x367693043c3e8396252728caebfbab3ff43c78d5', // before FR-30
    ],
    registry: [
      '0x89ab0ad8768cd06d0f3bc134ad2407705a49d309', // before FR-32
    ],
    adapter: [
      '0x678c84fe193a569fbdaf58e5f0d8f290a4072735', // bound to the superseded registry
    ],
  };

  for (const [name, olds] of Object.entries(superseded)) {
    const current = DEPLOYED[name as keyof typeof DEPLOYED].toLowerCase();
    assert.ok(
      !olds.includes(current),
      `the CLI is pointing at a superseded ${name} deployment (${current})`,
    );
  }
});

test('.env.example documents every variable the config loader reads', () => {
  const example = read('.env.example');
  const config = read('cli/src/lib/config.ts');

  // Every process.env key the loader touches, via str()/optional()/num() calls.
  const referenced = new Set<string>();
  for (const m of config.matchAll(/(?:str|optional|num)\(\s*'([A-Z0-9_]+)'/g)) {
    referenced.add(m[1]!);
  }
  assert.ok(referenced.size > 5, 'failed to parse config variables');

  const missing = [...referenced].filter((v) => !example.includes(v));
  assert.deepEqual(missing, [], `.env.example is missing: ${missing.join(', ')} (NFR-05)`);
});
