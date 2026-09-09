/**
 * `pf demo [--branch H|L] [--yes]` — docs/08.
 *
 * Runs the demo end to end with no hidden steps: every transaction is printed with its explorer
 * link, and every claim about what happened is read back off chain.
 *
 *   Branch H — import the real 2023-03-11 USDC/USD depeg round ($0.88) into Creditcoin.
 *   Branch L — the PegGuard lifecycle: deposit, buy cover, prove the breaching round, get paid.
 *
 * Both branches run by default, because they demonstrate different halves of the thesis and the
 * README explains why the claim cannot use the 2023 round (cover always starts in the future).
 */
import { Contract, formatEther } from 'ethers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dryRun, fetchProof, makeBlockProver, makeProofBuilder } from '../lib/attestcoin.js';
import { composeRoundId, formatAnswer, resolveFeed } from '../lib/chainlink.js';
import { REPO_ROOT, loadConfig, proxyForFeed } from '../lib/config.js';
import { attach, ccProvider, ethProvider, explorerAddress, explorerTx, loadArtifact } from '../lib/creditcoin.js';
import { colors, log } from '../lib/log.js';
import { errMessage, sleep } from '../lib/retry.js';
import { flag, has } from '../lib/args.js';
import { submitRecordRound } from './prove.js';

/** The transaction that carried the SVB-day low. Discovered at runtime by `pf spike`, pinned here. */
const DEPEG_TX = '0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8';

function banner(text: string): void {
  process.stdout.write(`\n${colors.bold}${colors.cyan}${'='.repeat(78)}\n${text}\n${'='.repeat(78)}${colors.reset}\n`);
}

async function pause(auto: boolean, seconds = 3): Promise<void> {
  if (auto) return;
  await sleep(seconds * 1000);
}

