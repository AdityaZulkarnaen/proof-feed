/**
 * Live reads from Creditcoin CC3 testnet.
 *
 * Runs on the server (the page is an async Server Component with `revalidate`), so there is no
 * loading state, no CORS surface, and no ethers bundle shipped to the browser.
 *
 * FR-23 requires the page to say whether what it shows is live or cached. That is enforced here:
 * every reader returns a `source` of `'live'` or `'cached'`, and the cached path is only ever taken
 * when the chain read actually failed. Stale values are never presented as live.
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { CHAIN, CONTRACTS, FEEDS } from './deployment';
import snapshot from './snapshot.json';

/** Only the view functions this page calls. The full artifact would ship signatures nobody uses. */
const REGISTRY_ABI = [
  'function latestRoundData(bytes32 feedId) view returns (uint80 roundId, int256 answer, uint64 updatedAt, uint64 provenAt)',
  'function getRound(bytes32 feedId, uint80 roundId) view returns (tuple(int256 answer, uint64 updatedAt, uint64 provenAt, address prover, bytes32 queryId, bool exists))',
] as const;

const PEGGUARD_ABI = [
  'function getPolicy(uint256 policyId) view returns (tuple(bytes32 feedId, address holder, int256 strike, uint128 notional, uint128 premiumPaid, uint64 start, uint64 expiry, uint8 status, uint80 claimRoundId, uint128 proverBounty))',
  'function getPool(bytes32 feedId) view returns (tuple(uint256 balance, uint256 locked, uint256 totalShares, uint16 premiumBpsPer30d, uint32 waitingPeriod, uint128 maxNotional, bool active, uint16 proverBountyBps))',
  'function bountyEscrow() view returns (uint256)',
] as const;

export type Source = 'live' | 'cached';

export interface FeedReading {
  description: string;
  roundId: string;
  answer: string;
  decimals: number;
  updatedAt: number;
  provenAt: number;
}

export interface PolicyReading {
  status: 'NONE' | 'ACTIVE' | 'CLAIMED' | 'EXPIRED';
  claimRoundId: string;
  notionalWei: string;
  poolBalanceWei: string;
  poolLockedWei: string;
  /** FR-20: share of each premium escrowed for whoever proves the breaching round. */
  proverBountyBps: number;
  bountyEscrowWei: string;
}

export interface ChainState {
  source: Source;
  readAt: string;
  /** Present only when the live read failed, so the page can say what went wrong. */
  error?: string;
  feeds: FeedReading[];
  policy: PolicyReading | null;
}

const STATUS = ['NONE', 'ACTIVE', 'CLAIMED', 'EXPIRED'] as const;

function provider(): JsonRpcProvider {
  return new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true });
}

/** Reject a hanging RPC rather than letting a page render block on it. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function cached(error?: string): ChainState {
  return {
    source: 'cached',
    readAt: snapshot.readAt,
    ...(error ? { error } : {}),
    feeds: snapshot.feeds,
    policy: snapshot.policy as PolicyReading,
  };
}

/**
 * Read the registry and PegGuard. Falls back to the committed snapshot on any failure, labelled
 * `cached` so the page can tell the visitor which it is.
 */
export async function readChainState(): Promise<ChainState> {
  try {
    const rpc = provider();
    const registry = new Contract(CONTRACTS.registry, REGISTRY_ABI, rpc);
    const pegGuard = new Contract(CONTRACTS.pegGuard, PEGGUARD_ABI, rpc);

    const wanted = [FEEDS.usdc, FEEDS.eth] as const;

    const [readings, policy, pool, escrow] = await withTimeout(
      Promise.all([
        Promise.all(
          wanted.map(async (feed) => {
            const r = await registry.latestRoundData!(feed.id);
            return {
              description: feed.description,
              roundId: (r[0] as bigint).toString(),
              answer: (r[1] as bigint).toString(),
              decimals: feed.decimals,
              updatedAt: Number(r[2]),
              provenAt: Number(r[3]),
            } satisfies FeedReading;
          }),
        ),
        pegGuard.getPolicy!(0),
        pegGuard.getPool!(FEEDS.eth.id),
        pegGuard.bountyEscrow!(),
      ]),
      12_000,
      'CC3 read',
    );

    return {
      source: 'live',
      readAt: new Date().toISOString(),
      feeds: readings,
      policy: {
        status: STATUS[Number(policy.status)] ?? 'NONE',
        claimRoundId: (policy.claimRoundId as bigint).toString(),
        notionalWei: (policy.notional as bigint).toString(),
        poolBalanceWei: (pool.balance as bigint).toString(),
        poolLockedWei: (pool.locked as bigint).toString(),
        proverBountyBps: Number(pool.proverBountyBps),
        bountyEscrowWei: (escrow as bigint).toString(),
      },
    };
  } catch (err) {
    return cached(err instanceof Error ? err.message : String(err));
  }
}

/** Wei to CTC with a fixed number of decimals, without pulling in a formatting dependency. */
export function ctc(wei: string, dp = 6): string {
  const v = BigInt(wei);
  const base = 10n ** 18n;
  const whole = v / base;
  const frac = (v % base).toString().padStart(18, '0').slice(0, dp);
  return `${whole}.${frac}`;
}
