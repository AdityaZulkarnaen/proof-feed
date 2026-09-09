import { REPO } from '../lib/deployment';
import { ExternalMark, Logo } from './Logo';

/**
 * The instrument's header plate: a ruled bar carrying the station identity on the left and its
 * markings on the right. It is sticky and opaque — soot, one hairline rule, no blur, no shadow,
 * no radius — because a floating translucent pill is the category default this world refuses.
 *
 * The section links are the page's own markings, set in the station-label voice. Below 46rem they
 * step aside and the bar keeps what a visitor actually needs on a phone: who this is, and the way
 * to go verify it.
 */
const SECTIONS = [
  { href: '#record', label: 'Record' },
  { href: '#claim', label: 'Claim' },
  { href: '#payout', label: 'Payout' },
  { href: '#batch', label: 'Batch' },
  { href: '#limits', label: 'Limits' },
] as const;

export function Nav() {
  return (
    <nav className="nav" aria-label="Sections">
      <div className="shell navInner">
        <a className="brand" href="#record">
          <Logo />
          <span className="brandName">ProofFeed</span>
          <span className="brandSub">Creditcoin CC3</span>
        </a>

        <div className="navLinks">
          {SECTIONS.map((s) => (
            <a key={s.href} className="navLink" href={s.href}>
              {s.label}
            </a>
          ))}
          <a className="navLink navRepo" href={REPO} target="_blank" rel="noreferrer">
            Source
            <ExternalMark />
          </a>
        </div>
      </div>
    </nav>
  );
}
