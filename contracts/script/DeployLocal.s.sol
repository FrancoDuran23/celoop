// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {BoxFactory} from "../src/BoxFactory.sol";
import {MockWARS} from "../src/test/MockWARS.sol";
import {Attribution} from "./Attribution.sol";

/// @notice Local (anvil) deployment: MockWARS, TreasuryPolicy and BoxFactory.
/// Each creation carries ATTRIBUTION_SUFFIX after the constructor args, the same way Deploy.s.sol
/// does. An empty suffix (the default) leaves the init code unchanged.
///
/// Environment:
///   SIGNERS             comma-separated signer addresses (required)
///   AGENT               agent address (required, must not be a signer)
///   AUDITOR             auditor address (default 0x0 = no auditor)
///   THRESHOLD           approvals needed (default: min(2, signer count))
///   PER_TX_CAP          automatic per-payment cap in wARS base units (default 100_000e18)
///   VENDOR_MONTHLY_CAP  automatic per-vendor 30-day cap in base units (default 300_000e18)
///   CONFIG_HASH         bytes32 hash of the current acta (default 0x0)
///   ATTRIBUTION_SUFFIX  ERC-8021 data suffix (hex). Optional locally
///
/// Usage:
///   SIGNERS=0x..,0x..,0x.. AGENT=0x.. ATTRIBUTION_SUFFIX=0x.. forge script script/DeployLocal.s.sol \
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
        vm.startBroadcast();
        d = _deploy(vm.envOr("ATTRIBUTION_SUFFIX", bytes("")));
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "token", d.token);
        vm.serializeAddress(obj, "treasury", d.treasury);
        console.log(vm.serializeAddress(obj, "boxFactory", d.boxFactory));
    }

    function _deploy(bytes memory suffix) internal returns (Deployment memory d) {
        address token = Attribution.create(type(MockWARS).creationCode, "", suffix);
        address treasury = _treasury(token, suffix);
        address boxFactory = Attribution.create(type(BoxFactory).creationCode, abi.encode(treasury, token), suffix);
        return Deployment({token: token, treasury: treasury, boxFactory: boxFactory});
    }

    function _treasury(address token, bytes memory suffix) internal returns (address) {
        address[] memory signers = vm.envAddress("SIGNERS", ",");
        uint256 defaultThreshold = signers.length < 2 ? signers.length : 2;
        return Attribution.create(
            type(TreasuryPolicy).creationCode,
            abi.encode(
                token,
                signers,
                vm.envOr("THRESHOLD", defaultThreshold),
                vm.envAddress("AGENT"),
                vm.envOr("PER_TX_CAP", uint256(100_000e18)),
                vm.envOr("VENDOR_MONTHLY_CAP", uint256(300_000e18)),
                vm.envOr("CONFIG_HASH", bytes32(0)),
                vm.envOr("AUDITOR", address(0))
            ),
            suffix
        );
    }
}
