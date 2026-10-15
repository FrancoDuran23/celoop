// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {BoxFactory} from "../src/BoxFactory.sol";
import {MockWARS} from "../src/test/MockWARS.sol";

/// @notice Local (anvil) deployment: MockWARS, TreasuryPolicy and BoxFactory.
///
/// Environment:
///   SIGNERS             comma-separated signer addresses (required)
///   AGENT               agent address (required, must not be a signer)
///   THRESHOLD           approvals needed (default: min(2, signer count))
///   PER_TX_CAP          automatic per-payment cap in wARS base units (default 100_000e18)
///   VENDOR_MONTHLY_CAP  automatic per-vendor 30-day cap in base units (default 300_000e18)
///   CONFIG_HASH         bytes32 hash of the current acta (default 0x0)
///
/// Usage:
///   SIGNERS=0x..,0x..,0x.. AGENT=0x.. forge script script/DeployLocal.s.sol \
///     --rpc-url http://127.0.0.1:8545 --private-key <anvil key> --broadcast
///
/// Prints one JSON line: {"chainId":..,"token":"0x..","treasury":"0x..","boxFactory":"0x.."}
contract DeployLocal is Script {
    struct Deployment {
        address token;
        address treasury;
        address boxFactory;
    }

    function run() external returns (Deployment memory d) {
        address[] memory signers = vm.envAddress("SIGNERS", ",");
        address agent = vm.envAddress("AGENT");
        uint256 defaultThreshold = signers.length < 2 ? signers.length : 2;
        uint256 threshold = vm.envOr("THRESHOLD", defaultThreshold);
        uint256 perTxCap = vm.envOr("PER_TX_CAP", uint256(100_000e18));
        uint256 vendorMonthlyCap = vm.envOr("VENDOR_MONTHLY_CAP", uint256(300_000e18));
        bytes32 configHash = vm.envOr("CONFIG_HASH", bytes32(0));

        vm.startBroadcast();
        MockWARS token = new MockWARS();
        TreasuryPolicy treasury =
            new TreasuryPolicy(address(token), signers, threshold, agent, perTxCap, vendorMonthlyCap, configHash);
        BoxFactory factory = new BoxFactory(address(treasury), address(token));
        vm.stopBroadcast();

        d = Deployment({token: address(token), treasury: address(treasury), boxFactory: address(factory)});

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "token", d.token);
        vm.serializeAddress(obj, "treasury", d.treasury);
        string memory json = vm.serializeAddress(obj, "boxFactory", d.boxFactory);
        console.log(json);
    }
}
