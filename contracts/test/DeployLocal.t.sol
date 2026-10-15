// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {DeployLocal} from "../script/DeployLocal.s.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {BoxFactory} from "../src/BoxFactory.sol";

contract DeployLocalTest is Test {
    function test_DeployLocal_FromEnv() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");
        address agent = makeAddr("agent");
        vm.setEnv("SIGNERS", string.concat(vm.toString(a), ",", vm.toString(b), ",", vm.toString(c)));
        vm.setEnv("AGENT", vm.toString(agent));
        vm.setEnv("THRESHOLD", "2");
        vm.setEnv("PER_TX_CAP", "50000000000000000000000");

        DeployLocal.Deployment memory d = new DeployLocal().run();
        TreasuryPolicy t = TreasuryPolicy(d.treasury);
        assertEq(t.token(), d.token);
        assertEq(t.agent(), agent);
        assertEq(t.threshold(), 2);
        assertEq(t.signers().length, 3);
        assertTrue(t.isSigner(a) && t.isSigner(b) && t.isSigner(c));
        assertEq(t.perTxCap(), 50_000e18);
        assertEq(t.vendorMonthlyCap(), 300_000e18);
        assertEq(BoxFactory(d.boxFactory).treasury(), d.treasury);
        assertEq(BoxFactory(d.boxFactory).token(), d.token);
    }
}
