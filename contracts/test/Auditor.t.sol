// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Fixture} from "./utils/Fixture.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {ITreasuryPolicy} from "../src/interfaces/ITreasuryPolicy.sol";

/// @notice The auditor role (docs/specs/08-auditor.md): with an auditor, automatic payments wait
/// for its clearance; it can hold a payment back but never move money on its own.
contract AuditorTest is Fixture {
    ITreasuryPolicy.ProposalKind internal constant SET_AUDITOR = ITreasuryPolicy.ProposalKind.SetAuditor;
    bytes32 internal constant REPORT = keccak256("informe-de-auditoria");

    function _auditorAtDeploy() internal view override returns (address) {
        return auditorAddr;
    }

    function _audit(uint256 id, bool cleared) internal returns (bool executed) {
        vm.prank(auditorAddr);
        executed = treasury.auditPayment(id, cleared, REPORT);
    }

    function _approveBoth(uint256 id) internal {
        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s2);
        treasury.approve(id);
    }

    // =====================================================================
    // Deployment
    // =====================================================================

    function test_Constructor_SetsAuditor() public view {
        assertEq(treasury.auditor(), auditorAddr);
        assertFalse(treasury.isSigner(auditorAddr));
    }

    function test_Constructor_RejectsAuditorThatIsAgentSignerOrToken() public {
        address[] memory signers = new address[](2);
        signers[0] = s1;
        signers[1] = s2;
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AuditorConflict.selector, agent));
        new TreasuryPolicy(address(wars), signers, 1, agent, 1, 1, 0, agent);

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AuditorConflict.selector, s1));
        new TreasuryPolicy(address(wars), signers, 1, agent, 1, 1, 0, s1);

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidAuditor.selector, address(wars)));
        new TreasuryPolicy(address(wars), signers, 1, agent, 1, 1, 0, address(wars));
    }

    // =====================================================================
    // Two keys for an automatic payment
    // =====================================================================

    function test_Propose_WaitsForTheAuditorEvenWithinLimits() public {
        (uint256 id, bool executed,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        assertFalse(executed);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Pending));
        assertEq(wars.balanceOf(v1), 0);
        (ITreasuryPolicy.AuditStatus audit,) = treasury.paymentAudit(id);
        assertEq(uint8(audit), uint8(ITreasuryPolicy.AuditStatus.None));
    }

    function test_Cleared_WithinLimits_PaysAutomatically() public {
        (uint256 id,, ITreasuryPolicy.Invoice memory inv) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentAudited(id, auditorAddr, true, REPORT);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentExecuted(
            id,
            v1,
            LINE_SUPPLIES,
            10e18,
            treasury.invoiceIdOf(inv),
            keccak256(abi.encode(inv)),
            ITreasuryPolicy.Rule.Auto,
            false,
            false
        );
        assertTrue(_audit(id, true));

        assertEq(wars.balanceOf(v1), 10e18);
        assertEq(treasury.vendorSpentThisPeriod(v1), 10e18);
        (ITreasuryPolicy.AuditStatus audit, bytes32 hash) = treasury.paymentAudit(id);
        assertEq(uint8(audit), uint8(ITreasuryPolicy.AuditStatus.Cleared));
        assertEq(hash, REPORT);
    }

    function test_Cleared_OverTheCap_StillNeedsSigners() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, PER_TX_CAP + 1, LINE_SUPPLIES);
        assertFalse(_audit(id, true));
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Pending));

        _approveBoth(id);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Executed));
        assertEq(wars.balanceOf(v1), PER_TX_CAP + 1);
    }

    function test_Flagged_SmallPayment_GoesToSigners() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        assertFalse(_audit(id, false));
        (ITreasuryPolicy.AuditStatus audit,) = treasury.paymentAudit(id);
        assertEq(uint8(audit), uint8(ITreasuryPolicy.AuditStatus.Flagged));
        assertEq(wars.balanceOf(v1), 0);

        vm.prank(s1);
        treasury.approve(id);
        assertEq(wars.balanceOf(v1), 0);
        vm.prank(s2);
        treasury.approve(id);
        assertEq(wars.balanceOf(v1), 10e18);
        // Paid by signers: it does not count against the vendor's automatic cap.
        assertEq(treasury.vendorSpentThisPeriod(v1), 0);
    }

    function test_Flagged_SignersCanReject() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        _audit(id, false);
        vm.prank(s3);
        treasury.reject(id);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Rejected));
    }

    function test_SignersCanPayBeforeTheAudit() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        _approveBoth(id);
        assertEq(wars.balanceOf(v1), 10e18);
        vm.prank(auditorAddr);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.PaymentNotPending.selector, id));
        treasury.auditPayment(id, true, REPORT);
    }

    function test_Cleared_RechecksLimitsAtAuditTime() public {
        // Two payments that fit one by one but not together in the line (OPS has 50).
        (uint256 a,,) = _proposeAs(v1, CUIT_V1, 30e18, LINE_OPS);
        (uint256 b,,) = _proposeAs(v2, CUIT_V2, 30e18, LINE_OPS);
        assertTrue(_audit(a, true));
        assertFalse(_audit(b, true));
        assertEq(uint8(_status(b)), uint8(ITreasuryPolicy.PaymentStatus.Pending));
    }

    // =====================================================================
    // What the auditor cannot do
    // =====================================================================

    function test_OnlyTheAuditorAudits() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        address[3] memory others = [agent, s1, stranger];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotAuditor.selector, others[i]));
            treasury.auditPayment(id, true, REPORT);
        }
    }

    function test_AuditorCannotSignProposeOrPause() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, PER_TX_CAP + 1, LINE_SUPPLIES);
        vm.startPrank(auditorAddr);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, auditorAddr));
        treasury.approve(id);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, auditorAddr));
        treasury.reject(id);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, auditorAddr));
        treasury.pause();
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotAgent.selector, auditorAddr));
        treasury.proposePayment(v1, _invoice(CUIT_V1), 1e18, LINE_SUPPLIES, bytes32(0));
        vm.stopPrank();
    }

    function test_AuditOncePerPayment() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, PER_TX_CAP + 1, LINE_SUPPLIES);
        _audit(id, false);
        vm.prank(auditorAddr);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AlreadyAudited.selector, id));
        treasury.auditPayment(id, true, REPORT);
    }

    function test_AuditNeedsAReportAndAPendingPayment() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        vm.startPrank(auditorAddr);
        vm.expectRevert(TreasuryPolicy.MissingReport.selector);
        treasury.auditPayment(id, true, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.PaymentNotPending.selector, 99));
        treasury.auditPayment(99, true, REPORT);
        vm.stopPrank();
    }

    function test_NoAuditWhilePaused() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        vm.prank(s1);
        treasury.pause();
        vm.prank(auditorAddr);
        vm.expectRevert(TreasuryPolicy.ContractPaused.selector);
        treasury.auditPayment(id, true, REPORT);
    }

    function test_AuditorAsVendorIsNeverPaidAutomatically() public {
        _pass(ITreasuryPolicy.ProposalKind.SetVendor, abi.encode(auditorAddr, CUIT_AGENT, true));
        (uint256 id,,) = _proposeAs(auditorAddr, CUIT_AGENT, 1e18, LINE_OPS);
        assertFalse(_audit(id, true));
        assertEq(wars.balanceOf(auditorAddr), 0);
    }

    // =====================================================================
    // Rotation
    // =====================================================================

    function test_SetAuditor_Rotates() public {
        address next = makeAddr("auditor2");
        vm.prank(s1);
        uint256 proposalId = treasury.propose(SET_AUDITOR, abi.encode(next));
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.AuditorSet(next);
        vm.prank(s2);
        treasury.approveProposal(proposalId);
        assertEq(treasury.auditor(), next);

        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        vm.prank(auditorAddr);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotAuditor.selector, auditorAddr));
        treasury.auditPayment(id, true, REPORT);
        vm.prank(next);
        assertTrue(treasury.auditPayment(id, true, REPORT));
    }

    function test_SetAuditor_ZeroTurnsItOff() public {
        _pass(SET_AUDITOR, abi.encode(address(0)));
        assertEq(treasury.auditor(), address(0));
        (, bool executed,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        assertTrue(executed);
    }

    function test_SetAuditor_RefusesSignersAndTheAgent() public {
        vm.startPrank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AuditorConflict.selector, s2));
        treasury.propose(SET_AUDITOR, abi.encode(s2));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AuditorConflict.selector, agent));
        treasury.propose(SET_AUDITOR, abi.encode(agent));
        vm.stopPrank();
    }

    function test_SignersAndAgentCannotBecomeTheAuditor() public {
        address[] memory withAuditor = new address[](2);
        withAuditor[0] = s1;
        withAuditor[1] = auditorAddr;
        vm.startPrank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AuditorConflict.selector, auditorAddr));
        treasury.propose(ITreasuryPolicy.ProposalKind.SetSigners, abi.encode(withAuditor, 2));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AuditorConflict.selector, auditorAddr));
        treasury.propose(ITreasuryPolicy.ProposalKind.SetAgent, abi.encode(auditorAddr));
        vm.stopPrank();
    }
}

/// Without an auditor nothing changes: automatic payments go out on proposal.
contract NoAuditorTest is Fixture {
    function test_NobodyCanAudit() public {
        (uint256 id, bool executed,) = _proposeAs(v1, CUIT_V1, PER_TX_CAP + 1, LINE_SUPPLIES);
        assertFalse(executed);
        assertEq(treasury.auditor(), address(0));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotAuditor.selector, stranger));
        treasury.auditPayment(id, true, keccak256("x"));
    }

    function test_SmallPaymentStillGoesOutOnProposal() public {
        (, bool executed,) = _proposeAs(v1, CUIT_V1, 10e18, LINE_SUPPLIES);
        assertTrue(executed);
    }
}
