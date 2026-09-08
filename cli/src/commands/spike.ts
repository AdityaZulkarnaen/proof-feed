/**
 * `pf spike` — FR-12. Day-1 GO/NO-GO gates (docs/06). Writes `docs/spike-output.json`.
 *
 * Gates:
 *   G1  prover health + chainInfo.getSupportedChainByKey(SOURCE_CHAIN_KEY).chainId == 1
 *   G2  attestation lag for the source chain key < 120 min behind the source head
 *   G3a >= 1 AnswerUpdated log from the current USDC/USD aggregator in the recent window
 *   G3b ProofBuilder.getProof succeeds and PrecompileBlockProver.verifySingle dry-run == true
 *   G4  (--submit) ProbeASC.execute on CC3 emits TransactionVerified + Probe, tx status 1
 *   G5  the real 2023-03-11 USDC depeg round can still be proven today -> Branch H, else Branch L
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Contract, Interface } from 'ethers';
import {
  computeTxIndex,
  dryRun,
  fetchProof,
  getAttestationGenesisHeight,
  getContinuityBounds,
  getLatestAttested,
  getSupportedChainByKey,
  getSupportedChains,
  makeBlockProver,
  makeChainInfo,
  makeProofBuilder,
  proverAttestedHeight,
  proverHealth,
  toProofArgs,
  waitAttested,
  type ContinuityResponse,
} from '../lib/attestcoin.js';
import {
  blockAtTimestamp,
  composeRoundId,
  countNewTransmission,
  findAnswerUpdatedLogs,
  findMinAnswerRound,
  formatAnswer,
  proxyLatestRoundData,
  resolveFeed,
  type AnswerUpdatedRecord,
  type ResolvedFeed,
} from '../lib/chainlink.js';
import { REPO_ROOT, loadConfig, requirePrivateKey, type Config } from '../lib/config.js';
import {
  attach,
  ccProvider,
  ccWallet,
  computeGasLimit,
  deploy,
  ethProvider,
  explorerAddress,
  explorerTx,
  gasLine,
  loadArtifact,
  parseReceiptEvents,
  requireFunded,
} from '../lib/creditcoin.js';
import { colors, log, table } from '../lib/log.js';
import { errMessage, retry } from '../lib/retry.js';

/**
 * Ethereum mainnet block near 2023-03-11, the USDC/SVB depeg day (docs/05 §4). Used only as the
 * height at which continuity coverage is probed; the breaching tx itself is discovered at runtime.
 */
const HIST_USDC_DEPEG_BLOCK = 16_810_000;

/** UTC window scanned for the depeg low. The exact block bounds are binary-searched at runtime. */
const DEPEG_WINDOW_START = '2023-03-11T00:00:00Z';
const DEPEG_WINDOW_END = '2023-03-12T00:00:00Z';

/** How far back to scan for AnswerUpdated logs (docs/04 §3 step 5). */
const SCAN_WINDOW_BLOCKS = 20_000;

/** Blocks are ~12 s on Ethereum mainnet; used to turn a block lag into minutes. */
const ETH_BLOCK_SECONDS = 12;

export interface Gate {
  id: string;
  name: string;
  pass: boolean | null;
  detail: string;
}

/** Evidence that the 2023 USDC depeg round can actually be proven (Branch H, docs/09 Q4). */
export interface HistoricalProbe {
  windowFrom: number;
  windowTo: number;
  scanned: { phaseId: number; aggregator: string; logs: number }[];
  txHash: string | null;
  blockNumber: number | null;
  phaseId: number | null;
  aggregator: string | null;
  aggregatorRoundId: string | null;
  roundId: string | null;
  answer: string | null;
  answerFormatted: string;
  updatedAt: string | null;
  proofOk: boolean;
  dryRunOk: boolean;
  continuityRoots: number | null;
  siblings: number | null;
  txBytesLength: number | null;
  elapsedSeconds: number | null;
  error?: string;
}

