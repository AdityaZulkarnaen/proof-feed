/**
 * `pf deploy --proxy <address|USDC/USD> [--all-phases] [--dry-run]` — FR-17, the working path.
 *
 * `contracts/script/Deploy.s.sol` is the chain-agnostic, documented deploy script, but it cannot run
 * against CC3: the node's `eth_getBlockByNumber` omits `mixHash`, so Foundry's block deserializer
 * fails with `prevrandao not set` before the script body executes (docs/09 Q5). `forge create` and
 * `cast send` are unaffected — and so is ethers, which is what this command uses.
 *
 * Aggregator addresses are read off the live Chainlink proxy at deploy time, never typed by hand
 * (CLAUDE.md rule 3).
 */
import { Contract, parseEther } from 'ethers';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { phaseAggregator, resolveFeed } from '../lib/chainlink.js';
import { REPO_ROOT, loadConfig, proxyForFeed, requirePrivateKey } from '../lib/config.js';
import {
  attach,
  ccWallet,
  deploy as deployContract,
  ethProvider,
  explorerAddress,
  explorerTx,
  gasLine,
  loadArtifact,
  requireFunded,
} from '../lib/creditcoin.js';
import { colors, log } from '../lib/log.js';
import { errMessage } from '../lib/retry.js';
import { flag, has, numberFlag } from '../lib/args.js';

