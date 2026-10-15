// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {ITreasuryPolicy} from "../src/interfaces/ITreasuryPolicy.sol";
import {ReentrantToken} from "./utils/HostileTokens.sol";

/// A malicious token that is also a signer tries to re-enter the treasury while it is paying.
contract ReentrancyTest is Test {
    ReentrantToken internal evil;
    TreasuryPolicy internal treasury;

    address internal s1 = makeAddr("signer1");
    address internal agent = makeAddr("agent");
    address internal vendor = makeAddr("vendor");
    bytes32 internal constant LINE = keccak256("line");
    uint64 internal constant CUIT = 20_111_111_112;

    function setUp() public {
        evil = new ReentrantToken();
        address[] memory signers = new address[](2);
        signers[0] = s1;
        signers[1] = address(evil); // worst case: the token itself can vote
        treasury = new TreasuryPolicy(address(evil), signers, 2, agent, 100e18, 1_000e18, bytes32(0), address(0));

        _pass(ITreasuryPolicy.ProposalKind.SetBudget, abi.encode(LINE, 1_000e18, uint64(block.timestamp + 1 days)));
        _pass(ITreasuryPolicy.ProposalKind.SetVendor, abi.encode(vendor, CUIT, true));
        evil.mint(address(treasury), 500e18);
    }

    function test_Reentrancy_DuringSignerExecution_IsBlocked() public {
        uint256 id = _proposeEscalated(1, 200e18);
        uint256 id2 = _proposeEscalated(2, 200e18);

        // id2 gets one vote from s1; the token will try to add the second vote mid-transfer.
        vm.prank(s1);
        treasury.approve(id2);
        evil.arm(address(treasury), abi.encodeCall(treasury.approve, (id2)));

        vm.prank(s1);
        treasury.approve(id);
        vm.prank(address(evil));
        treasury.approve(id); // executes, transfer triggers the reentrant call

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(evil.balanceOf(vendor), 200e18, "paid exactly once");
        assertEq(uint8(treasury.payment(id2).status), uint8(ITreasuryPolicy.PaymentStatus.Pending));
        assertFalse(treasury.hasApproved(id2, address(evil)));
    }

    function test_Reentrancy_ExecuteSamePaymentTwice_IsBlocked() public {
        uint256 id = _proposeEscalated(1, 200e18);
        vm.prank(s1);
        treasury.approve(id);
        evil.arm(address(treasury), abi.encodeCall(treasury.executePayment, (id)));
        vm.prank(address(evil));
        treasury.approve(id);

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(evil.balanceOf(vendor), 200e18);
        assertEq(evil.balanceOf(address(treasury)), 300e18);
    }

    function test_Reentrancy_DuringContribute_IsBlocked() public {
        // Mid-contribution the token tries to open a proposal.
        evil.mint(address(this), 10e18);
        evil.approve(address(treasury), 10e18);
        evil.arm(
            address(treasury),
            abi.encodeCall(treasury.propose, (ITreasuryPolicy.ProposalKind.SetConfigHash, abi.encode(bytes32("x"))))
        );
        treasury.contribute(10e18, bytes32("ref"));

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(treasury.proposalCount(), 2);
    }

    function _proposeEscalated(uint64 nro, uint256 amount) internal returns (uint256 id) {
        ITreasuryPolicy.Invoice memory inv = ITreasuryPolicy.Invoice({cuit: CUIT, tipo: 11, ptoVta: 1, nro: nro});
        vm.prank(agent);
        bool executed;
        (id, executed) = treasury.proposePayment(vendor, inv, amount, LINE, bytes32(0));
        assertFalse(executed);
    }

    function _pass(ITreasuryPolicy.ProposalKind kind, bytes memory data) internal {
        vm.prank(s1);
        uint256 id = treasury.propose(kind, data);
        vm.prank(address(evil));
        treasury.approveProposal(id);
    }
}
