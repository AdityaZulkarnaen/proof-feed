// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {IProvenFeedRegistry} from "../src/interfaces/IProvenFeedRegistry.sol";
import {PegGuard} from "../src/PegGuard.sol";
import {ProvenFeedAdapter} from "../src/ProvenFeedAdapter.sol";
import {ProvenFeedRegistry} from "../src/ProvenFeedRegistry.sol";

/// @notice Deploys the P0 stack to CC3 testnet and registers one feed (FR-17).
/// @dev Aggregator addresses are NEVER hardcoded here. `FEED_EMITTER` / `FEED_PHASE_ID` /
///      `FEED_DECIMALS` / `FEED_DESCRIPTION` come from the environment, and the values are read
///      off the live mainnet proxy by `npm run pf -- register --dry-run` (CLAUDE.md rule 3).
///
///      Run:
///        forge script script/Deploy.s.sol --rpc-url $CREDITCOIN_RPC_URL \
///          --private-key $CREDITCOIN_WALLET_PRIVATE_KEY --broadcast --legacy
///      (`--legacy` per docs/09 Q5 if the node rejects EIP-1559 fields.)
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");
        string memory feedDescription = vm.envString("FEED_DESCRIPTION");
        uint64 chainKey = uint64(vm.envUint("FEED_CHAIN_KEY"));
        address emitter = vm.envAddress("FEED_EMITTER");
        uint16 phaseId = uint16(vm.envUint("FEED_PHASE_ID"));
        uint8 decimals = uint8(vm.envUint("FEED_DECIMALS"));

        // Optional second phase, so a historical round (Branch H) can also be proven.
        address emitter2 = vm.envOr("FEED_EMITTER_PHASE2", address(0));
        uint16 phaseId2 = uint16(vm.envOr("FEED_PHASE_ID_PHASE2", uint256(0)));

        // PegGuard pool defaults (docs/06 Day 3).
        uint16 premiumBps = uint16(vm.envOr("POOL_PREMIUM_BPS_30D", uint256(50)));
        uint32 waitingPeriod = uint32(vm.envOr("POOL_WAITING_PERIOD", uint256(0)));
        uint128 maxNotional = uint128(vm.envOr("POOL_MAX_NOTIONAL", uint256(100 ether)));
        uint16 bountyBps = uint16(vm.envOr("POOL_PROVER_BOUNTY_BPS", uint256(2000)));
        // FR-30: proportional cover pays less than full cover, so it is written at a lower rate.
        uint16 proportionalBps = uint16(vm.envOr("POOL_PROPORTIONAL_BPS_30D", uint256(30)));
        /// FR-33: 0 selects PegGuard's own safe defaults (at-the-money ceiling, 24h reference).
        uint16 maxStrikeBps = uint16(vm.envOr("POOL_MAX_STRIKE_BPS", uint256(0)));
        uint24 maxReferenceAge = uint24(vm.envOr("POOL_MAX_REFERENCE_AGE", uint256(0)));

        bytes32 feedId = keccak256(bytes(feedDescription));

        vm.startBroadcast();

        ProvenFeedRegistry registry = new ProvenFeedRegistry(owner);
        registry.registerFeed(feedId, chainKey, emitter, phaseId, decimals, feedDescription);
        if (emitter2 != address(0)) {
            registry.registerFeed(feedId, chainKey, emitter2, phaseId2, decimals, feedDescription);
        }

        ProvenFeedAdapter adapter =
            new ProvenFeedAdapter(IProvenFeedRegistry(address(registry)), feedId);

        PegGuard pegGuard = new PegGuard(IProvenFeedRegistry(address(registry)), owner);
        pegGuard.configurePool(
            feedId, premiumBps, waitingPeriod, maxNotional, true, bountyBps, proportionalBps
        );
        // FR-33. Zeros select the contract's safe defaults: a strike may sit at the latest proven
        // answer but never above it, against a reference no older than 24h. Set
        // PEGGUARD_MAX_STRIKE_BPS=65535 only to stage a breach on testnet — that sells cover which
        // is already in the money, and the event it emits says so on chain.
        pegGuard.configureStrikeBounds(feedId, maxStrikeBps, maxReferenceAge);

        vm.stopBroadcast();

        console.log("{");
        console.log('  "registry": "%s",', vm.toString(address(registry)));
        console.log('  "adapter": "%s",', vm.toString(address(adapter)));
        console.log('  "pegGuard": "%s",', vm.toString(address(pegGuard)));
        console.log('  "owner": "%s",', vm.toString(owner));
        console.log('  "feedId": "%s",', vm.toString(feedId));
        console.log('  "feedDescription": "%s",', feedDescription);
        console.log('  "chainKey": %s,', vm.toString(uint256(chainKey)));
        console.log('  "emitter": "%s",', vm.toString(emitter));
        console.log('  "phaseId": %s,', vm.toString(uint256(phaseId)));
        console.log('  "emitterPhase2": "%s",', vm.toString(emitter2));
        console.log('  "decimals": %s', vm.toString(uint256(decimals)));
        console.log("}");
    }
}
