// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {CooperadoraFactory} from "../src/CooperadoraFactory.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {BoxFactory} from "../src/BoxFactory.sol";
import {MockWARS} from "../src/test/MockWARS.sol";

contract CooperadoraFactoryTest is Test {
    MockWARS internal wars;
    CooperadoraFactory internal factory;

    address internal agent = makeAddr("agent");
    address internal auditor = makeAddr("auditor");
    address internal s1 = makeAddr("s1");
    address internal s2 = makeAddr("s2");
    address internal s3 = makeAddr("s3");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant HASH_A = keccak256("acta-a");
    bytes32 internal constant HASH_B = keccak256("acta-b");

    function setUp() public {
        wars = new MockWARS();
        factory = new CooperadoraFactory(address(wars), agent, auditor);
    }

    function _signers() internal view returns (address[] memory signers) {
        signers = new address[](3);
        signers[0] = s1;
        signers[1] = s2;
        signers[2] = s3;
    }

    function test_Create_DeploysTreasuryAndBoxFactoryAndRecordsThem() public {
        vm.recordLogs();

        vm.prank(stranger);
        (uint256 id, address treasury, address boxes) = factory.create(_signers(), 2, 100e18, 300e18, HASH_A);

        assertEq(id, 1);
        assertEq(factory.count(), 1);
        assertEq(factory.idOf(treasury), 1);
        assertEq(factory.token(), address(wars));
        assertEq(factory.agent(), agent);
        assertEq(factory.auditor(), auditor);

        TreasuryPolicy policy = TreasuryPolicy(treasury);
        assertEq(policy.token(), address(wars));
        assertEq(policy.agent(), agent);
        assertEq(policy.auditor(), auditor);
        assertEq(policy.threshold(), 2);
        assertEq(policy.perTxCap(), 100e18);
        assertEq(policy.vendorMonthlyCap(), 300e18);
        assertEq(policy.configHash(), HASH_A);
        address[] memory signers = policy.signers();
        assertEq(signers.length, 3);
        assertEq(signers[0], s1);

        assertEq(BoxFactory(boxes).treasury(), treasury);
        assertEq(BoxFactory(boxes).token(), address(wars));
        assertTrue(treasury.code.length > 0);
        assertTrue(boxes.code.length > 0);

        (address t, address b, address creator, bytes32 hash, uint64 createdAt) = factory.cooperadora(1);
        assertEq(t, treasury);
        assertEq(b, boxes);
        assertEq(creator, stranger);
        assertEq(hash, HASH_A);
        assertEq(createdAt, uint64(block.timestamp));

        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(factory)) found = true;
        }
        assertTrue(found);
    }

    function test_Create_TwoCooperadorasAreIndependent() public {
        (, address aTreasury, address aBoxes) = factory.create(_signers(), 2, 1e18, 2e18, HASH_A);

        address[] memory other = new address[](1);
        other[0] = s1;
        (, address bTreasury, address bBoxes) = factory.create(other, 1, 5e18, 9e18, HASH_B);

        assertEq(factory.count(), 2);
        assertTrue(aTreasury != bTreasury);
        assertTrue(aBoxes != bBoxes);
        assertEq(factory.idOf(aTreasury), 1);
        assertEq(factory.idOf(bTreasury), 2);
        assertEq(TreasuryPolicy(aTreasury).threshold(), 2);
        assertEq(TreasuryPolicy(bTreasury).threshold(), 1);
        assertEq(TreasuryPolicy(bTreasury).agent(), agent);
        assertEq(TreasuryPolicy(bTreasury).auditor(), auditor);
        assertEq(BoxFactory(aBoxes).treasury(), aTreasury);
        assertEq(BoxFactory(bBoxes).treasury(), bTreasury);
    }

    function test_Create_WithoutAuditor() public {
        CooperadoraFactory open = new CooperadoraFactory(address(wars), agent, address(0));
        (, address treasury,) = open.create(_signers(), 2, 1, 1, HASH_A);
        assertEq(TreasuryPolicy(treasury).auditor(), address(0));
    }

    function test_Create_Revert_BadRoster() public {
        address[] memory signers = new address[](2);
        signers[0] = s1;
        signers[1] = s1;
        vm.expectRevert();
        factory.create(signers, 1, 1, 1, HASH_A);
    }

    function test_Create_Revert_AgentCannotBeSigner() public {
        address[] memory signers = new address[](1);
        signers[0] = agent;
        vm.expectRevert();
        factory.create(signers, 1, 1, 1, HASH_A);
    }

    function test_UnknownIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CooperadoraFactory.UnknownCooperadora.selector, uint256(1)));
        factory.cooperadora(1);
    }

    function test_Constructor_RejectsZeroTokenOrAgent() public {
        vm.expectRevert(CooperadoraFactory.InvalidToken.selector);
        new CooperadoraFactory(address(0), agent, auditor);
        vm.expectRevert(CooperadoraFactory.InvalidAgent.selector);
        new CooperadoraFactory(address(wars), address(0), auditor);
    }
}