interface SpikeReport {
  ranAt: string;
  sourceChainKey: number;
  prover: { candidateA: unknown; candidateB: unknown; selected: string | null };
  chain: unknown;
  attestation: unknown;
  feed: unknown;
  proof: unknown;
  historical: HistoricalProbe | null;
  probe: unknown;
  gates: Gate[];
  branch: 'H' | 'L' | 'S' | null;
  exitCode: number;
}

function fmtGate(g: Gate): readonly string[] {
  const mark =
    g.pass === null ? `${colors.dim}SKIP${colors.reset}` : g.pass ? `${colors.green}PASS${colors.reset}` : `${colors.red}FAIL${colors.reset}`;
  return [g.id, mark, g.name, g.detail];
}

/**
 * Locate the lowest USDC/USD print of the 2023-03-11 depeg day across every phase aggregator, then
 * ask the prover for its proof and dry-run it against `0xFD2`. Aggregator addresses are discovered
 * from `proxy.phaseAggregators()` at runtime — nothing is hardcoded (CLAUDE.md rule 3).
 */
async function probeHistoricalDepeg(
  cfg: Config,
  eth: ReturnType<typeof ethProvider>,
  prover: ReturnType<typeof makeBlockProver>,
  proverUrl: string,
): Promise<HistoricalProbe> {
  const empty = (windowFrom: number, windowTo: number): HistoricalProbe => ({
    windowFrom,
    windowTo,
    scanned: [],
    txHash: null,
    blockNumber: null,
    phaseId: null,
    aggregator: null,
    aggregatorRoundId: null,
    roundId: null,
    answer: null,
    answerFormatted: 'n/a',
    updatedAt: null,
    proofOk: false,
    dryRunOk: false,
    continuityRoots: null,
    siblings: null,
    txBytesLength: null,
    elapsedSeconds: null,
  });

  let from = 0;
  let to = 0;
  try {
    from = await blockAtTimestamp(eth, Math.floor(Date.parse(DEPEG_WINDOW_START) / 1000), 16_700_000, 16_900_000);
    to = await blockAtTimestamp(eth, Math.floor(Date.parse(DEPEG_WINDOW_END) / 1000), from, 16_950_000);
    log.info(`depeg scan window: blocks ${from.toLocaleString()}-${to.toLocaleString()} (${DEPEG_WINDOW_START} .. ${DEPEG_WINDOW_END})`);

    const { min, scanned } = await findMinAnswerRound(eth, cfg.feedProxyUsdcUsd, from, to, { maxChunk: 5_000 });
    const out = empty(from, to);
    out.scanned = scanned;
    for (const s of scanned) log.info(`  phase ${s.phaseId} aggregator ${s.aggregator}: ${s.logs} AnswerUpdated logs`);
    if (!min) {
      out.error = 'no AnswerUpdated log found in the depeg window';
      log.warn(out.error);
      return out;
    }

    out.txHash = min.txHash;
    out.blockNumber = min.blockNumber;
    out.phaseId = min.phaseId;
    out.aggregator = min.emitter;
    out.aggregatorRoundId = min.aggregatorRoundId.toString();
    out.roundId = min.roundId.toString();
    out.answer = min.answer.toString();
    out.answerFormatted = `$${formatAnswer(min.answer, 8)}`;
    out.updatedAt = new Date(Number(min.updatedAt) * 1000).toISOString();
    log.ok(
      `lowest USDC/USD print in the window: ${out.answerFormatted} at ${out.updatedAt} ` +
        `(phase ${min.phaseId}, aggregator round ${min.aggregatorRoundId}, proxy roundId ${min.roundId})`,
    );
    log.info(`  block ${min.blockNumber.toLocaleString()} tx ${min.txHash}`);

    const pb = makeProofBuilder(cfg.sourceChainKey, proverUrl, 180_000);
    const t0 = Date.now();
    const proof = await fetchProof(pb, min.txHash);
    out.elapsedSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    out.proofOk = true;
    out.continuityRoots = proof.continuityProof.roots.length;
    out.siblings = proof.merkleProof.siblings.length;
    out.txBytesLength = (proof.txBytes.length - 2) / 2;
    out.dryRunOk = await dryRun(prover, proof);
    if (out.dryRunOk) {
      log.ok(`the 2023 depeg round IS provable today: verifySingle -> true (${out.continuityRoots} continuity roots)`);
    } else {
      log.error('historical proof fetched but verifySingle returned FALSE');
    }
    return out;
  } catch (err) {
    const out = empty(from, to);
    out.error = errMessage(err);
    log.error(`historical depeg probe failed: ${out.error}`);
    return out;
  }
}

