/**
 * Refresh lib/snapshot.json - the committed fallback the page shows, labelled `cached`, when the
 * live CC3 read fails. The values are captured from the real chain so the fallback never contains
 * anything invented.
 *
 *   node scripts/refresh-snapshot.mjs
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { writeFileSync } from 'node:fs';

const RPC = 'https://rpc.cc3-testnet.creditcoin.network';
const REGISTRY = '0x89ab0ad8768CD06d0f3bc134ad2407705a49d309';
const PEGGUARD = '0x367693043C3E8396252728cAEBfBAB3fF43c78d5';

const FEEDS = [
  { id: '0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256', description: 'USDC / USD', decimals: 8 },
  { id: '0x62ddc8c5ffbd077b5a28e92efd10abcc58e66fb2a326401f0efd02e173ac1777', description: 'ETH / USD', decimals: 8 },
];

const rpc = new JsonRpcProvider(RPC, 102031, { staticNetwork: true });
const registry = new Contract(REGISTRY, [
  'function latestRoundData(bytes32 feedId) view returns (uint80,int256,uint64,uint64)',
], rpc);
const pegGuard = new Contract(PEGGUARD, [
  'function getPolicy(uint256) view returns (tuple(bytes32 feedId, address holder, int256 strike, uint128 notional, uint128 premiumPaid, uint64 start, uint64 expiry, uint8 status, uint80 claimRoundId, uint128 proverBounty))',
  'function getPool(bytes32) view returns (tuple(uint256 balance, uint256 locked, uint256 totalShares, uint16 premiumBpsPer30d, uint32 waitingPeriod, uint128 maxNotional, bool active, uint16 proverBountyBps))',
  'function bountyEscrow() view returns (uint256)',
], rpc);

const STATUS = ['NONE', 'ACTIVE', 'CLAIMED', 'EXPIRED'];

const feeds = [];
for (const feed of FEEDS) {
  const r = await registry.latestRoundData(feed.id);
  feeds.push({
    description: feed.description,
    roundId: r[0].toString(),
    answer: r[1].toString(),
    decimals: feed.decimals,
    updatedAt: Number(r[2]),
    provenAt: Number(r[3]),
  });
}

const policyRaw = await pegGuard.getPolicy(0);
const poolRaw = await pegGuard.getPool(FEEDS[1].id);
const escrowRaw = await pegGuard.bountyEscrow();

const out = {
  note: 'Committed fallback. Shown, labelled `cached`, only when the live CC3 read fails. Refresh with node scripts/refresh-snapshot.mjs',
  readAt: new Date().toISOString(),
  feeds,
  policy: {
    status: STATUS[Number(policyRaw.status)],
    claimRoundId: policyRaw.claimRoundId.toString(),
    notionalWei: policyRaw.notional.toString(),
    poolBalanceWei: poolRaw.balance.toString(),
    poolLockedWei: poolRaw.locked.toString(),
    proverBountyBps: Number(poolRaw.proverBountyBps),
    bountyEscrowWei: escrowRaw.toString(),
  },
};

writeFileSync('lib/snapshot.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote lib/snapshot.json');
for (const f of feeds) console.log(`  ${f.description}: ${f.answer} round ${f.roundId}`);
console.log(`  policy 0: ${out.policy.status} on round ${out.policy.claimRoundId}`);
