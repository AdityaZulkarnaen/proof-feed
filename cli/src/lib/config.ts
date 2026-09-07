/**
 * Configuration loader. Precedence: shell env > repo-root `.env` (docs/04 §1).
 * Fails fast naming the exact missing variable.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo root = cli/src/lib → ../../.. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

const envPath = resolve(REPO_ROOT, '.env');
if (existsSync(envPath)) loadDotenv({ path: envPath, quiet: true });

export class ConfigError extends Error {
  constructor(variable: string, hint: string) {
    super(`Missing/invalid configuration: ${variable}. ${hint}`);
    this.name = 'ConfigError';
  }
}

function str(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(name, `Set it in ${envPath} (see .env.example).`);
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() ?? fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ConfigError(name, `Expected a number, got "${raw}".`);
  return n;
}

export interface Config {
  creditcoinRpcUrl: string;
  creditcoinExplorerUrl: string;
  privateKey: string;
  proofBuilderUrl: string;
  proofBuilderUrlAlt: string;
  sourceChainKey: number;
  ethMainnetRpcUrl: string;
  ethSepoliaRpcUrl: string;
  feedProxyUsdcUsd: string;
  feedProxyEthUsd: string;
  probeAddress: string;
  registryAddress: string;
  adapterAddress: string;
  pegguardAddress: string;
}

export function loadConfig(): Config {
  return {
    creditcoinRpcUrl: str('CREDITCOIN_RPC_URL', 'https://rpc.cc3-testnet.creditcoin.network'),
    creditcoinExplorerUrl: str('CREDITCOIN_EXPLORER_URL', 'https://creditcoin-testnet.blockscout.com'),
    privateKey: optional('CREDITCOIN_WALLET_PRIVATE_KEY'),
    proofBuilderUrl: str('PROOF_BUILDER_URL', 'https://prover.cc3-testnet.creditcoin.network'),
    proofBuilderUrlAlt: str('PROOF_BUILDER_URL_ALT', 'https://proof-gen-api.cc3-testnet.creditcoin.network'),
    sourceChainKey: num('SOURCE_CHAIN_KEY', 3),
    ethMainnetRpcUrl: str('ETH_MAINNET_RPC_URL', 'https://gateway.tenderly.co/public/mainnet'),
    ethSepoliaRpcUrl: optional('ETH_SEPOLIA_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com'),
    feedProxyUsdcUsd: str('FEED_PROXY_USDC_USD', '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'),
    feedProxyEthUsd: str('FEED_PROXY_ETH_USD', '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'),
    probeAddress: optional('PROBE_ADDRESS'),
    registryAddress: optional('REGISTRY_ADDRESS'),
    adapterAddress: optional('ADAPTER_ADDRESS'),
    pegguardAddress: optional('PEGGUARD_ADDRESS'),
  };
}

/** Throws ConfigError unless a usable 0x-prefixed 32-byte key is present. */
export function requirePrivateKey(cfg: Config): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.privateKey)) {
    throw new ConfigError(
      'CREDITCOIN_WALLET_PRIVATE_KEY',
      'Expected 0x-prefixed 66-char hex. Fund the address from the CC3 testnet faucet.',
    );
  }
  return cfg.privateKey;
}

/** Feed shorthand accepted by `--feed`. */
export function proxyForFeed(cfg: Config, feed: string): string {
  const key = feed.toUpperCase().replace(/[\s_]/g, '').replace('/', '');
  switch (key) {
    case 'USDCUSD':
      return cfg.feedProxyUsdcUsd;
    case 'ETHUSD':
      return cfg.feedProxyEthUsd;
    default:
      if (/^0x[0-9a-fA-F]{40}$/.test(feed)) return feed;
      throw new ConfigError('--feed', `Unknown feed "${feed}". Use USDC/USD, ETH/USD, or a proxy address.`);
  }
}
