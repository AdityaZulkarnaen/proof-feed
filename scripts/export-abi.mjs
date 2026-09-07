#!/usr/bin/env node
/**
 * Copies ABI + deployed bytecode from `contracts/out/<Name>.sol/<Name>.json` into
 * `cli/src/abi/<Name>.json` so the CLI never guesses a signature (docs/04 §2 `creditcoin.ts`).
 * Run after `forge build`:  npm run abi
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'contracts', 'out');
const DEST = resolve(ROOT, 'cli', 'src', 'abi');

const CONTRACTS = ['ProbeASC', 'ProvenFeedRegistry', 'ProvenFeedAdapter', 'PegGuard'];

if (!existsSync(OUT)) {
  console.error(`contracts/out not found — run \`cd contracts && forge build\` first.`);
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });

let exported = 0;
for (const name of CONTRACTS) {
  const artifact = resolve(OUT, `${name}.sol`, `${name}.json`);
  if (!existsSync(artifact)) {
    console.warn(`skip ${name}: ${artifact} not built yet`);
    continue;
  }
  const json = JSON.parse(readFileSync(artifact, 'utf8'));
  const slim = {
    contractName: name,
    abi: json.abi,
    bytecode: json.bytecode?.object ?? '0x',
  };
  writeFileSync(resolve(DEST, `${name}.json`), JSON.stringify(slim, null, 2) + '\n');
  console.log(`exported ${name} (${json.abi.length} abi entries, ${(slim.bytecode.length - 2) / 2} bytes)`);
  exported++;
}

if (exported === 0) {
  console.error('nothing exported');
  process.exit(1);
}
