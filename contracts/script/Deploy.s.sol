// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {BoxFactory} from "../src/BoxFactory.sol";
import {MockWARS} from "../src/test/MockWARS.sol";

/// @notice Real deployment (local anvil, Celo Sepolia or Celo mainnet): TreasuryPolicy and
/// BoxFactory, plus MockWARS off mainnet when no token is given. Driven by app/scripts/setup.ts,
/// which also applies the safety cut (nothing leaves anvil without --yes).
///
/// Every creation carries the ERC-8021 attribution suffix: the init code is
/// `creationCode ++ abi.encode(constructor args) ++ ATTRIBUTION_SUFFIX`. Solidity constructors
/// decode their arguments from the start of that tail, so the trailing suffix is ignored by the
/// contract and read by the attribution indexers from the end of the transaction input.
///
/// Environment:
///   CHAIN               local | sepolia | mainnet (default local)
///   SIGNERS             comma-separated signer addresses (required)
///   AGENT               agent address (required, must not be a signer)
///   AUDITOR             auditor address (default 0x0 = no auditor; never the agent or a signer)
///   THRESHOLD           approvals needed (default: min(2, signer count))
///   PER_TX_CAP          automatic per-payment cap in wARS base units (default 100_000e18)
///   VENDOR_MONTHLY_CAP  automatic per-vendor 30-day cap in base units (default 300_000e18)
///   CONFIG_HASH         keccak256 of the acta (default 0x0)
///   WARS_ADDRESS        token to use. Mainnet defaults to the real wARS and refuses any other;
///                       elsewhere, unset means "deploy MockWARS"
///   ATTRIBUTION_SUFFIX  ERC-8021 data suffix (hex). Required on mainnet
///   DEPLOYER_PRIVATE_KEY  broadcaster key; unset = forge's --private-key/--account/--ledger
///
/// Prints one JSON line:
///   {"chainId":..,"token":"0x..","treasury":"0x..","boxFactory":"0x..","mockToken":bool}
contract Deploy is Script {
    address public constant MAINNET_WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    uint256 public constant CELO_MAINNET = 42220;

    struct Config {
        bool mainnet;
        address token; // address(0) = deploy MockWARS (never on mainnet)
        address[] signers;
        uint256 threshold;
        address agent;
        address auditor;
        uint256 perTxCap;
        uint256 vendorMonthlyCap;
        bytes32 configHash;
        bytes suffix;
    }

    struct Deployment {
        address token;
        address treasury;
        address boxFactory;
        bool mockToken;
    }

    function run() external returns (Deployment memory d) {
        Config memory c = configFromEnv();
        uint256 key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);
        d = deploy(c);
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "token", d.token);
        vm.serializeAddress(obj, "treasury", d.treasury);
        vm.serializeBool(obj, "mockToken", d.mockToken);
        string memory json = vm.serializeAddress(obj, "boxFactory", d.boxFactory);
        console.log(json);
    }

    function configFromEnv() public view returns (Config memory c) {
        c.mainnet = keccak256(bytes(vm.envOr("CHAIN", string("local")))) == keccak256("mainnet");
        c.signers = vm.envAddress("SIGNERS", ",");
        c.agent = vm.envAddress("AGENT");
        c.auditor = vm.envOr("AUDITOR", address(0));
        uint256 defaultThreshold = c.signers.length < 2 ? c.signers.length : 2;
        c.threshold = vm.envOr("THRESHOLD", defaultThreshold);
        c.perTxCap = vm.envOr("PER_TX_CAP", uint256(100_000e18));
        c.vendorMonthlyCap = vm.envOr("VENDOR_MONTHLY_CAP", uint256(300_000e18));
        c.configHash = vm.envOr("CONFIG_HASH", bytes32(0));
        c.token = vm.envOr("WARS_ADDRESS", address(0));
        c.suffix = vm.envOr("ATTRIBUTION_SUFFIX", bytes(""));
    }

    /// Checks the mainnet rules, then creates (token,) treasury and factory with the suffix.
    function deploy(Config memory c) public returns (Deployment memory d) {
        if (c.mainnet) {
            require(block.chainid == CELO_MAINNET, "Deploy: CHAIN=mainnet but the node is not Celo mainnet");
            require(c.suffix.length > 0, "Deploy: ATTRIBUTION_SUFFIX is required on mainnet");
            if (c.token == address(0)) c.token = MAINNET_WARS;
            require(c.token == MAINNET_WARS, "Deploy: mainnet must use the real wARS");
        }

        d.token = c.token;
        if (d.token == address(0)) {
            d.token = _create(type(MockWARS).creationCode, "", c.suffix);
            d.mockToken = true;
        }
        d.treasury = _create(
            type(TreasuryPolicy).creationCode,
            abi.encode(
                d.token, c.signers, c.threshold, c.agent, c.perTxCap, c.vendorMonthlyCap, c.configHash, c.auditor
            ),
            c.suffix
        );
        d.boxFactory = _create(type(BoxFactory).creationCode, abi.encode(d.treasury, d.token), c.suffix);
    }

    function _create(bytes memory creationCode, bytes memory args, bytes memory suffix) internal returns (address addr) {
        bytes memory initCode = bytes.concat(creationCode, args, suffix);
        assembly ("memory-safe") {
            addr := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(addr != address(0) && addr.code.length > 0, "Deploy: contract creation failed");
    }
}
