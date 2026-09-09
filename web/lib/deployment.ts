/**
 * The live CC3-testnet deployment and the fixed historical facts the page is built on.
 * Mirrors `DEPLOYED` in `cli/src/lib/config.ts` and the evidence log in `docs/DEPLOYMENT.md`.
 *
 * Every value here is real and on chain. Nothing on this page may be invented.
 */

export const CHAIN = {
  id: 102031,
  name: 'Creditcoin CC3 Testnet',
  /** Overridable so a deploy can point at its own node; the public endpoint is the default. */
  rpc: process.env.CC3_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network',
  explorer: 'https://creditcoin-testnet.blockscout.com',
} as const;

export const SOURCE_CHAIN = {
  /** Attestcoin chain key for Ethereum mainnet. */
  key: 3,
  name: 'Ethereum Mainnet',
  explorer: 'https://etherscan.io',
} as const;

export const CONTRACTS = {
  registry: '0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed',
  adapter: '0x639f24D0E4298031Da29E523a81910166596027D',
  pegGuard: '0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e',
  /** The Block Prover / Native Query Verifier precompile. */
  verifier: '0x0000000000000000000000000000000000000FD2',
} as const;

export const FEEDS = {
  usdc: {
    id: '0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256',
    description: 'USDC / USD',
    decimals: 8,
  },
  eth: {
    id: '0x62ddc8c5ffbd077b5a28e92efd10abcc58e66fb2a326401f0efd02e173ac1777',
    description: 'ETH / USD',
    decimals: 8,
  },
} as const;

/** keccak256("AnswerUpdated(int256,uint256,uint256)") - the one event this system consumes. */
export const ANSWER_UPDATED_TOPIC =
  '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f';

/**
 * The record the whole project exists to make possible: Chainlink's USDC/USD low during the
 * Silicon Valley Bank collapse, proven onto Creditcoin from the original mainnet transaction.
 */
export const DEPEG = {
  answer: 88_000_000n,
  decimals: 8,
  updatedAt: 1_678_521_083,
  sourceBlock: 16_803_472,
  sourceTx: '0x24500a30910fb1a99de3c13eacb4e4dd05334e4078615dcf276c58dcfbddacd8',
  /** Phase-2 aggregator, discovered at runtime via proxy.phaseAggregators(2). */
  emitter: '0x789190466E21a8b78b8027866CBBDc151542A26C',
  aggregatorRoundId: 983n,
  /** (phaseId 2 << 64) | 983 */
  roundId: 36_893_488_147_419_104_215n,
  provenTx: '0x5c5f1c6d7351ccd1c2418c75bff1ae345734b026f12d7b7ea483b211aadb3a7c',
  gas: 650_223,
  continuityRoots: 529,
  txIndex: 61,
} as const;

/** A current round, proven the same way, to show the mechanism is not a one-off. */
export const CURRENT_ROUND = {
  answer: 99_988_765n,
  updatedAt: 1_788_768_023,
  sourceBlock: 25_924_144,
  sourceTx: '0x17e282ab446e6df3ac984046c5e17dbc0d47f4967842e2819b23fb91f85fc3ca',
  provenTx: '0xcca535ffa9d73b0e1d6c512fdd0d186acda014ca54248e981e0bc2c063eb3ebf',
  gas: 320_546,
} as const;

/** The PegGuard policy settled by proof, in a single Creditcoin transaction. */
export const CLAIM = {
  policyId: 0,
  feed: 'ETH / USD',
  strike: 275_435_680_339n,
  notionalCtc: 50,
  breachAnswer: 251_125_370_000n,
  breachUpdatedAt: 1_788_938_639,
  breachSourceBlock: 25_938_300,
  breachSourceTx: '0xcc75aa354d3ab92f1d4ac02fb63e14e3cb270c2726a878899c8e2ddab627035c',
  roundId: 129_127_208_515_966_894_753n,
  tx: '0xa6c5ffa8f670e590d2b1b36f559a48e03cb4eadb97c333e56c72703e4dbd36b6',
  gas: 449_666,
  /** FR-20: escrowed out of the premium, accrued on settlement, withdrawn separately. */
  bountyCtc: '0.011666666666666666',
  bountyWithdrawTx: '0xf73096088d9b7adcd027c20601fa7052a9e4f4596c183cd62116c67c09ab171e',
  /** The five events that transaction emitted, in order. */
  events: [
    { name: 'TransactionVerified', from: 'the 0xFD2 precompile' },
    { name: 'RoundProven', from: 'ProvenFeedRegistry' },
    { name: 'LatestRoundUpdated', from: 'ProvenFeedRegistry' },
    { name: 'BountyAccrued', from: 'PegGuard' },
    { name: 'ClaimPaid', from: 'PegGuard' },
  ],
} as const;

/**
 * FR-30. A second policy at the identical strike and notional, settled against the identical round,
 * differing only in how a breach pays. This is the comparison the product turns on.
 */
export const PROPORTIONAL_CLAIM = {
  policyId: 1,
  premiumCtc: '0.035',
  payoutCtc: '4.413064841323284691',
  releasedCtc: '45.586935158676715309',
  tx: '0x013188937ea2bede2fe7e41657bfe0a029b4cbd464dd2b11be049a0f9d701d52',
  gas: 339_346,
  /** Basis points per 30 days: full cover costs 50, proportional 30, because it pays less. */
  fullBps: 50,
  proportionalBps: 30,
  fullPremiumCtc: '0.058333333333333333',
  fullPayoutCtc: '50',
} as const;

/**
 * FR-32. Several rounds against one shared continuity proof. The saving is real but conditional:
 * a shared proof must span from the first block to the last, so clustered rounds win and scattered
 * ones lose. Every figure measured on chain or by `pf prove-batch --compare --dry-run`.
 */
export const BATCH = {
  tx: '0x882c6ae14cb691ce9d1da231ea4d1733b09e5b986d833f17b529c4217ea33da2',
  rounds: 3,
  spanBlocks: 4,
  fromBlock: 25_903_977,
  toBlock: 25_903_981,
  sharedRoots: 24,
  gas: 769_283,
  separateGas: 939_766,
  /** The full picture, including the cases where batching costs more. */
  comparisons: [
    { rounds: 3, span: 4, separate: 939_766, batched: 769_283 },
    { rounds: 3, span: 390, separate: 1_084_232, batched: 1_052_808 },
    { rounds: 2, span: 247, separate: 691_338, batched: 792_207 },
    { rounds: 4, span: 845, separate: 1_340_319, batched: 1_727_572 },
  ],
} as const;

export const REPO = 'https://github.com/AdityaZulkarnaen/proof-feed';

export const tx = (hash: string) => `${CHAIN.explorer}/tx/${hash}`;
export const address = (a: string) => `${CHAIN.explorer}/address/${a}`;
export const sourceTx = (hash: string) => `${SOURCE_CHAIN.explorer}/tx/${hash}`;

/** Format a feed answer at its decimals, keeping every digit. The digits are the argument. */
export function formatAnswer(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString();
  const frac = (abs % base).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function shortHash(hash: string, lead = 10, tail = 8): string {
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function utc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}
