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
const REGISTRY = '0x086Ae43C078122A419887a2D73a6d8e7Be3679Ed';
const PEGGUARD = '0x7Ae5B58c75Fe194F72d1d8a8527688339D013a6e';

const FEEDS = [
  { id: '0xb45d52f2002a2abc1f204eb800af7cbf074250de1f754f35254efca06f7b3256', description: 'USDC / USD', decimals: 8 },
  { id: '0x62ddc8c5ffbd077b5a28e92efd10abcc58e66fb2a326401f0efd02e173ac1777', description: 'ETH / USD', decimals: 8 },
];

const rpc = new JsonRpcProvider(RPC, 102031, { staticNetwork: true });
const registry = new Contract(REGISTRY, [
  'function latestRoundData(bytes32 feedId) view returns (uint80,int256,uint64,uint64)',
], rpc);
const pegGuard = new Contract(PEGGUARD, [
  'function getPolicy(uint256) view returns (tuple(bytes32 feedId, address holder, int256 strike, uint128 notional, uint128 premiumPaid, uint64 start, uint64 expiry, uint8 status, uint80 claimRoundId, uint128 proverBounty, uint8 mode, uint128 payout))',
  'function getPool(bytes32) view returns (tuple(uint256 balance, uint256 locked, uint256 totalShares, uint16 premiumBpsPer30d, uint32 waitingPeriod, uint128 maxNotional, bool active, uint16 proverBountyBps, uint16 proportionalBpsPer30d))',
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
const propRaw = await pegGuard.getPolicy(1);
const poolRaw = await pegGuard.getPool(FEEDS[1].id);
const escrowRaw = await pegGuard.bountyEscrow();

const MODE = ['FULL', 'PROPORTIONAL'];

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
    // FR-30: the same round settled two ways. Both are read back, never computed here.
    mode: MODE[Number(policyRaw.mode)],
    payoutWei: policyRaw.payout.toString(),
    proportional: {
      status: STATUS[Number(propRaw.status)],
      mode: MODE[Number(propRaw.mode)],
      payoutWei: propRaw.payout.toString(),
      notionalWei: propRaw.notional.toString(),
      claimRoundId: propRaw.claimRoundId.toString(),
    },
    proportionalBpsPer30d: Number(poolRaw.proportionalBpsPer30d),
    premiumBpsPer30d: Number(poolRaw.premiumBpsPer30d),
  },
};

writeFileSync('lib/snapshot.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote lib/snapshot.json');
for (const f of feeds) console.log(`  ${f.description}: ${f.answer} round ${f.roundId}`);
console.log(`  policy 0: ${out.policy.status} ${out.policy.mode} payout ${out.policy.payoutWei} on round ${out.policy.claimRoundId}`);
console.log(`  policy 1: ${out.policy.proportional.status} ${out.policy.proportional.mode} payout ${out.policy.proportional.payoutWei}`);
