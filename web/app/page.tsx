import { DrumRecord } from '../components/DrumRecord';
import { Nav } from '../components/Nav';
import { ctc, readChainState } from '../lib/chain';
import {
  ANSWER_UPDATED_TOPIC,
  BATCH,
  CHAIN,
  CLAIM,
  CONTRACTS,
  CURRENT_ROUND,
  DEPEG,
  PROPORTIONAL_CLAIM,
  REPO,
  SOURCE_CHAIN,
  address,
  formatAnswer,
  shortHash,
  sourceTx,
  tx,
  utc,
} from '../lib/deployment';

/** Read the chain on the server, at most once a minute. */
export const revalidate = 60;

function Rule() {
  return <hr style={{ border: 0, borderTop: 'var(--rule)', margin: 0 }} />;
}

/** A ruled annotation line. Deliberately not a card: the record has rows, not boxes. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="stationLabel">{label}</span>
      <div className="rowValue">{children}</div>
    </div>
  );
}

export default async function Page() {
  const state = await readChainState();
  const live = state.source === 'live';

  return (
    <>
      <Nav />
      <main>
        {/* ── The record ────────────────────────────────────────────────────────────────────── */}
        <header
          id="record"
          className="shell"
          style={{ paddingBlock: 'clamp(2.5rem, 6vw, 4.5rem)' }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.25rem, 6vw, 4.25rem)',
              lineHeight: 1.02,
              maxWidth: '20ch',
              marginBottom: '1.5rem',
            }}
          >
            A price feed you cannot write to.
          </h1>
          <div className="prose" style={{ fontSize: '1.0625rem' }}>
            <p>
              On 11 March 2023, as Silicon Valley Bank failed, Chainlink&rsquo;s USDC/USD feed printed{' '}
              <strong>$0.88000000</strong>. That exact round now lives on Creditcoin — proven from the
              original Ethereum transaction by the Attestcoin Protocol, not reported by anyone.
            </p>
            <p>
              There is no <strong>setPrice</strong> on this registry. The owner can say which
              aggregator belongs to which feed; it cannot write, alter, or delete a price. The pen is
              driven by the ground.
            </p>
          </div>
        </header>

        <DrumRecord />

        <div className="shell">
          <div className="rows" style={{ marginTop: '-1px' }}>
            <Row label="Answer">
              <span className="reading" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', color: 'var(--amber)' }}>
                {formatAnswer(DEPEG.answer, DEPEG.decimals)}
              </span>
              <span className="stationLabel">USD, 8 decimals</span>
            </Row>
            <Row label="Chainlink updatedAt">
              <span className="reading" style={{ fontSize: '1.125rem' }}>{utc(DEPEG.updatedAt)}</span>
              <span className="stationLabel">when the price was published on mainnet</span>
            </Row>
            <Row label="Source transaction">
              <a className="hash" href={sourceTx(DEPEG.sourceTx)} target="_blank" rel="noreferrer">
                {shortHash(DEPEG.sourceTx)}
              </a>
              <span className="stationLabel">Etherscan · block {DEPEG.sourceBlock.toLocaleString()} · index {DEPEG.txIndex}</span>
            </Row>
            <Row label="Emitted by">
              <span className="hash">{DEPEG.emitter}</span>
              <span className="stationLabel">phase-2 aggregator, read from phaseAggregators(2)</span>
            </Row>
            <Row label="Proven on Creditcoin">
              <a className="hash" href={tx(DEPEG.provenTx)} target="_blank" rel="noreferrer">
                {shortHash(DEPEG.provenTx)}
              </a>
              <span className="stationLabel">
                Blockscout · {DEPEG.gas.toLocaleString()} gas · {DEPEG.continuityRoots} continuity roots
              </span>
            </Row>
            <Row label="Round id">
              <span className="hash">{DEPEG.roundId.toString()}</span>
              <span className="stationLabel">(phase 2 &lt;&lt; 64) | {DEPEG.aggregatorRoundId.toString()}</span>
            </Row>
          </div>

          <p className="prose" style={{ marginTop: '2rem', fontSize: '0.9375rem' }}>
            Open both transactions side by side. The answer, the round id and the timestamp match,
            because the Creditcoin contract decoded them out of the mainnet bytes the Block Prover
            precompile had just verified — it did not take anyone&rsquo;s word for them.
          </p>
        </div>

        {/* ── Live state ──────────────────────────────────────────────────────────────────────── */}
        <section id="live" className="section shell" style={{ marginTop: 'clamp(3.5rem, 7vw, 6rem)' }}>
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>What the registry holds right now</h2>
            <p className="prose">
              Read from {CHAIN.name} when this page rendered. Two clocks are shown and never merged:
              when Chainlink published the price, and when Creditcoin accepted its proof.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: '0.5rem 1.5rem',
              paddingBottom: '1rem',
            }}
          >
            <span
              className="stationLabel"
              style={{ color: live ? 'var(--amber)' : 'var(--scratch-dim)' }}
            >
              {live ? '● Live read' : '○ Cached — live read failed'}
            </span>
            <span className="stationLabel">{state.readAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}</span>
            {state.error && (
              <span className="stationLabel" style={{ color: 'var(--scratch-faint)' }}>
                {state.error}
              </span>
            )}
          </div>

          <div className="rows">
            {state.feeds.map((feed) => (
              <div className="row" key={feed.description}>
                <span className="stationLabel">{feed.description}</span>
                <div className="rowValue">
                  <span className="reading" style={{ fontSize: '1.5rem' }}>
                    {formatAnswer(BigInt(feed.answer), feed.decimals)}
                  </span>
                  <span className="stationLabel">published {utc(feed.updatedAt)}</span>
                  <span className="stationLabel">proven {utc(feed.provenAt)}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="prose" style={{ marginTop: '1.75rem', fontSize: '0.9375rem' }}>
            A newer Chainlink round may exist that nobody has proven yet. This registry reports a lower
            bound on what Chainlink has published, never a claim about the present. Any consumer must
            check <strong>updatedAt</strong> against its own staleness policy.
          </p>
        </section>

        {/* ── The claim ───────────────────────────────────────────────────────────────────────── */}
        <section id="claim" className="section shell">
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>A claim nobody approved</h2>
            <p className="prose">
              PegGuard is parametric cover built on this feed. Policy {CLAIM.policyId} paid{' '}
              {CLAIM.notionalCtc} CTC because a Chainlink round printed below its strike — proved and
              settled in one Creditcoin transaction, with no adjuster and no admin key in the path.
              A share of every premium is escrowed and paid to whoever proved that round, so running
              the keeper the feed depends on is worth someone&rsquo;s gas.
            </p>
          </div>

          <div className="rows">
            <Row label="Breaching round">
              <span className="reading" style={{ fontSize: '1.5rem' }}>
                {formatAnswer(CLAIM.breachAnswer, 8)}
              </span>
              <span className="stationLabel">
                {CLAIM.feed} · strike {formatAnswer(CLAIM.strike, 8)} · {utc(CLAIM.breachUpdatedAt)}
              </span>
            </Row>
            <Row label="Source transaction">
              <a className="hash" href={sourceTx(CLAIM.breachSourceTx)} target="_blank" rel="noreferrer">
                {shortHash(CLAIM.breachSourceTx)}
              </a>
              <span className="stationLabel">block {CLAIM.breachSourceBlock.toLocaleString()}</span>
            </Row>
            <Row label="proveAndClaim">
              <a className="hash" href={tx(CLAIM.tx)} target="_blank" rel="noreferrer">
                {shortHash(CLAIM.tx)}
              </a>
              <span className="stationLabel">{CLAIM.gas.toLocaleString()} gas</span>
            </Row>
            <Row label="Events, in order">
              <span style={{ display: 'grid', gap: '0.2rem' }}>
                {CLAIM.events.map((e, i) => (
                  <span key={e.name} style={{ fontSize: '0.9375rem' }}>
                    <span style={{ color: 'var(--scratch-faint)' }}>{i + 1}. </span>
                    <span style={{ color: 'var(--scratch)' }}>{e.name}</span>{' '}
                    <span style={{ color: 'var(--scratch-dim)' }}>from {e.from}</span>
                  </span>
                ))}
              </span>
            </Row>
            {state.policy && (
              <>
                <Row label="Policy state">
                  <span className="reading" style={{ fontSize: '1.125rem' }}>{state.policy.status}</span>
                  <span className="stationLabel">
                    pool holds {ctc(state.policy.poolBalanceWei, 6)} CTC · {ctc(state.policy.poolLockedWei, 0)} locked
                  </span>
                </Row>
                <Row label="Prover bounty">
                  <span className="reading" style={{ fontSize: '1.125rem' }}>
                    {(state.policy.proverBountyBps / 100).toFixed(0)}%
                  </span>
                  <span className="stationLabel">
                    of every premium, escrowed for whoever proves the breaching round
                  </span>
                  <span className="stationLabel">
                    {ctc(state.policy.bountyEscrowWei, 6)} CTC held in escrow now
                  </span>
                </Row>
              </>
            )}
          </div>
        </section>

        {/* ── Two payout modes (FR-30) ────────────────────────────────────────────────────────── */}
        <section id="payout" className="section shell">
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>The same round, paid two ways</h2>
            <p className="prose">
              A second policy was written at the identical strike and the identical{' '}
              {CLAIM.notionalCtc} CTC notional, differing only in how a breach settles — and both were
              claimed against that one proven round. Full cover is a trigger: any breach, however
              shallow, pays everything. Proportional cover pays the depth of the breach, which is what
              somebody hedging an actual position wants. It pays strictly less, so it costs less.
            </p>
          </div>

          <div className="rows">
            <Row label="Full payout">
              <span className="reading" style={{ fontSize: '1.5rem' }}>
                {PROPORTIONAL_CLAIM.fullPayoutCtc} CTC
              </span>
              <span className="stationLabel">
                premium {PROPORTIONAL_CLAIM.fullPremiumCtc} CTC · {PROPORTIONAL_CLAIM.fullBps} bps / 30d
              </span>
            </Row>
            <Row label="Proportional payout">
              <span className="reading" style={{ fontSize: '1.5rem', color: 'var(--amber)' }}>
                {PROPORTIONAL_CLAIM.payoutCtc} CTC
              </span>
              <span className="stationLabel">
                premium {PROPORTIONAL_CLAIM.premiumCtc} CTC ·{' '}
                {PROPORTIONAL_CLAIM.proportionalBps} bps / 30d
              </span>
              <span className="stationLabel">
                notional × (strike − answer) ÷ strike
              </span>
            </Row>
            <Row label="Returned to the pool">
              <span className="reading" style={{ fontSize: '1.125rem' }}>
                {PROPORTIONAL_CLAIM.releasedCtc} CTC
              </span>
              <span className="stationLabel">
                the pool reserves the whole notional either way — that is its worst case — and hands
                back what the breach did not claim
              </span>
            </Row>
            <Row label="claim">
              <a className="hash" href={tx(PROPORTIONAL_CLAIM.tx)} target="_blank" rel="noreferrer">
                {shortHash(PROPORTIONAL_CLAIM.tx)}
              </a>
              <span className="stationLabel">
                {PROPORTIONAL_CLAIM.gas.toLocaleString()} gas · the round was already proven, so no
                second proof was paid for
              </span>
            </Row>
            {state.policy && (
              <Row label="Read back just now">
                <span className="reading" style={{ fontSize: '1.125rem' }}>
                  {state.policy.proportional.status}
                </span>
                <span className="stationLabel">
                  policy 1, {state.policy.proportional.mode.toLowerCase()}, paid{' '}
                  {ctc(state.policy.proportional.payoutWei, 18)} CTC of{' '}
                  {ctc(state.policy.proportional.notionalWei, 0)}
                </span>
              </Row>
            )}
          </div>
        </section>

        {/* ── Batch proving (FR-32) ───────────────────────────────────────────────────────────── */}
        <section id="batch" className="section shell">
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>Three rounds, one proof</h2>
            <p className="prose">
              A proof carries a continuity chain from the nearest attestation checkpoint down to the
              block it proves. The batch endpoint returns <strong>one</strong> chain for a whole set of
              transactions, and the precompile has an overload that takes exactly that shape — so three
              Chainlink rounds from a single volatility burst landed in one Creditcoin transaction.
            </p>
          </div>

          <div className="rows">
            <Row label="recordRoundBatch">
              <a className="hash" href={tx(BATCH.tx)} target="_blank" rel="noreferrer">
                {shortHash(BATCH.tx)}
              </a>
              <span className="stationLabel">
                {BATCH.gas.toLocaleString()} gas · against {BATCH.separateGas.toLocaleString()} proving
                them one at a time
              </span>
            </Row>
            <Row label="What it spanned">
              <span className="reading" style={{ fontSize: '1.125rem' }}>
                {BATCH.spanBlocks} blocks
              </span>
              <span className="stationLabel">
                mainnet {BATCH.fromBlock.toLocaleString()}–{BATCH.toBlock.toLocaleString()}, two of the
                three in the same block · {BATCH.sharedRoots} shared continuity roots
              </span>
            </Row>
            <Row label="Events">
              <span className="stationLabel">
                {BATCH.rounds} × TransactionVerified from the 0xFD2 precompile and {BATCH.rounds} ×
                RoundProven from the registry, from a single call
              </span>
            </Row>
          </div>

          <p className="prose" style={{ marginTop: '2.5rem' }}>
            <strong>It is not automatically cheaper, and pretending otherwise would be dishonest.</strong>{' '}
            A shared chain has to reach from the first block in the set to the last, while each single
            proof only reaches its own checkpoint about a hundred blocks away. So the win depends on how
            clustered the rounds are, not on how many there are:
          </p>

          <div className="ledgerScroll" style={{ marginTop: '1.5rem' }}>
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Rounds</th>
                  <th scope="col">Span</th>
                  <th scope="col">Separately</th>
                  <th scope="col">Batched</th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                {BATCH.comparisons.map((c) => {
                  const delta = ((c.batched - c.separate) / c.separate) * 100;
                  const cheaper = delta < 0;
                  return (
                    <tr key={`${c.rounds}-${c.span}`}>
                      <td>{c.rounds}</td>
                      <td>{c.span.toLocaleString()} blocks</td>
                      <td>{c.separate.toLocaleString()}</td>
                      <td>{c.batched.toLocaleString()}</td>
                      <td className={cheaper ? 'better' : 'worse'}>
                        {cheaper ? '−' : '+'}
                        {Math.abs(delta).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="prose" style={{ marginTop: '1.5rem' }}>
            The CLI warns whenever a batch spans more than a hundred blocks, so nobody discovers this by
            spending gas. What batching buys unconditionally is atomicity: every round lands, or none
            does, and each one still passes every check a single proof passes.
          </p>
        </section>

        {/* ── Mechanism ───────────────────────────────────────────────────────────────────────── */}
        <section className="section shell">
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>How a price gets in</h2>
          </div>
          <div className="rows">
            <Row label="1 · On Ethereum">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                A Chainlink aggregator emits{' '}
                <span className="hash" style={{ color: 'var(--scratch)' }}>
                  AnswerUpdated(int256,uint256,uint256)
                </span>
                . That is an ordinary mainnet transaction.
              </span>
            </Row>
            <Row label="Event signature">
              <span className="hash" style={{ color: 'var(--scratch-dim)' }}>{ANSWER_UPDATED_TOPIC}</span>
            </Row>
            <Row label="2 · Attestcoin">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                Anyone fetches a proof of that transaction and submits it. The submitter has no
                privileges: they pay gas, and the contract decides what is true.
              </span>
            </Row>
            <Row label="3 · On Creditcoin">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                The Block Prover precompile at{' '}
                <span className="hash" style={{ color: 'var(--scratch)' }}>0x…0FD2</span> verifies
                inclusion and continuity. Only then does the registry decode the receipt, check the
                emitter is a registered aggregator <em>for that chain key</em>, and store the round.
              </span>
            </Row>
            <Row label="Rejected">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                A forged log from an unregistered address, a proof presented under the wrong chain key,
                a reverted source transaction, a replayed proof, or a malformed log. Each has a test.
              </span>
            </Row>
          </div>
        </section>

        {/* ── For developers ──────────────────────────────────────────────────────────────────── */}
        <section className="section shell">
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>Reading it from a contract</h2>
            <p className="prose">
              The adapter is shaped like Chainlink&rsquo;s <strong>AggregatorV3Interface</strong>, so a
              consumer already written for Chainlink compiles against it unchanged.
            </p>
          </div>
          <div className="rows">
            <Row label="Adapter">
              <a className="hash" href={address(CONTRACTS.adapter)} target="_blank" rel="noreferrer">
                {CONTRACTS.adapter}
              </a>
              <span className="stationLabel">USDC / USD · 8 decimals</span>
            </Row>
            <Row label="Registry">
              <a className="hash" href={address(CONTRACTS.registry)} target="_blank" rel="noreferrer">
                {CONTRACTS.registry}
              </a>
            </Row>
            <Row label="PegGuard">
              <a className="hash" href={address(CONTRACTS.pegGuard)} target="_blank" rel="noreferrer">
                {CONTRACTS.pegGuard}
              </a>
            </Row>
            <Row label="Chain">
              <span className="hash">{CHAIN.name} · chainId {CHAIN.id}</span>
              <span className="stationLabel">source: {SOURCE_CHAIN.name}, Attestcoin chain key {SOURCE_CHAIN.key}</span>
            </Row>
            <Row label="Extra, non-Chainlink">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                <span className="hash" style={{ color: 'var(--scratch)' }}>latestProvenAt()</span> — when
                Creditcoin accepted the proof, so you can reason about the staleness of the proof
                separately from the staleness of the price.
              </span>
            </Row>
          </div>
        </section>

        {/* ── Limitations ─────────────────────────────────────────────────────────────────────── */}
        <section id="limits" className="section shell">
          <div className="sectionHead">
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>What this does not do</h2>
            <p className="prose">Disclosed, not discovered.</p>
          </div>
          <div className="rows">
            <Row label="Not state">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                It proves transaction history. It cannot prove <strong>latestRoundData()</strong>, a
                balance, or that no newer round exists.
              </span>
            </Row>
            <Row label="A lower bound">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                Freshness is not guaranteed. Liveness depends on somebody running the keeper.
              </span>
            </Row>
            <Row label="No retroactive cover">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                Cover always starts in the future, so you cannot buy protection against a depeg that
                already printed. That is why the claim above uses a live ETH/USD round rather than the
                2023 one — the contract path is identical, only the strike differs.
              </span>
            </Row>
            <Row label="One direction">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                Creditcoin reads Ethereum. Nothing is written back.
              </span>
            </Row>
            <Row label="Configuration is owned">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                Registering a feed is <strong>onlyOwner</strong> — a centralisation point of
                configuration, not of data. Permissionless registration is future work.
              </span>
            </Row>
            <Row label="Testnet">
              <span className="prose" style={{ fontSize: '0.9375rem' }}>
                Unaudited. Payout asset is testnet CTC. Binary payout, premiums non-refundable.
              </span>
            </Row>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────────────────────────── */}
        <Rule />
        <footer
          className="shell"
          style={{
            paddingBlock: '3rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem 2.5rem',
            alignItems: 'baseline',
          }}
        >
          <a href={REPO} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            Source on GitHub
          </a>
          <a href={address(CONTRACTS.registry)} target="_blank" rel="noreferrer">
            Registry on Blockscout
          </a>
          <a href={tx(CLAIM.tx)} target="_blank" rel="noreferrer">
            The settled claim
          </a>
          <a href={sourceTx(CURRENT_ROUND.sourceTx)} target="_blank" rel="noreferrer">
            A current round on Etherscan
          </a>
          <span className="stationLabel" style={{ marginLeft: 'auto' }}>
            BUIDL CTC 2026 · DeFi · testnet only
          </span>
        </footer>
      </main>
    </>
  );
}