export async function demo(argv: readonly string[]): Promise<number> {
  const cfg = loadConfig();
  const auto = has(argv, '--yes');
  const branch = (flag(argv, '--branch') ?? 'HL').toUpperCase();

  if (!cfg.registryAddress || !cfg.pegguardAddress || !cfg.adapterAddress) {
    log.error('REGISTRY_ADDRESS, ADAPTER_ADDRESS and PEGGUARD_ADDRESS must all be set.');
    return 1;
  }

  const cc = ccProvider(cfg);
  const eth = ethProvider(cfg.ethMainnetRpcUrl);
  const prover = makeBlockProver(cc);
  const pb = makeProofBuilder(cfg.sourceChainKey, cfg.proofBuilderUrl, 180_000);

  const registryArtifact = loadArtifact('ProvenFeedRegistry');
  const adapterArtifact = loadArtifact('ProvenFeedAdapter');
  const guardArtifact = loadArtifact('PegGuard');
  const registry = attach(registryArtifact, cfg.registryAddress, cc);
  const adapter = attach(adapterArtifact, cfg.adapterAddress, cc);
  const guard = attach(guardArtifact, cfg.pegguardAddress, cc);

  banner('ProofFeed — every price here is a proven Ethereum mainnet transaction');
  log.info(`registry  ${explorerAddress(cfg, cfg.registryAddress)}`);
  log.info(`adapter   ${explorerAddress(cfg, cfg.adapterAddress)}`);
  log.info(`pegGuard  ${explorerAddress(cfg, cfg.pegguardAddress)}`);
  log.info('there is no setPrice on any of them — see cli/test/abi.test.ts');
  await pause(auto);

  // ── Branch H: import the real depeg round ───────────────────────────────────────────────────
  if (branch.includes('H')) {
    banner('BRANCH H — importing the real 2023-03-11 USDC/USD depeg round ($0.88)');
    const feed = await resolveFeed(eth, proxyForFeed(cfg, 'USDC/USD'));
    const depegRoundId = composeRoundId(2, 983n);

    log.info(`mainnet tx    https://etherscan.io/tx/${DEPEG_TX}`);
    log.info('this is the SVB weekend: USDC lost its peg and Chainlink printed $0.88');

    const stored = await (registry as Contract).getRound!(feed.feedId, depegRoundId);
    if (stored.exists) {
      log.ok(
        `already proven on Creditcoin: answer ${formatAnswer(stored.answer, feed.decimals)}, ` +
          `Chainlink updatedAt ${new Date(Number(stored.updatedAt) * 1000).toISOString()}, ` +
          `provenAt ${new Date(Number(stored.provenAt) * 1000).toISOString()}`,
      );
    } else {
      const proof = await fetchProof(pb, DEPEG_TX);
      log.info(`proof: ${proof.continuityProof.roots.length} continuity roots for a 3-year-old block`);
      if (!(await dryRun(prover, proof))) {
        log.error('dry-run false');
        return 2;
      }
      const { receipt } = await submitRecordRound(cfg, proof);
      log.ok(`proven: ${explorerTx(cfg, receipt.hash)}`);
    }

    const back = await (adapter as Contract).getRoundData!(depegRoundId);
    log.ok(
      `adapter.getRoundData(${depegRoundId}) -> ${formatAnswer(back[1] as bigint, 8)} at ` +
        `${new Date(Number(back[3]) * 1000).toISOString()}`,
    );
    log.info('a three-year-old Chainlink round, readable on Creditcoin through the Chainlink interface');
    await pause(auto);
  }

  // ── Branch L: the claim ─────────────────────────────────────────────────────────────────────
  if (branch.includes('L')) {
    banner('BRANCH L — PegGuard: a claim settled by proof, not by permission');

    const count = Number(await (guard as Contract).policyCount!());
    if (count === 0) {
      log.warn('no policies yet — run deposit/buyCover first (see docs/DEPLOYMENT.md)');
    } else {
      for (let id = 0; id < count; id++) {
        const p = await (guard as Contract).getPolicy!(id);
        const meta = await (registry as Contract).getFeed!(p.feedId);
        const status = ['NONE', 'ACTIVE', 'CLAIMED', 'EXPIRED'][Number(p.status)];
        // FR-30: the mode is what decides how much a breach pays, so it belongs on screen next to
        // the payout — two policies on the same round otherwise look like a contradiction.
        const mode = Number(p.mode) === 1 ? 'PROPORTIONAL' : 'FULL';
        const paid =
          Number(p.status) === 2
            ? ` paid ${formatEther(p.payout as bigint)} CTC on round ${p.claimRoundId}`
            : '';
        log.info(
          `policy ${id}: "${meta.description}" strike ${formatAnswer(p.strike as bigint, Number(meta.decimals))} ` +
            `notional ${(Number(p.notional) / 1e18).toFixed(2)} CTC ${mode} ` +
            `window ${new Date(Number(p.start) * 1000).toISOString()}..${new Date(Number(p.expiry) * 1000).toISOString()} ` +
            `[${status}]${paid}`,
        );
      }
      log.info('');
      log.info('to settle an ACTIVE policy: npm run pf -- claim --policy <id>');
      log.info('the claim is a proof, not a request: nobody approves it, the round does');
      log.info(
        'FULL pays the whole notional on any breach; PROPORTIONAL pays its depth, ' +
          'notional x (strike - answer) / strike — and costs less because it pays less (FR-30)',
      );
    }
    await pause(auto);
  }

  // ── What the registry holds right now ───────────────────────────────────────────────────────
  banner('Registry state — read live from CC3');
  for (const description of ['USDC / USD', 'ETH / USD']) {
    try {
      const feedId = (await (registry as Contract).getFeed!(
        (await import('../lib/chainlink.js')).feedIdOf(description),
      )) as { description: string; decimals: bigint; emitter: string };
      if (feedId.emitter === '0x0000000000000000000000000000000000000000') continue;
      const id = (await import('../lib/chainlink.js')).feedIdOf(description);
      const latest = await (registry as Contract).latestRoundData!(id);
      log.ok(
        `"${description}" latest proven round ${latest[0]} = ${formatAnswer(latest[1] as bigint, Number(feedId.decimals))} ` +
          `(Chainlink updatedAt ${new Date(Number(latest[2]) * 1000).toISOString()}, ` +
          `proven on Creditcoin ${new Date(Number(latest[3]) * 1000).toISOString()})`,
      );
    } catch (err) {
      log.debug(`${description}: ${errMessage(err)}`);
    }
  }

  banner('Remove Attestcoin and this registry has no inputs.');
  try {
    const spike = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'docs', 'spike-output.json'), 'utf8'),
    ) as { attestation?: { lagMinutes?: number } };
    if (spike.attestation?.lagMinutes !== undefined) {
      log.info(`measured attestation lag at spike time: ${spike.attestation.lagMinutes.toFixed(1)} min`);
    }
  } catch {
    /* spike output is optional here */
  }
  return 0;
}
