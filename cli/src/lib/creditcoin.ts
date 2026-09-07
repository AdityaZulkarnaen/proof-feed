/**
 * Creditcoin CC3 testnet side: provider/wallet plumbing, artifact loading, gas policy (docs/04 §5),
 * receipt parsing (RoundProven + the precompile's TransactionVerified), explorer links.
 */
import {
  Contract,
  ContractFactory,
  Interface,
  JsonRpcProvider,
  Wallet,
  type ContractTransactionReceipt,
  type Log,
  type TransactionRequest,
} from 'ethers';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCK_PROVER_PRECOMPILE, MAX_GAS_CAP, gasPercentOfMax } from './attestcoin.js';
import { REPO_ROOT, type Config } from './config.js';
import { log } from './log.js';
import { errMessage, retry } from './retry.js';

export const CC3_CHAIN_ID = 102031n;

export interface Artifact {
  contractName: string;
  abi: readonly unknown[];
  bytecode: string;
}

/** Prefer the committed `cli/src/abi` export; fall back to a fresh `contracts/out` build. */
export function loadArtifact(name: string): Artifact {
  const exported = resolve(REPO_ROOT, 'cli', 'src', 'abi', `${name}.json`);
  if (existsSync(exported)) return JSON.parse(readFileSync(exported, 'utf8')) as Artifact;

  const forgeOut = resolve(REPO_ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`);
  if (existsSync(forgeOut)) {
    const j = JSON.parse(readFileSync(forgeOut, 'utf8')) as {
      abi: readonly unknown[];
      bytecode?: { object?: string };
    };
    return { contractName: name, abi: j.abi, bytecode: j.bytecode?.object ?? '0x' };
  }
  throw new Error(`Artifact ${name} not found. Run: cd contracts && forge build && cd .. && npm run abi`);
}

export function ccProvider(cfg: Config): JsonRpcProvider {
  return new JsonRpcProvider(cfg.creditcoinRpcUrl, Number(CC3_CHAIN_ID), { staticNetwork: true });
}

export function ethProvider(url: string): JsonRpcProvider {
  return new JsonRpcProvider(url, undefined, { staticNetwork: true });
}

export function ccWallet(cfg: Config, privateKey: string): Wallet {
  return new Wallet(privateKey, ccProvider(cfg));
}

export function explorerTx(cfg: Config, hash: string): string {
  return `${cfg.creditcoinExplorerUrl.replace(/\/+$/, '')}/tx/${hash}`;
}

export function explorerAddress(cfg: Config, address: string): string {
  return `${cfg.creditcoinExplorerUrl.replace(/\/+$/, '')}/address/${address}`;
}

/**
 * docs/04 §5: `estimateGas × 1.35`, falling back to the official examples' size heuristic when
 * pallet-evm drops the precompile revert reason during estimation. The fallback is multiplied by 8
 * because `recordRound` decodes the whole receipt, and capped at MAX_GAS_CAP / 10.
 */
export async function computeGasLimit(
  provider: JsonRpcProvider,
  req: TransactionRequest,
  continuityLength: number,
): Promise<{ gasLimit: bigint; estimated: boolean; note: string }> {
  try {
    const estimated = await retry('eth_estimateGas', () => provider.estimateGas(req), { attempts: 2 });
    const gasLimit = (estimated * 135n) / 100n;
    return { gasLimit, estimated: true, note: `estimateGas ${estimated} x1.35` };
  } catch (err) {
    const heuristic = BigInt(21_000 + continuityLength * 5_000 + 20_000) * 8n;
    const cap = MAX_GAS_CAP / 10n;
    const gasLimit = heuristic > cap ? cap : heuristic;
    return {
      gasLimit,
      estimated: false,
      note: `estimateGas failed (${errMessage(err)}); fallback (21k + ${continuityLength}x5k + 20k) x8 = ${gasLimit}`,
    };
  }
}

/** Deploy a contract from a forge artifact. */
export async function deploy(
  wallet: Wallet,
  artifact: Artifact,
  args: readonly unknown[],
): Promise<{ address: string; hash: string; gasUsed: bigint }> {
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  if (!tx) throw new Error(`${artifact.contractName}: no deployment transaction`);
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`${artifact.contractName}: deployment receipt missing`);
  return { address: await contract.getAddress(), hash: receipt.hash, gasUsed: receipt.gasUsed };
}

export function attach(artifact: Artifact, address: string, runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(address, artifact.abi as never, runner);
}

export interface ParsedEvent {
  name: string;
  address: string;
  args: Record<string, string>;
}

const VERIFIER_IFACE = new Interface([
  'event TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex)',
]);

/** Decode every log we understand: precompile `TransactionVerified` + all contract events. */
export function parseReceiptEvents(receipt: ContractTransactionReceipt, ifaces: Interface[]): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const l of receipt.logs as readonly Log[]) {
    const isPrecompile = l.address.toLowerCase() === BLOCK_PROVER_PRECOMPILE.toLowerCase();
    for (const iface of isPrecompile ? [VERIFIER_IFACE] : ifaces) {
      try {
        const parsed = iface.parseLog({ topics: [...l.topics], data: l.data });
        if (!parsed) continue;
        const args: Record<string, string> = {};
        parsed.fragment.inputs.forEach((input, i) => {
          args[input.name || `arg${i}`] = String(parsed.args[i]);
        });
        out.push({ name: parsed.name, address: l.address, args });
        break;
      } catch {
        /* not this interface */
      }
    }
  }
  return out;
}

/** Print gas as an absolute number plus the share of a CC3 block (README gas table). */
export function gasLine(gasUsed: bigint): string {
  return `${gasUsed.toLocaleString()} gas (${gasPercentOfMax(gasUsed).toFixed(3)}% of the 75,000,000 block cap)`;
}

export async function requireFunded(wallet: Wallet): Promise<bigint> {
  const provider = wallet.provider;
  if (!provider) throw new Error('wallet has no provider');
  const balance = await retry('eth_getBalance', () => provider.getBalance(wallet.address));
  log.info(`wallet ${wallet.address} balance ${(Number(balance) / 1e18).toFixed(6)} CTC`);
  if (balance === 0n) {
    throw new Error(
      `Wallet ${wallet.address} has 0 CTC on CC3 testnet. Fund it from the faucet (docs/05 §1) before submitting.`,
    );
  }
  return balance;
}
