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
  registry: '0x89ab0ad8768CD06d0f3bc134ad2407705a49d309',
  adapter: '0x678C84Fe193a569FbDAF58e5f0d8f290a4072735',
  pegGuard: '0xc836457AD046a329E93e40A4B747E90ee53B85bC',
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
  provenTx: '0x51391915f812b640d8eafafdfd44205777d37d12d33c7319c9dc467b0f912d06',
  gas: 628_299,
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
  strike: 273_621_050_420n,
  notionalCtc: 50,
  breachAnswer: 247_422_860_000n,
  breachUpdatedAt: 1_788_846_839,
  breachSourceBlock: 25_930_684,
  breachSourceTx: '0x2f0aead47a7638027a5dce7225d7738d88593ad388955a8b3ac604b01c083896',
  roundId: 129_127_208_515_966_894_720n,
  tx: '0xb90dda642a3e77ab296ffdc0dd4521e6225b2653a301dc162123ac0a3776e39c',
  gas: 374_374,
  /** The four events that transaction emitted, in order. */
  events: [
    { name: 'TransactionVerified', from: 'the 0xFD2 precompile' },
    { name: 'RoundProven', from: 'ProvenFeedRegistry' },
    { name: 'LatestRoundUpdated', from: 'ProvenFeedRegistry' },
    { name: 'ClaimPaid', from: 'PegGuard' },
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