export async function spike(argv: readonly string[]): Promise<number> {
  const submit = argv.includes('--submit');
  const skipHistory = argv.includes('--skip-history');
  const cfg = loadConfig();
  const gates: Gate[] = [];
  const report: SpikeReport = {
    ranAt: new Date().toISOString(),
    sourceChainKey: cfg.sourceChainKey,
    prover: { candidateA: null, candidateB: null, selected: null },
    chain: null,
    attestation: null,
    feed: null,
    proof: null,
    historical: null,
    probe: null,
    gates,
    branch: null,
    exitCode: 0,
  };

  const cc = ccProvider(cfg);
  const eth = ethProvider(cfg.ethMainnetRpcUrl);
  const ci = makeChainInfo(cc);
  const prover = makeBlockProver(cc);

  // ── Step 1: prover host health (Q1) ───────────────────────────────────────────────────────────
  log.step('1/7  Prover health check (docs/09 Q1)');
  const [a, b] = await Promise.all([proverHealth(cfg.proofBuilderUrl), proverHealth(cfg.proofBuilderUrlAlt)]);
  report.prover.candidateA = { url: cfg.proofBuilderUrl, ...a };
  report.prover.candidateB = { url: cfg.proofBuilderUrlAlt, ...b };
  log.info(`A ${cfg.proofBuilderUrl} -> ${a.status} ${a.ok ? 'OK' : 'FAIL'} ${a.body.slice(0, 120)}`);
  log.info(`B ${cfg.proofBuilderUrlAlt} -> ${b.status} ${b.ok ? 'OK' : 'FAIL'} ${b.body.slice(0, 120)}`);
  const proverUrl = a.ok ? cfg.proofBuilderUrl : b.ok ? cfg.proofBuilderUrlAlt : null;
  report.prover.selected = proverUrl;
  if (proverUrl) {
    log.surface('prover GET /api/v1/health', `${proverUrl} -> 200`);
    log.ok(`prover host selected: ${proverUrl}`);
  } else {
    log.error('neither prover host answered /api/v1/health');
  }

  // ── Step 2: supported chains (G1) ─────────────────────────────────────────────────────────────
  log.step('2/7  Source chain support (gate G1)');
  let chain: Awaited<ReturnType<typeof getSupportedChainByKey>> = null;
  let chainErr = '';
  try {
    const chains = await getSupportedChains(ci);
    for (const c of chains) log.info(`  key ${c.chainKey}: ${c.chainName} (chainId ${c.chainId}, encoding ${c.chainEncoding})`);
    report.chain = { supported: chains };
    chain = await getSupportedChainByKey(ci, cfg.sourceChainKey);
  } catch (err) {
    chainErr = errMessage(err);
    log.error(`chainInfo failed: ${chainErr}`);
  }
  const g1Pass = Boolean(proverUrl) && chain !== null && chain.chainId === 1;
  gates.push({
    id: 'G1',
    name: 'prover health + source chain supported',
    pass: g1Pass,
    detail: chain
      ? `key ${cfg.sourceChainKey} = ${chain.chainName}, chainId ${chain.chainId}; prover ${proverUrl ?? 'NONE'}`
      : `getSupportedChainByKey(${cfg.sourceChainKey}) -> null ${chainErr}`,
  });

  // ── Step 3: attestation genesis (G5 → branch) ─────────────────────────────────────────────────
  // `getAttestationGenesisHeight` returns 0 for chain key 3, which the SDK documents as "not
  // supported OR no configured genesis height" — ambiguous, so it cannot decide the branch on its
  // own. G5 is therefore settled by evidence: continuity bounds at the depeg height, and (unless
  // --skip-history) an actual getProof + verifySingle on the real 2023 depeg transaction, which is
  // exactly what Branch H needs to work (docs/09 Q3 + Q4 answered in one step).
  log.step('3/7  Historical depth (gate G5 -> demo branch, docs/09 Q3/Q4)');
  let genesis = -1;
  try {
    genesis = await getAttestationGenesisHeight(ci, cfg.sourceChainKey);
    log.info(
      `genesis height for key ${cfg.sourceChainKey}: ${genesis.toLocaleString()}` +
        (genesis === 0 ? '  (0 = unset/from-genesis per SDK docs — ambiguous, probing directly)' : ''),
    );
  } catch (err) {
    log.error(`getAttestationGenesisHeight failed: ${errMessage(err)}`);
  }

  let depegAttested = false;
  try {
    const bounds = await getContinuityBounds(ci, cfg.sourceChainKey, HIST_USDC_DEPEG_BLOCK);
    depegAttested = bounds.isAttested;
    log.info(
      `continuity at depeg height ${HIST_USDC_DEPEG_BLOCK.toLocaleString()}: isAttested=${bounds.isAttested} ` +
        `(parent ${bounds.parentHeight.toLocaleString()}, child ${bounds.childHeight.toLocaleString()})`,
    );
  } catch (err) {
    log.error(`getContinuityBounds at depeg height failed: ${errMessage(err)}`);
  }

  let historical: HistoricalProbe | null = null;
  if (!skipHistory && depegAttested && proverUrl) {
    historical = await probeHistoricalDepeg(cfg, eth, prover, proverUrl);
  } else if (skipHistory) {
    log.warn('--skip-history: not probing the 2023 depeg round');
  }

  const branchH = depegAttested && historical?.dryRunOk === true;
  report.branch = branchH ? 'H' : 'L';
  report.historical = historical;
  gates.push({
    id: 'G5',
    name: 'historical depth (Branch H vs L)',
    pass: branchH,
    detail: historical
      ? `depeg round ${historical.answerFormatted} proven-able: getProof=${historical.proofOk} dryRun=${historical.dryRunOk} -> Branch ${report.branch}`
      : `genesis ${genesis}, depeg height attested=${depegAttested}, history probe skipped -> Branch ${report.branch}`,
  });

  // ── Step 4: attestation lag (G2) ──────────────────────────────────────────────────────────────
  log.step('4/7  Attestation lag (gate G2)');
  let attestedHeight = 0;
  let sourceHead = 0;
  let lagBlocks = Number.NaN;
  let lagMinutes = Number.NaN;
  try {
    const latest = await getLatestAttested(ci, cfg.sourceChainKey);
    attestedHeight = latest.height;
    sourceHead = await retry('eth_blockNumber (source chain)', () => eth.getBlockNumber());
    log.surface('eth_blockNumber (source chain)', `head ${sourceHead.toLocaleString()}`);
    lagBlocks = sourceHead - attestedHeight;
    lagMinutes = (lagBlocks * ETH_BLOCK_SECONDS) / 60;
    if (proverUrl) await proverAttestedHeight(proverUrl, cfg.sourceChainKey);
    log.info(
      `attested ${attestedHeight.toLocaleString()} | source head ${sourceHead.toLocaleString()} | ` +
        `lag ${lagBlocks.toLocaleString()} blocks ~= ${lagMinutes.toFixed(1)} min`,
    );
    report.attestation = { attestedHeight, sourceHead, lagBlocks, lagMinutes, isAttestation: latest.isAttestation };
  } catch (err) {
    log.error(`attestation lag check failed: ${errMessage(err)}`);
  }
  gates.push({
    id: 'G2',
    name: 'attestation lag < 120 min',
    pass: Number.isFinite(lagMinutes) && lagMinutes < 120,
    detail: Number.isFinite(lagMinutes)
      ? `${lagBlocks.toLocaleString()} blocks ~= ${lagMinutes.toFixed(1)} min behind head`
      : 'not measured',
  });

  // ── Step 5: Chainlink logs (G3a, Q2) ──────────────────────────────────────────────────────────
  log.step('5/7  Chainlink AnswerUpdated logs (gate G3a, docs/09 Q2)');
  let feed: ResolvedFeed | null = null;
  let logs: AnswerUpdatedRecord[] = [];
  let newTransmissionCount = -1;
  try {
    feed = await resolveFeed(eth, cfg.feedProxyUsdcUsd);
    log.info(`feedId = keccak256("${feed.description}") = ${feed.feedId}`);
    const proxyLatest = await proxyLatestRoundData(eth, cfg.feedProxyUsdcUsd);
    log.info(
      `proxy.latestRoundData(): roundId ${proxyLatest.roundId} answer ${formatAnswer(proxyLatest.answer, feed.decimals)} ` +
        `updatedAt ${new Date(Number(proxyLatest.updatedAt) * 1000).toISOString()}  (reference only — never a ProofFeed input)`,
    );
    const head = sourceHead || (await eth.getBlockNumber());
    const from = Math.max(0, head - SCAN_WINDOW_BLOCKS);
    logs = await findAnswerUpdatedLogs(eth, feed.aggregator, from, head, { limit: 25 });
    for (const l of logs.slice(0, 5)) {
      log.info(
        `  block ${l.blockNumber.toLocaleString()} round ${l.aggregatorRoundId} ` +
          `answer ${formatAnswer(l.answer, feed.decimals)} updatedAt ${new Date(Number(l.updatedAt) * 1000).toISOString()} tx ${l.txHash}`,
      );
    }
    if (logs.length === 0) {
      newTransmissionCount = await countNewTransmission(eth, feed.aggregator, from, head);
      log.warn(`zero AnswerUpdated logs; NewTransmission logs in the same window: ${newTransmissionCount} (docs/09 Q2)`);
    }
    report.feed = {
      ...feed,
      scannedFrom: from,
      scannedTo: head,
      answerUpdatedCount: logs.length,
      newTransmissionCount,
      sample: logs.slice(0, 5).map((l) => ({
        txHash: l.txHash,
        blockNumber: l.blockNumber,
        answer: l.answer.toString(),
        aggregatorRoundId: l.aggregatorRoundId.toString(),
        updatedAt: l.updatedAt.toString(),
        composedRoundId: composeRoundId(feed!.phaseId, l.aggregatorRoundId).toString(),
      })),
    };
  } catch (err) {
    log.error(`Chainlink scan failed: ${errMessage(err)}`);
  }
  gates.push({
    id: 'G3a',
    name: '>=1 AnswerUpdated log from current aggregator',
    pass: logs.length > 0,
    detail: feed
      ? `${logs.length} logs from ${feed.aggregator} in the last ${SCAN_WINDOW_BLOCKS.toLocaleString()} blocks`
      : 'feed not resolved',
  });

  // ── Step 6: proof + dry run (G3b) ─────────────────────────────────────────────────────────────
  log.step('6/7  Attestcoin proof + verifySingle dry-run (gate G3b)');
  let proof: ContinuityResponse | null = null;
  let dryRunOk = false;
  let chosen: AnswerUpdatedRecord | null = null;
  if (proverUrl && logs.length > 0) {
    // Prefer the newest log at or below the attested tip so the wait is a no-op.
    chosen = logs.find((l) => attestedHeight > 0 && l.blockNumber <= attestedHeight) ?? logs[0]!;
    log.info(`selected tx ${chosen.txHash} at block ${chosen.blockNumber.toLocaleString()}`);
    const pb = makeProofBuilder(cfg.sourceChainKey, proverUrl, 120_000);
    try {
      await getContinuityBounds(ci, cfg.sourceChainKey, chosen.blockNumber);
      await waitAttested(pb, cfg.sourceChainKey, chosen.blockNumber);
      const t0 = Date.now();
      proof = await fetchProof(pb, chosen.txHash);
      log.info(`proof fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s (cached=${proof.cached})`);
      await computeTxIndex(prover, proof);
      dryRunOk = await dryRun(prover, proof);
      if (dryRunOk) log.ok('verifySingle dry-run returned true');
      else log.error('verifySingle dry-run returned FALSE — do not submit');
      report.proof = {
        txHash: proof.txHash,
        headerNumber: proof.headerNumber,
        txIndex: proof.txIndex,
        txBytesLength: (proof.txBytes.length - 2) / 2,
        siblings: proof.merkleProof.siblings.length,
        continuityRoots: proof.continuityProof.roots.length,
        cached: proof.cached,
        dryRunOk,
      };
    } catch (err) {
      log.error(`proof pipeline failed: ${errMessage(err)}`);
      report.proof = { error: errMessage(err), txHash: chosen.txHash };
    }
  } else {
    log.warn('skipped: no prover host or no AnswerUpdated log to prove');
  }
  gates.push({
    id: 'G3b',
    name: 'getProof + verifySingle dry-run == true',
    pass: dryRunOk,
    detail: proof
      ? `header ${proof.headerNumber.toLocaleString()}, ${proof.continuityProof.roots.length} continuity roots, dryRun=${dryRunOk}`
      : 'no proof obtained',
  });

  // ── Step 7: on-chain probe (G4) ───────────────────────────────────────────────────────────────
  log.step('7/7  On-chain ProbeASC.execute (gate G4)');
  let g4: boolean | null = null;
  if (!submit) {
    log.warn('skipped: pass --submit to send the on-chain probe transaction');
  } else if (!proof || !dryRunOk) {
    log.error('skipped: no verified proof to submit');
    g4 = false;
  } else {
    try {
      const pk = requirePrivateKey(cfg);
      const wallet = ccWallet(cfg, pk);
      await requireFunded(wallet);
      const artifact = loadArtifact('ProbeASC');

      let probeAddress = cfg.probeAddress;
      if (!probeAddress) {
        log.info('PROBE_ADDRESS not set — deploying ProbeASC…');
        const d = await deploy(wallet, artifact, []);
        probeAddress = d.address;
        log.ok(`ProbeASC deployed at ${probeAddress} — ${explorerAddress(cfg, probeAddress)}`);
        log.info(`deploy tx ${explorerTx(cfg, d.hash)} (${gasLine(d.gasUsed)})`);
        report.probe = { address: probeAddress, deployTx: d.hash, deployGas: d.gasUsed.toString() };
      } else {
        log.info(`using existing ProbeASC at ${probeAddress}`);
        report.probe = { address: probeAddress };
      }

      const probe = attach(artifact, probeAddress, wallet);
      const args = toProofArgs(proof);
      const iface = new Interface(artifact.abi as never);

      // Pre-flight. `ASCBase` stores `processedQueries[queryId] = true` only AFTER
      // `verifyAndEmit` has returned true, so a "Query already processed" revert is itself
      // evidence that this probe verified this exact proof on chain in an earlier run. Treat it
      // as a pass rather than failing a gate that has demonstrably already succeeded — otherwise
      // `pf spike --submit` could only ever be run once per round.
      try {
        await (probe as Contract).execute!.staticCall(0, ...args);
      } catch (err) {
        const msg = errMessage(err);
        if (msg.includes('Query already processed')) {
          log.ok('this proof was already verified on chain by this probe in an earlier run');
          log.info('  processedQueries[queryId] is set, which only happens after verifyAndEmit returned true');
          g4 = true;
          report.probe = { ...(report.probe as object), alreadyProcessed: true };
          gates.push({
            id: 'G4',
            name: 'ProbeASC.execute emits TransactionVerified + Probe',
            pass: true,
            detail: 'proof already processed by this probe on chain (idempotent re-run)',
          });
          return finish(report, gates);
        }
        log.error(`probe pre-flight failed: ${msg}`);
        throw err;
      }

      const data = iface.encodeFunctionData('execute', [0, ...args]);
      const gas = await computeGasLimit(wallet.provider as never, { to: probeAddress, data, from: wallet.address }, proof.continuityProof.roots.length);
      log.info(`gas policy: ${gas.note} -> gasLimit ${gas.gasLimit.toLocaleString()}`);

      const tx = await probe.execute!(0, ...args, { gasLimit: gas.gasLimit });
      log.info(`submitted ${tx.hash} — ${explorerTx(cfg, tx.hash)}`);
      const receipt = await tx.wait();
      if (!receipt) throw new Error('no receipt');
      log.surface('INativeQueryVerifier.verifyAndEmit (on-chain, 0xFD2)', `via ASCBase.execute, status ${receipt.status}`);
      log.surface('EvmV1Decoder.decodeReceiptFields (on-chain)', 'receipt + logs decoded from the verified bytes');
      log.ok(`probe tx status ${receipt.status} — ${gasLine(receipt.gasUsed)}`);

      const events = parseReceiptEvents(receipt, [iface]);
      for (const e of events) log.info(`  event ${e.name} from ${e.address}: ${JSON.stringify(e.args)}`);
      const sawVerified = events.some((e) => e.name === 'TransactionVerified');
      const sawProbe = events.some((e) => e.name === 'Probe');
      g4 = receipt.status === 1 && sawVerified && sawProbe;
      report.probe = {
        ...(report.probe as object),
        executeTx: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
        events,
      };
    } catch (err) {
      g4 = false;
      log.error(`probe failed: ${errMessage(err)}`);
      report.probe = { ...(report.probe as object), error: errMessage(err) };
    }
  }
  gates.push({
    id: 'G4',
    name: 'ProbeASC.execute emits TransactionVerified + Probe',
    pass: g4,
    detail:
      g4 === null
        ? 'not attempted (no --submit)'
        : g4
          ? `tx ${(report.probe as { executeTx?: string }).executeTx ?? ''} gas ${(report.probe as { gasUsed?: string }).gasUsed ?? ''}`
          : 'see error above',
  });

  return finish(report, gates);
}

