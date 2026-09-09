/**
 * Render `/deck` to `docs/ProofFeed-Deck.pdf` — the PDF the DoraHacks submission form asks for.
 *
 *   cd web && npm run build && node scripts/render-deck.mjs
 *
 * The deck route is one source for two artifacts: a page a judge can open, and a nine-page 16:9 PDF.
 * Its print stylesheet fixes each leaf at 297×167mm (the same 16:9 the screen uses, which is why the
 * container-query type scales identically) and forces `print-color-adjust: exact` — without that,
 * the browser would helpfully strip the soot ground and print a smoked record on white paper.
 *
 * Needs a Chrome or Edge already on the machine; there is no headless-browser dependency in
 * package.json, because one npm module is not worth carrying for a file we regenerate by hand.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(WEB, '..', 'docs', 'ProofFeed-Deck.pdf');
const PORT = Number(process.env.DECK_PORT ?? 3210);
const URL = `http://localhost:${PORT}/deck`;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to one and re-run.');
  process.exit(1);
}

if (!existsSync(resolve(WEB, '.next'))) {
  console.error('No .next build found. Run `npm run build` in web/ first.');
  process.exit(1);
}

/** Resolve once the server answers, or give up. */
async function waitForServer(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'start', '-p', String(PORT)], {
  cwd: WEB,
  stdio: 'ignore',
  shell: process.platform === 'win32',
});

let code = 0;
try {
  if (!(await waitForServer(URL))) throw new Error(`${URL} never came up`);

  mkdirSync(dirname(OUT), { recursive: true });
  await new Promise((ok, fail) => {
    const p = spawn(
      chrome,
      ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${OUT}`, URL],
      { stdio: 'ignore' },
    );
    p.on('error', fail);
    p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`chrome exited ${c}`))));
  });

  console.log(`wrote ${OUT}`);
  console.log('9 leaves at 297x167mm. Open it before attaching it to anything.');
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  code = 1;
} finally {
  server.kill();
}
process.exit(code);
