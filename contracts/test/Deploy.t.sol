// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {BoxFactory} from "../src/BoxFactory.sol";
import {CooperadoraFactory} from "../src/CooperadoraFactory.sol";
import {MockWARS} from "../src/test/MockWARS.sol";

contract DeployTest is Test {
    // toDataSuffix("cooperadora_dev"), from the attribution-tags package.
    bytes constant SUFFIX = hex"636f6f70657261646f72615f6465760f0080218021802180218021802180218021";

    address a = makeAddr("a");
    address b = makeAddr("b");
    address c = makeAddr("c");
    address agent = makeAddr("agent");
    address auditor = makeAddr("auditor");
    Deploy script;

    function setUp() public {
        script = new Deploy();
    }

    function _config(bool mainnet, address token, bytes memory suffix) internal view returns (Deploy.Config memory cfg) {
        address[] memory signers = new address[](3);
        signers[0] = a;
        signers[1] = b;
        signers[2] = c;
        cfg = Deploy.Config({
            mainnet: mainnet,
            token: token,
            signers: signers,
            threshold: 2,
            agent: agent,
            auditor: auditor,
            perTxCap: 50_000e18,
            vendorMonthlyCap: 150_000e18,
            configHash: keccak256("acta"),
            suffix: suffix
        });
    }

    function _assertDeployment(Deploy.Deployment memory d) internal view {
        TreasuryPolicy t = TreasuryPolicy(d.treasury);
        assertEq(t.token(), d.token);
        assertEq(t.agent(), agent);
        assertEq(t.auditor(), auditor);
        assertEq(t.threshold(), 2);
        address[] memory s = t.signers();
        assertEq(s.length, 3);
        assertEq(s[0], a);
        assertEq(s[2], c);
        assertEq(t.perTxCap(), 50_000e18);
        assertEq(t.vendorMonthlyCap(), 150_000e18);
        assertEq(t.configHash(), keccak256("acta"));
        assertEq(BoxFactory(d.boxFactory).treasury(), d.treasury);
        assertEq(BoxFactory(d.boxFactory).token(), d.token);
        CooperadoraFactory created = CooperadoraFactory(d.factory);
        assertEq(created.token(), d.token);
        assertEq(created.agent(), agent);
        assertEq(created.auditor(), auditor);
        assertEq(created.count(), 1);
        assertEq(d.onchainId, 1);
        assertEq(created.idOf(d.treasury), 1);
    }

    function test_Local_DeploysMockAndDecodesArgsDespiteTheSuffix() public {
        Deploy.Deployment memory d = script.deploy(_config(false, address(0), SUFFIX));
        assertTrue(d.mockToken);
        _assertDeployment(d);
        MockWARS(d.token).mint(address(this), 1e18);
        assertEq(MockWARS(d.token).balanceOf(address(this)), 1e18);
    }

    function test_Local_WithoutSuffix() public {
        _assertDeployment(script.deploy(_config(false, address(0), "")));
    }

    function test_Local_UsesGivenToken() public {
        MockWARS token = new MockWARS();
        Deploy.Deployment memory d = script.deploy(_config(false, address(token), SUFFIX));
        assertFalse(d.mockToken);
        assertEq(d.token, address(token));
        _assertDeployment(d);
    }

    function test_Mainnet_UsesRealWars() public {
        vm.chainId(42220);
        Deploy.Deployment memory d = script.deploy(_config(true, address(0), SUFFIX));
        assertFalse(d.mockToken);
        assertEq(d.token, script.MAINNET_WARS());
        _assertDeployment(d);
    }

    function test_Mainnet_RequiresSuffix() public {
        vm.chainId(42220);
        Deploy.Config memory cfg = _config(true, address(0), "");
        vm.expectRevert(bytes("Deploy: ATTRIBUTION_SUFFIX is required on mainnet"));
        script.deploy(cfg);
    }

    function test_Mainnet_RefusesOtherChain() public {
        Deploy.Config memory cfg = _config(true, address(0), SUFFIX);
        vm.expectRevert(bytes("Deploy: CHAIN=mainnet but the node is not Celo mainnet"));
        script.deploy(cfg);
    }

    function test_Mainnet_RefusesOtherToken() public {
        vm.chainId(42220);
        Deploy.Config memory cfg = _config(true, makeAddr("fake"), SUFFIX);
        vm.expectRevert(bytes("Deploy: mainnet must use the real wARS"));
        script.deploy(cfg);
    }

    /// Same values as DeployLocal.t.sol for the variables both read: tests share the process env.
    function test_ConfigFromEnv() public {
        vm.setEnv("SIGNERS", string.concat(vm.toString(a), ",", vm.toString(b), ",", vm.toString(c)));
        vm.setEnv("AGENT", vm.toString(agent));
        vm.setEnv("AUDITOR", vm.toString(auditor));
        vm.setEnv("THRESHOLD", "2");
        vm.setEnv("PER_TX_CAP", "50000000000000000000000");
        vm.setEnv("ATTRIBUTION_SUFFIX", vm.toString(SUFFIX));
        Deploy.Config memory cfg = script.configFromEnv();
        assertEq(cfg.signers.length, 3);
        assertEq(cfg.agent, agent);
        assertEq(cfg.auditor, auditor);
        assertEq(cfg.threshold, 2);
        assertEq(cfg.perTxCap, 50_000e18);
        assertEq(cfg.suffix, SUFFIX);
        assertEq(cfg.token, address(0));
    }
}
