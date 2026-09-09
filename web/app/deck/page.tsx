import type { Metadata } from 'next';
import { Logo } from '../../components/Logo';
import {
  BATCH,
  CHAIN,
  CLAIM,
  CONTRACTS,
  DEPEG,
  PROPORTIONAL_CLAIM,
  REPO,
  formatAnswer,
  shortHash,
  utc,
} from '../../lib/deployment';
import './deck.css';

export const metadata: Metadata = {
  title: 'ProofFeed — project deck',
  description:
    'Chainlink price rounds proven onto Creditcoin by the Attestcoin Protocol, and parametric depeg cover that settles by proof. BUIDL CTC 2026, DeFi track.',
};

/**
 * The submission deck.
 *
 * Static by design: every figure comes from `lib/deployment.ts`, the same committed constants the
 * landing page uses, rather than a live read. A deck is a snapshot that gets printed to PDF and
 * attached to a form — it must render identically today and in a month, and it must not fail
 * because an RPC was slow while the print engine was waiting.
 */
export const dynamic = 'force-static';

const LEAVES = 9;

/** Fixed locale: a deck printed on a machine set to id-ID must not read "650.223 gas". */
const n = (v: number) => v.toLocaleString('en-US');

function Leaf({
  n,
  title,
  lede,
  foot,
  children,
  className,
}: {
  n: number;
  title?: string;
  lede?: React.ReactNode;
  foot?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={`leaf-${n}`} className={`leaf${className ? ` ${className}` : ''}`}>
      <div className="leafHead">
        <span className="leafMark">ProofFeed · PegGuard</span>
        <span className="leafNum">
          {n} / {LEAVES}
        </span>
      </div>
      {title ? <h2 className="leafTitle">{title}</h2> : null}
      {lede ? <p className="leafLede">{lede}</p> : null}
      {children ? <div className="leafBody">{children}</div> : null}
      {foot ? <div className="leafFoot">{foot}</div> : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="deckRow">
      <span className="deckRowLabel">{label}</span>
      <div className="deckRowValue">{children}</div>
    </div>
  );
}

export default function Deck() {
  return (
    <div className="deck">
      {/* ── 1 · Cover ───────────────────────────────────────────────────────────────────────── */}
      <section id="leaf-1" className="leaf cover">
        <div className="coverMark">
          <Logo size={40} />
          <span className="coverName">ProofFeed · PegGuard</span>
        </div>
        <h1 className="coverTitle">A price feed you cannot write to.</h1>
        <p className="coverSub">
          Real Ethereum-mainnet Chainlink rounds proven onto Creditcoin by the Attestcoin Protocol,
          and parametric depeg cover that settles because a round happened — not because anyone
          approved it.
        </p>
        <div className="coverMeta">
          <span>BUIDL CTC 2026</span>
          <span>DeFi track</span>
          <span>Creditcoin CC3 testnet · {CHAIN.id}</span>
          <span>Live on chain, source-verified</span>
        </div>
      </section>

      {/* ── 2 · Problem ─────────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={2}
        title="Every price on a young chain is somebody's word."
        lede={
          <>
            Chainlink does not publish on Creditcoin. To get a price there today you run a relayer, a
            multisig, or a bridge committee — and whatever the architecture diagram says, the number
            arrives because <strong>a party you trust asserted it</strong>.
          </>
        }
        foot="The failure is not theoretical: relayer and bridge compromise is the largest loss category in DeFi"
      >
        <div className="deckCols">
          <div>
            <div className="deckColTitle">What that costs</div>
            <ul className="deckList">
              <li>
                A lending market on a new chain inherits <strong>a second trust assumption</strong>{' '}
                that has nothing to do with Chainlink&rsquo;s own security.
              </li>
              <li>
                The relayer can be down, censored, or wrong, and a consumer contract cannot tell
                which.
              </li>
              <li>
                Historical prices are usually unavailable at all, so anything that needs to settle
                against a past event has nothing to settle against.
              </li>
            </ul>
          </div>
          <div>
            <div className="deckColTitle">What a builder actually wants</div>
            <ul className="deckList amber">
              <li>
                The <strong>same</strong> number Chainlink published on Ethereum, with the same
                provenance.
              </li>
              <li>
                No new party to trust, and no admin key anywhere that can write a price.
              </li>
              <li>
                The ordinary <strong>AggregatorV3Interface</strong>, so existing code compiles
                unchanged.
              </li>
            </ul>
          </div>
        </div>
      </Leaf>

      {/* ── 3 · Insight ─────────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={3}
        title="A Chainlink round is an Ethereum transaction."
        lede={
          <>
            Every price update is an <strong>AnswerUpdated</strong> log inside a mainnet transaction.
            The Attestcoin Protocol proves mainnet transactions to Creditcoin natively, through the
            Block Prover precompile at <strong>0x…0FD2</strong>. Put those two facts together and the
            relayer disappears.
          </>
        }
        foot="Attestcoin commits transaction history — transaction, receipt and logs. This design uses exactly that and claims nothing more"
      >
        <div className="deckRows">
          <Row label="Not this">
            an off-chain service reads a price and writes it into a contract
            <span className="sub">
              trust moves from Ethereum consensus to whoever runs the service
            </span>
          </Row>
          <Row label="This">
            anyone submits the original transaction&rsquo;s bytes plus an inclusion and continuity
            proof; the precompile verifies them; the contract decodes the log out of bytes that were
            just verified
            <span className="sub">
              trust stays with Ethereum consensus, Chainlink&rsquo;s aggregator, and Creditcoin&rsquo;s
              attestor set — no project-run server is in the path
            </span>
          </Row>
          <Row label="Consequence">
            there is <strong>no setPrice</strong>, and no admin function that can write, alter or
            delete a price
            <span className="sub">
              a structural test walks the compiled ABI and fails if any state-changing registry
              function ever gains a signed-integer input
            </span>
          </Row>
        </div>
      </Leaf>

      {/* ── 4 · Mechanism ───────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={4}
        title="Seven checks, and a round is stored."
        lede={
          <>
            Submission is <strong>permissionless</strong>. A malicious caller can only waste their own
            gas: every path out of this list is a revert.
          </>
        }
        foot="ProvenFeedRegistry.recordRound · the same list applies to every element of a batch"
      >
        <div className="deckCols">
          <ul className="deckList">
            <li>
              <strong>1.</strong> the query id has never been processed — replay protection before
              anything is spent
            </li>
            <li>
              <strong>2.</strong> the precompile returned true for inclusion <em>and</em> continuity
            </li>
            <li>
              <strong>3.</strong> the transaction type is one the decoder supports
            </li>
            <li>
              <strong>4.</strong> the source receipt status is 1 — a reverted transaction&rsquo;s logs
              are never believed
            </li>
          </ul>
          <ul className="deckList">
            <li>
              <strong>5.</strong> the log&rsquo;s emitter is an active aggregator registered{' '}
              <strong>for that same chain key</strong> — without this, a Sepolia proof could pass as
              mainnet
            </li>
            <li>
              <strong>6.</strong> the log is exactly <strong>AnswerUpdated</strong>: 3 topics, 32
              bytes of data
            </li>
            <li>
              <strong>7.</strong> that round has not been stored before
            </li>
          </ul>
        </div>
      </Leaf>

      {/* ── 5 · Evidence ────────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={5}
        title="The 2023 USDC depeg, sitting on Creditcoin."
        lede={
          <>
            On 11 March 2023, as Silicon Valley Bank failed, Chainlink&rsquo;s USDC/USD feed printed
            eighty-eight cents. That exact round was imported from its original mainnet transaction —
            three years of continuity proven in one call.
          </>
        }
        foot={
          <>
            Registry <span className="addr">{CONTRACTS.registry}</span> · verified on Blockscout
          </>
        }
      >
        <div className="deckCols">
          <div>
            <div className="deckReading breach">${formatAnswer(DEPEG.answer, DEPEG.decimals)}</div>
            <p
              style={{
                fontSize: '1.15cqw',
                color: 'var(--scratch-dim)',
                marginTop: '1.2cqw',
                lineHeight: 1.45,
              }}
            >
              Chainlink updatedAt {utc(DEPEG.updatedAt)}
              <br />
              Ethereum block {n(DEPEG.sourceBlock)}, transaction index {DEPEG.txIndex}
            </p>
          </div>
          <div className="deckRows" style={{ alignSelf: 'center' }}>
            <Row label="Source">
              <span className="deckHash">{shortHash(DEPEG.sourceTx, 20, 12)}</span>
              <span className="sub">Ethereum mainnet — open it on Etherscan and compare</span>
            </Row>
            <Row label="Proven">
              <span className="deckHash">{shortHash(DEPEG.provenTx, 20, 12)}</span>
              <span className="sub">
                {n(DEPEG.gas)} gas · {DEPEG.continuityRoots} continuity roots
              </span>
            </Row>
            <Row label="In the receipt">
              TransactionVerified from 0x…0FD2, then RoundProven from the registry
              <span className="sub">
                the precompile&rsquo;s own event and ours, in the same transaction
              </span>
            </Row>
          </div>
        </div>
      </Leaf>

      {/* ── 6 · Product ─────────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={6}
        title="PegGuard: cover that pays because a round happened."
        lede={
          <>
            A holder buys &ldquo;pay me if this feed prints below the strike this week&rdquo;. To
            collect, somebody proves the breaching round. There is{' '}
            <strong>no adjuster, no vote, and no admin function</strong> that can approve or deny a
            claim.
          </>
        }
        foot={`Two policies · identical strike ${formatAnswer(CLAIM.strike, 8)} and ${CLAIM.notionalCtc} CTC notional · settled on the identical proven round`}
      >
        <table className="deckTable">
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">Premium</th>
              <th scope="col">Payout</th>
              <th scope="col">Back to the pool</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Full — a trigger</td>
              <td>{PROPORTIONAL_CLAIM.fullPremiumCtc} CTC</td>
              <td>50.000000000000000000 CTC</td>
              <td>0</td>
            </tr>
            <tr>
              <td>Proportional — the depth of the breach</td>
              <td>{PROPORTIONAL_CLAIM.premiumCtc} CTC</td>
              <td className="better">{PROPORTIONAL_CLAIM.payoutCtc} CTC</td>
              <td>{PROPORTIONAL_CLAIM.releasedCtc} CTC</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: '1.28cqw', color: 'var(--scratch-dim)', lineHeight: 1.5, margin: 0 }}>
          Proportional pays{' '}
          <strong style={{ color: 'var(--scratch)' }}>notional × (strike − answer) ÷ strike</strong>
          , so an 8.8% breach pays 8.8% — and costs 40% less, because it pays less. The pool reserves
          the full notional either way, and releases what the breach did not claim. A share of every
          premium goes to whoever <em>first proved</em> the round.
        </p>
      </Leaf>

      {/* ── 7 · Depth of use ────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={7}
        title="Three rounds, one continuity proof."
        lede={
          <>
            <strong>recordRoundBatch</strong> drives the precompile&rsquo;s second surface: its batch
            overload verifies many transactions against one shared proof. It is not unconditionally
            cheaper, and publishing only the flattering half would be dishonest.
          </>
        }
        foot="Atomic either way: every round lands, or none does · the CLI warns above a hundred-block span"
      >
        <table className="deckTable">
          <thead>
            <tr>
              <th scope="col">Rounds</th>
              <th scope="col">Span</th>
              <th scope="col">Proven separately</th>
              <th scope="col">Batched</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {BATCH.comparisons.map((c) => {
              const d = ((c.batched - c.separate) / c.separate) * 100;
              return (
                <tr key={`${c.rounds}-${c.span}`}>
                  <td>{c.rounds}</td>
                  <td>{n(c.span)} blocks</td>
                  <td>{n(c.separate)}</td>
                  <td>{n(c.batched)}</td>
                  <td className={d < 0 ? 'better' : undefined}>
                    {d < 0 ? '−' : '+'}
                    {Math.abs(d).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: '1.28cqw', color: 'var(--scratch-dim)', lineHeight: 1.5, margin: 0 }}>
          A shared proof spans the first block to the last; a single one reaches only its own
          checkpoint. Reproduce both with{' '}
          <strong style={{ color: 'var(--scratch)' }}>pf prove-batch --compare --dry-run</strong>.
        </p>
      </Leaf>

      {/* ── 8 · Limits ──────────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={8}
        title="What it does not do."
        lede={
          <>
            This section is the differentiator, not the disclaimer. An Attestcoin integration that
            claims more than this is overselling itself.
          </>
        }
        foot="Testnet CTC · unaudited · premiums non-refundable · one-directional: Creditcoin reads Ethereum, never the reverse"
      >
        <div className="deckCols">
          <ul className="deckList">
            <li>
              <strong>It proves history, not state.</strong> It can prove round R happened and printed
              X. It can never prove R is the latest round, or what latestRoundData returns on mainnet
              right now.
            </li>
            <li>
              <strong>The feed is a lower bound.</strong> Consumers must apply their own staleness
              check, exactly as a careful mainnet Chainlink consumer does.
            </li>
            <li>
              <strong>PegGuard is immune to that limit</strong>, which is the point of the pairing: a
              policy pays if <em>any</em> round in the window breached. Existence is precisely what a
              transaction proof establishes.
            </li>
          </ul>
          <ul className="deckList">
            <li>
              <strong>You cannot insure a depeg that already printed.</strong> Cover always starts in
              the future. A deliberate safety property, and the reason the claim demo uses a live
              round.
            </li>
            <li>
              <strong>Feed registration is owner-managed.</strong> Centralisation of{' '}
              <em>configuration</em>, never of data.
            </li>
            <li>
              <strong>Permissionless registration was specified, researched, and not shipped.</strong>{' '}
              Zero AggregatorConfirmed events exist across thirteen major mainnet feeds since the
              start of the attestable window, so the feature would be code no proof could ever
              exercise.
            </li>
          </ul>
        </div>
      </Leaf>

      {/* ── 9 · Status ──────────────────────────────────────────────────────────────────────── */}
      <Leaf
        n={9}
        title="Shipped, deployed, and checkable in five minutes."
        lede={
          <>
            Three contracts source-verified on Blockscout, three feeds carrying proven rounds, and a
            keeper that ran sixteen hours unattended.
          </>
        }
        foot={REPO.replace('https://', '')}
      >
        <div className="deckCols three">
          <div>
            <div className="deckColTitle">On chain</div>
            <ul className="deckList">
              <li>the 2023 depeg round, imported</li>
              <li>a claim settled by proof — five events in one transaction</li>
              <li>the same round paid two ways</li>
              <li>three rounds on one continuity proof</li>
              <li>prover bounty accrued and withdrawn</li>
            </ul>
          </div>
          <div>
            <div className="deckColTitle">Verified</div>
            <ul className="deckList">
              <li>
                <strong>131</strong> contract tests, no network access
              </li>
              <li>
                <strong>25</strong> CLI tests
              </li>
              <li>
                <strong>99.0%</strong> line coverage on src/
              </li>
              <li>decode tested against real captured mainnet bytes</li>
              <li>attestation lag measured at 7.4–8.8 min</li>
            </ul>
          </div>
          <div>
            <div className="deckColTitle">Next</div>
            <ul className="deckList amber">
              <li>more feeds, and a keeper network the bounty already pays for</li>
              <li>richer payout curves on the same settlement rail</li>
              <li>
                permissionless registration the moment Chainlink rotates an aggregator upstream
              </li>
            </ul>
          </div>
        </div>
      </Leaf>
    </div>
  );
}
