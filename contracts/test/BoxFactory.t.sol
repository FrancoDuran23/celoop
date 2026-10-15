// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Fixture} from "./utils/Fixture.sol";
import {BoxFactory} from "../src/BoxFactory.sol";
import {DepositBox} from "../src/DepositBox.sol";
import {MockWARS} from "../src/test/MockWARS.sol";
import {IBoxFactory, ITreasuryPolicy} from "../src/interfaces/ITreasuryPolicy.sol";

contract BoxFactoryTest is Fixture {
    bytes32 internal constant REF = keccak256("socio-7:2026-03");

    function test_Constructor() public {
        assertEq(factory.treasury(), address(treasury));
        assertEq(factory.token(), address(wars));

        MockWARS other = new MockWARS();
        vm.expectRevert(abi.encodeWithSelector(BoxFactory.TokenMismatch.selector, address(wars), address(other)));
        new BoxFactory(address(treasury), address(other));

        vm.expectRevert(BoxFactory.InvalidTreasury.selector);
        new BoxFactory(address(0), address(wars));
    }

    function test_BoxAddress_IsDeterministicAndPerRef() public {
        address box = factory.boxAddress(REF);
        assertEq(box.code.length, 0, "not deployed yet");
        assertEq(factory.boxAddress(REF), box);
        assertTrue(factory.boxAddress(keccak256("other")) != box);

        factory.sweep(REF);
        assertGt(box.code.length, 0, "deployed at the predicted address");
        assertEq(DepositBox(box).ref(), REF);
        assertEq(address(DepositBox(box).treasury()), address(treasury));
    }

    function test_Sweep_ContributesWholeBalanceWithRef() public {
        address box = factory.boxAddress(REF);
        wars.mint(box, 12_500e18);

        vm.expectEmit(address(factory));
        emit IBoxFactory.BoxSwept(REF, box, 12_500e18);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.Contribution(REF, box, 12_500e18);
        vm.prank(stranger); // anyone may sweep
        uint256 amount = factory.sweep(REF);

        assertEq(amount, 12_500e18);
        assertEq(wars.balanceOf(box), 0);
        assertEq(wars.balanceOf(address(treasury)), INITIAL_FUNDS + 12_500e18);
        assertEq(wars.allowance(box, address(treasury)), 0);
    }

    function test_Sweep_ZeroBalanceReturnsZero() public {
        vm.recordLogs();
        uint256 amount = factory.sweep(REF);
        assertEq(amount, 0);
        assertEq(vm.getRecordedLogs().length, 0, "no BoxSwept, no Contribution");
        assertGt(factory.boxAddress(REF).code.length, 0, "box still deployed");
        assertEq(wars.balanceOf(address(treasury)), INITIAL_FUNDS);

        // Already deployed and still empty.
        assertEq(factory.sweep(REF), 0);
    }

    function test_Sweep_Twice() public {
        address box = factory.boxAddress(REF);
        wars.mint(box, 10e18);
        assertEq(factory.sweep(REF), 10e18);

        // Second sweep of an empty, deployed box is a no-op.
        assertEq(factory.sweep(REF), 0);

        // A late deposit to the same box is swept again with the same ref.
        wars.mint(box, 3e18);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.Contribution(REF, box, 3e18);
        assertEq(factory.sweep(REF), 3e18);
        assertEq(wars.balanceOf(address(treasury)), INITIAL_FUNDS + 13e18);
    }

    function test_Box_OnlyFactoryCanSweep() public {
        address box = factory.boxAddress(REF);
        factory.sweep(REF);
        wars.mint(box, 5e18);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DepositBox.OnlyFactory.selector, stranger));
        DepositBox(box).sweep();
        assertEq(wars.balanceOf(box), 5e18);
    }

    function test_Implementation_CannotBeSwept() public {
        DepositBox impl = DepositBox(factory.implementation());
        vm.prank(address(factory));
        vm.expectRevert(DepositBox.NotAClone.selector);
        impl.sweep();
        vm.expectRevert(DepositBox.NotAClone.selector);
        impl.ref();
    }

    function testFuzz_Sweep_OnlyReachesTreasury(bytes32 ref, uint128 amount) public {
        address box = factory.boxAddress(ref);
        wars.mint(box, amount);
        uint256 before = wars.balanceOf(address(treasury));
        assertEq(factory.sweep(ref), amount);
        assertEq(wars.balanceOf(address(treasury)), before + amount);
        assertEq(wars.balanceOf(box), 0);
    }
}
