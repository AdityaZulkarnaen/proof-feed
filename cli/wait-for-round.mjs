/* Waits until the ETH/USD registry holds a round inside policy 0's window and below its strike. */
import { Contract, JsonRpcProvider } from 'ethers';
import { readFileSync } from 'node:fs';
const cc = new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network', 102031, { staticNetwork: true });
const eth = new JsonRpcProvider('https://gateway.tenderly.co/public/mainnet', undefined, { staticNetwork: true });
const regAbi = JSON.parse(readFileSync('src/abi/ProvenFeedRegistry.json', 'utf8')).abi;
const guardAbi = JSON.parse(readFileSync('src/abi/PegGuard.json', 'utf8')).abi;
const reg = new Contract('0x89ab0ad8768CD06d0f3bc134ad2407705a49d309', regAbi, cc);
const guard = new Contract('0xc836457AD046a329E93e40A4B747E90ee53B85bC', guardAbi, cc);
const FEED = '0x62ddc8c5ffbd077b5a28e92efd10abcc58e66fb2a326401f0efd02e173ac1777';
const p = await guard.getPolicy(0);
const deadline = Date.now() + 100 * 60 * 1000;
while (Date.now() < deadline) {
  const head = await eth.getBlockNumber();
  const logs = await eth.getLogs({ address: '0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5',
    topics: ['0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f'], fromBlock: head - 400, toBlock: head });
  for (const l of logs) {
    const answer = BigInt.asIntN(256, BigInt(l.topics[1])), updatedAt = BigInt(l.data);
    if (updatedAt >= p.start && updatedAt <= p.expiry && answer < p.strike) {
      const roundId = (7n << 64n) | BigInt(l.topics[2]);
      const stored = await reg.getRound(FEED, roundId);
      console.log(`CLAIMABLE round ${roundId} $${(Number(answer)/1e8).toFixed(2)} at ${new Date(Number(updatedAt)*1000).toISOString()} provenOnChain=${stored.exists} tx=${l.transactionHash}`);
      if (stored.exists) { console.log('READY'); process.exit(0); }
      console.log('waiting for the keeper to prove it...');
    }
  }
  await new Promise(r => setTimeout(r, 60000));
}
console.log('TIMEOUT: no claimable round within 100 minutes');
process.exit(1);