export async function deploy(argv: readonly string[]): Promise<number> {
  const cfg = loadConfig();
  const dryRun = has(argv, '--dry-run');
  const allPhases = has(argv, '--all-phases');
  const record = has(argv, '--record');
  const chainKey = numberFlag(argv, '--chain-key', cfg.sourceChainKey);
  const proxyArg = flag(argv, '--proxy') ?? flag(argv, '--feed') ?? 'USDC/USD';
  const proxy = proxyForFeed(cfg, proxyArg);

  const premiumBps = numberFlag(argv, '--premium-bps', 50);
  const waitingPeriod = numberFlag(argv, '--waiting-period', 0);
  const maxNotional = flag(argv, '--max-notional') ?? '100';
  /** FR-20: share of each premium escrowed as a prover bounty, in basis points. */
  const bountyBps = numberFlag(argv, '--bounty-bps', 2_000);
  /** FR-30: rate for proportional cover, which pays less than full cover and so costs less. */
  const proportionalBps = numberFlag(argv, '--proportional-bps', 30);
  /**
   * FR-33: the highest strike the pool will write, in basis points of the latest proven answer.
   * The contract's own default (10_000 — at the money, never above it) is what 0 selects, and it
   * is what you want. 65535 turns the ceiling off, which lets a buyer purchase cover that is
   * already in the money; it exists only to stage a breach on testnet without waiting for a real
   * depeg, and the deploy prints a warning when you ask for it.
   */
  const maxStrikeBps = numberFlag(argv, '--max-strike-bps', 0);
  /** FR-33: how old the reference round may be before the pool stops selling. 0 = 24h default. */
  const maxReferenceAge = numberFlag(argv, '--max-reference-age', 0);

  const eth = ethProvider(cfg.ethMainnetRpcUrl);

  log.step(`resolving ${proxy} on source chain key ${chainKey}`);
  const feed = await resolveFeed(eth, proxy);
  log.info(`feedId ${feed.feedId} = keccak256("${feed.description}")`);

  const phases: { phaseId: number; aggregator: string }[] = [
    { phaseId: feed.phaseId, aggregator: feed.aggregator },
  ];
  if (allPhases) {
    for (let p = feed.phaseId - 1; p >= 1; p--) {
      const agg = await phaseAggregator(eth, proxy, p);
      if (/^0x0{40}$/i.test(agg)) continue;
      phases.push({ phaseId: p, aggregator: agg });
      log.info(`  also registering phase ${p}: ${agg}`);
    }
  }

  if (dryRun) {
    log.ok('--dry-run: nothing deployed');
    for (const p of phases) log.info(`would register phase ${p.phaseId} -> ${p.aggregator}`);
    return 0;
  }

  const wallet = ccWallet(cfg, requirePrivateKey(cfg));
  await requireFunded(wallet);

  const out: Record<string, string> = {};
  let totalGas = 0n;

  try {
    // 1. Registry
    log.step('deploying ProvenFeedRegistry');
    const registryArtifact = loadArtifact('ProvenFeedRegistry');
    const reg = await deployContract(wallet, registryArtifact, [wallet.address]);
    totalGas += reg.gasUsed;
    out['registry'] = reg.address;
    log.ok(`ProvenFeedRegistry ${reg.address} — ${gasLine(reg.gasUsed)}`);
    log.info(`  ${explorerTx(cfg, reg.hash)}`);

    // 2. Feeds
    const registry = attach(registryArtifact, reg.address, wallet);
    for (const p of phases) {
      const tx = await (registry as Contract).registerFeed!(
        feed.feedId,
        chainKey,
        p.aggregator,
        p.phaseId,
        feed.decimals,
        feed.description,
      );
      const rc = await tx.wait();
      totalGas += rc.gasUsed;
      log.ok(`registered phase ${p.phaseId} ${p.aggregator} — ${gasLine(rc.gasUsed)}`);
    }

    // 3. Adapter
    log.step('deploying ProvenFeedAdapter');
    const adapterArtifact = loadArtifact('ProvenFeedAdapter');
    const ad = await deployContract(wallet, adapterArtifact, [reg.address, feed.feedId]);
    totalGas += ad.gasUsed;
    out['adapter'] = ad.address;
    log.ok(`ProvenFeedAdapter ${ad.address} — ${gasLine(ad.gasUsed)}`);

    // 4. PegGuard + pool
    log.step('deploying PegGuard');
    const guardArtifact = loadArtifact('PegGuard');
    const pg = await deployContract(wallet, guardArtifact, [reg.address, wallet.address]);
    totalGas += pg.gasUsed;
    out['pegGuard'] = pg.address;
    log.ok(`PegGuard ${pg.address} — ${gasLine(pg.gasUsed)}`);

    const guard = attach(guardArtifact, pg.address, wallet);
    const cfgTx = await (guard as Contract).configurePool!(
      feed.feedId,
      premiumBps,
      waitingPeriod,
      parseEther(maxNotional),
      true,
      bountyBps,
      proportionalBps,
    );
    const cfgRc = await cfgTx.wait();
    totalGas += cfgRc.gasUsed;
    log.ok(
      `configurePool("${feed.description}", ${premiumBps} bps/30d, wait ${waitingPeriod}s, ` +
        `max ${maxNotional} CTC, prover bounty ${bountyBps / 100}% of premium, ` +
        `proportional ${proportionalBps} bps/30d) — ${gasLine(cfgRc.gasUsed)}`,
    );

    // FR-33. Written as its own transaction so the pool's underwriting bound is a separate,
    // greppable line in the deployment log rather than a silent default nobody chose.
    const boundsTx = await (guard as Contract).configureStrikeBounds!(
      feed.feedId,
      maxStrikeBps,
      maxReferenceAge,
    );
    const boundsRc = await boundsTx.wait();
    totalGas += boundsRc.gasUsed;
    out['maxStrikeBps'] = String(maxStrikeBps);
    if (maxStrikeBps === 65_535) {
      log.warn(
        'configureStrikeBounds(UNBOUNDED) — this pool will sell cover that is ALREADY IN THE ' +
          'MONEY. Demo staging only; never leave a pool holding real value like this.',
      );
    }
    log.ok(
      `configureStrikeBounds(${maxStrikeBps === 0 ? 'default 10000' : maxStrikeBps} bps, ` +
        `${maxReferenceAge === 0 ? 'default 86400' : maxReferenceAge}s) — ${gasLine(boundsRc.gasUsed)}`,
    );

    // 5. Report
    const json = JSON.stringify(
      {
        deployedAt: new Date().toISOString(),
        chainId: 102031,
        owner: wallet.address,
        feedId: feed.feedId,
        feedDescription: feed.description,
        sourceChainKey: chainKey,
        decimals: feed.decimals,
        phases,
        ...out,
        totalGas: totalGas.toString(),
      },
      null,
      2,
    );
    process.stdout.write(`\n${colors.bold}DEPLOYMENT${colors.reset}\n${json}\n\n`);
    for (const [name, address] of Object.entries(out)) {
      log.info(`${name.padEnd(9)} ${explorerAddress(cfg, address)}`);
    }
    log.ok(`total gas ${totalGas.toLocaleString()}`);

    process.stdout.write(`\n${colors.bold}.env lines${colors.reset}\n`);
    process.stdout.write(`REGISTRY_ADDRESS="${out['registry']}"\n`);
    process.stdout.write(`ADAPTER_ADDRESS="${out['adapter']}"\n`);
    process.stdout.write(`PEGGUARD_ADDRESS="${out['pegGuard']}"\n\n`);

    log.info('verify on Blockscout with:');
    log.info(
      `  forge verify-contract ${out['registry']} src/ProvenFeedRegistry.sol:ProvenFeedRegistry \\\n` +
        `    --verifier blockscout --verifier-url ${cfg.creditcoinExplorerUrl}/api/ --chain-id 102031 \\\n` +
        `    --constructor-args $(cast abi-encode "constructor(address)" ${wallet.address})`,
    );

    if (record) {
      const line = `\n<!-- pf deploy ${new Date().toISOString()} -->\n\`\`\`json\n${json}\n\`\`\`\n`;
      appendFileSync(resolve(REPO_ROOT, 'docs', 'DEPLOYMENT.md'), line);
      log.ok('appended to docs/DEPLOYMENT.md');
    }
    return 0;
  } catch (err) {
    log.error(`deploy failed: ${errMessage(err)}`);
    for (const [name, address] of Object.entries(out)) {
      log.warn(`already deployed: ${name} ${address}`);
    }
    return 3;
  }
}
