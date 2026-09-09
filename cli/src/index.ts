#!/usr/bin/env -S npx tsx
/**
 * `pf` — ProofFeed CLI (docs/04). Run: `npm run pf -- <command> [flags]`
 * Exit codes (docs/04 §6): 0 ok, 1 configuration/gate failure, 2 verification failed, 3 contract revert.
 */
import { ConfigError } from './lib/config.js';
import { colors, log } from './lib/log.js';
import { errMessage } from './lib/retry.js';

const USAGE = `
${colors.bold}pf${colors.reset} — ProofFeed / PegGuard CLI

  ${colors.bold}pf spike [--submit]${colors.reset}
      Day-1 GO/NO-GO gates (FR-12). Writes docs/spike-output.json.
      --submit         also deploy ProbeASC (if PROBE_ADDRESS is empty) and send one real
                       verification transaction on CC3 testnet (gate G4).
      --skip-history   skip the 2023 depeg probe (faster; leaves G5 undecided).

  ${colors.bold}pf deploy --proxy <address|USDC/USD> [--all-phases] [--dry-run] [--record]${colors.reset}
      Deploy registry + adapter + PegGuard and register the feed (FR-17). This is the
      path that actually works on CC3; script/Deploy.s.sol cannot run there (docs/09 Q5).

  ${colors.bold}pf register --proxy <address|USDC/USD> [--all-phases] [--dry-run]${colors.reset}
      Read aggregator()/phaseId()/decimals()/description() off the live Chainlink proxy
      and register the feed (FR-21). Prints the exact .env lines for the deploy script.

  ${colors.bold}pf prove --feed <F> [--tx <hash> | --latest] [--lookback 20000]${colors.reset}
      Prove one mainnet Chainlink round into the registry (FR-13). Idempotent.

  ${colors.bold}pf prove-batch --feed <F> [--count 3 | --tx <hash> ...] [--compare] [--dry-run]${colors.reset}
      Prove several rounds against ONE shared continuity proof, in one transaction (FR-32).
      --compare        also measure what the same rounds would cost proven separately.
      --dry-run        estimate and report only; submit nothing.

  ${colors.bold}pf watch --feed <F> [--interval 30] [--backfill 300] [--from <block>] [--once]${colors.reset}
      Permissionless keeper loop: prove every new round (FR-14). Idempotent, resumable.
      A cold start only looks back --backfill blocks (~1 h) so it does not replay history.

  ${colors.bold}pf claim --policy <id> [--tx <hash>]${colors.reset}
      Settle a PegGuard policy by proving the breaching round (FR-15, proveAndClaim).

  ${colors.bold}pf capture --tx <hash> --out <path> [--decimals 8] [--phase-id 3]${colors.reset}
      Freeze a real Attestcoin proof as a Foundry fixture (FR-16). Writes <path>.json
      and <path>.abi.hex. Refuses to write if the verifySingle dry-run is false.

  ${colors.bold}pf demo [--branch H|L|HL] [--yes]${colors.reset}
      Run the demo end to end with every explorer link printed (docs/08).

Environment is read from the repo-root .env (see .env.example).
`;

async function main(): Promise<number> {
  const [, , command = '', ...rest] = process.argv;

  switch (command) {
    case 'spike': {
      const { spike } = await import('./commands/spike.js');
      return await spike(rest);
    }
    case 'deploy': {
      const { deploy } = await import('./commands/deploy.js');
      return await deploy(rest);
    }
    case 'register': {
      const { register } = await import('./commands/register.js');
      return await register(rest);
    }
    case 'prove': {
      const { prove } = await import('./commands/prove.js');
      return await prove(rest);
    }
    case 'prove-batch': {
      const { proveBatch } = await import('./commands/prove-batch.js');
      return await proveBatch(rest);
    }
    case 'watch': {
      const { watch } = await import('./commands/watch.js');
      return await watch(rest);
    }
    case 'claim': {
      const { claim } = await import('./commands/claim.js');
      return await claim(rest);
    }
    case 'demo': {
      const { demo } = await import('./commands/demo.js');
      return await demo(rest);
    }
    case 'capture': {
      const { capture } = await import('./commands/capture.js');
      return await capture(rest);
    }
    case '':
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`unknown command: ${command}\n${USAGE}`);
      return 1;
  }
}

main()
  .then((code) => {
    log.printSurfaces();
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    log.printSurfaces();
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exitCode = 1;
      return;
    }
    log.error(errMessage(err));
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
    process.exitCode = 1;
  });
