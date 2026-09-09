/**
 * The mark: a stylus scratch that holds, drops, and holds lower.
 *
 * It is the product's own event reduced to geometry — a feed flat at its peg, the moment it broke,
 * and the record of it afterwards. The drop is amber because this world reserves amber for a
 * breach (DESIGN.md); the flats are the bone-white scratch that carries every reading on the page.
 * Square caps, one stroke weight, no radius and no fill: the same instrument language as the drum.
 */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6h7" stroke="var(--scratch)" strokeWidth="2.6" strokeLinecap="square" />
      <path d="M10 6v8" stroke="var(--amber)" strokeWidth="2.6" />
      <path d="M10 14h7" stroke="var(--scratch)" strokeWidth="2.6" strokeLinecap="square" />
    </svg>
  );
}

/** The same mark, drawn one hairline lighter, for the external-link affordance in the nav. */
export function ExternalMark({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <path d="M2.5 7.5 7.5 2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.6 2.5h3.9v3.9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