/** Print the gate table, write docs/spike-output.json, and pick the exit code (docs/04 §6). */
function finish(report: SpikeReport, gates: Gate[]): number {
  const blocking = gates.filter((g) => ['G1', 'G2', 'G3a', 'G3b'].includes(g.id));
  const allBlockingPass = blocking.every((g) => g.pass === true);
  report.exitCode = allBlockingPass ? 0 : gates.find((g) => g.id === 'G3b')?.pass === false ? 2 : 1;

  process.stdout.write(`\n${colors.bold}DAY-1 GATE TABLE${colors.reset}\n`);
  process.stdout.write(table(['Gate', 'Result', 'Check', 'Evidence'], gates.map(fmtGate)) + '\n');
  process.stdout.write(
    `\n${colors.bold}DEMO BRANCH:${colors.reset} ${report.branch} ` +
      `(${report.branch === 'H' ? 'historical USDC depeg replay' : 'live threshold on a current feed'})\n`,
  );

  const outPath = resolve(REPO_ROOT, 'docs', 'spike-output.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  log.ok(`wrote ${outPath}`);

  if (!allBlockingPass) {
    const failed = blocking.filter((g) => g.pass !== true).map((g) => g.id).join(', ');
    log.error(`blocking gates failed: ${failed}`);
  }
  return report.exitCode;
}

export type { Config };
