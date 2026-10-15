// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Fixture} from "./utils/Fixture.sol";
import {FeeOnTransferToken} from "./utils/HostileTokens.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";
import {ITreasuryPolicy} from "../src/interfaces/ITreasuryPolicy.sol";

contract TreasuryPolicyTest is Fixture {
    ITreasuryPolicy.ProposalKind internal constant SET_BUDGET = ITreasuryPolicy.ProposalKind.SetBudget;
    ITreasuryPolicy.ProposalKind internal constant MOVE_BUDGET = ITreasuryPolicy.ProposalKind.MoveBudget;
    ITreasuryPolicy.ProposalKind internal constant SET_VENDOR = ITreasuryPolicy.ProposalKind.SetVendor;
    ITreasuryPolicy.ProposalKind internal constant SET_CAPS = ITreasuryPolicy.ProposalKind.SetCaps;
    ITreasuryPolicy.ProposalKind internal constant SET_SIGNERS = ITreasuryPolicy.ProposalKind.SetSigners;
    ITreasuryPolicy.ProposalKind internal constant SET_AGENT = ITreasuryPolicy.ProposalKind.SetAgent;
    ITreasuryPolicy.ProposalKind internal constant SET_CONFIG = ITreasuryPolicy.ProposalKind.SetConfigHash;
    ITreasuryPolicy.ProposalKind internal constant UNPAUSE = ITreasuryPolicy.ProposalKind.Unpause;

    // =====================================================================
    // Constructor
    // =====================================================================

    function test_Constructor_SetsState() public view {
        assertEq(treasury.token(), address(wars));
        assertEq(treasury.agent(), agent);
        assertEq(treasury.threshold(), 2);
        assertEq(treasury.signers().length, 3);
        assertTrue(treasury.isSigner(s1) && treasury.isSigner(s2) && treasury.isSigner(s3));
        assertFalse(treasury.isSigner(agent));
        assertEq(treasury.perTxCap(), PER_TX_CAP);
        assertEq(treasury.vendorMonthlyCap(), VENDOR_MONTHLY_CAP);
        assertEq(treasury.configHash(), CONFIG_HASH);
        assertFalse(treasury.paused());
        assertEq(treasury.budgetLines().length, 3);
    }

    function test_Constructor_RejectsBadThreshold() public {
        address[] memory s = _addrs(s1, s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidThreshold.selector, 0, 2));
        new TreasuryPolicy(address(wars), s, 0, agent, 1, 1, 0, address(0));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidThreshold.selector, 3, 2));
        new TreasuryPolicy(address(wars), s, 3, agent, 1, 1, 0, address(0));
    }

    function test_Constructor_RejectsDuplicateZeroAndAgentSigners() public {
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.DuplicateSigner.selector, s1));
        new TreasuryPolicy(address(wars), _addrs(s1, s1), 1, agent, 1, 1, 0, address(0));

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidSigner.selector, address(0)));
        new TreasuryPolicy(address(wars), _addrs(s1, address(0)), 1, agent, 1, 1, 0, address(0));

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AgentIsSigner.selector, agent));
        new TreasuryPolicy(address(wars), _addrs(s1, agent), 1, agent, 1, 1, 0, address(0));

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidAgent.selector, address(0)));
        new TreasuryPolicy(address(wars), _addrs(s1, s2), 1, address(0), 1, 1, 0, address(0));

        vm.expectRevert(TreasuryPolicy.InvalidToken.selector);
        new TreasuryPolicy(address(0), _addrs(s1, s2), 1, agent, 1, 1, 0, address(0));
    }

    // =====================================================================
    // Contributions
    // =====================================================================

    function test_Contribute_PullsFundsAndEmits() public {
        bytes32 ref = keccak256("socio-42");
        wars.mint(stranger, 10e18);
        vm.startPrank(stranger);
        wars.approve(address(treasury), 10e18);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.Contribution(ref, stranger, 10e18);
        treasury.contribute(10e18, ref);
        vm.stopPrank();
        assertEq(wars.balanceOf(address(treasury)), INITIAL_FUNDS + 10e18);
    }

    function test_Contribute_RejectsZeroAndMissingAllowance() public {
        vm.expectRevert(TreasuryPolicy.ZeroAmount.selector);
        treasury.contribute(0, bytes32(0));

        wars.mint(stranger, 1e18);
        vm.prank(stranger);
        vm.expectRevert(); // ERC20InsufficientAllowance
        treasury.contribute(1e18, bytes32(0));
    }

    function test_Contribute_RejectsShortTransfer() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        TreasuryPolicy t = _deployTreasury(address(fot));
        fot.mint(stranger, 100e18);
        vm.startPrank(stranger);
        fot.approve(address(t), 100e18);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.ContributionMismatch.selector, 100e18, 99e18));
        t.contribute(100e18, bytes32(0));
        vm.stopPrank();
    }

    // =====================================================================
    // Automatic payments
    // =====================================================================

    function test_AutoPayment_ExecutesImmediately() public {
        ITreasuryPolicy.Invoice memory inv = _invoice(CUIT_V1);
        bytes32 invoiceId = treasury.invoiceIdOf(inv);
        bytes32 fileHash = keccak256("factura.pdf");
        assertEq(invoiceId, keccak256(abi.encode(inv.cuit, inv.tipo, inv.ptoVta, inv.nro)));

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentProposed(1, v1, LINE_SUPPLIES, 60e18, invoiceId, fileHash);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentExecuted(
            1, v1, LINE_SUPPLIES, 60e18, invoiceId, fileHash, ITreasuryPolicy.Rule.Auto, false, false
        );
        vm.prank(agent);
        (uint256 id, bool executed) = treasury.proposePayment(v1, inv, 60e18, LINE_SUPPLIES, fileHash);

        assertEq(id, 1);
        assertTrue(executed);
        assertEq(treasury.paymentCount(), 1);
        assertEq(wars.balanceOf(v1), 60e18);
        assertEq(wars.balanceOf(address(treasury)), INITIAL_FUNDS - 60e18);
        assertTrue(treasury.invoicePaid(invoiceId));
        assertEq(treasury.budget(LINE_SUPPLIES).spent, 60e18);
        assertEq(treasury.vendorSpentThisPeriod(v1), 60e18);

        ITreasuryPolicy.Payment memory p = treasury.payment(id);
        assertEq(uint8(p.status), uint8(ITreasuryPolicy.PaymentStatus.Executed));
        assertEq(p.vendor, v1);
        assertEq(p.amount, 60e18);
        assertEq(p.lineId, LINE_SUPPLIES);
        assertEq(p.invoiceId, invoiceId);
        assertEq(p.fileHash, fileHash);
    }

    function test_AutoPayment_EscalatesOverPerTxCap() public {
        (uint256 id, bool executed,) = _proposeAs(v1, CUIT_V1, PER_TX_CAP + 1, LINE_SUPPLIES);
        assertFalse(executed);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Pending));
        assertEq(wars.balanceOf(v1), 0);
    }

    function test_AutoPayment_EscalatesOverBudgetLine() public {
        // LINE_OPS has 50 allocated.
        (, bool executed,) = _proposeAs(v1, CUIT_V1, 51e18, LINE_OPS);
        assertFalse(executed);
        (, executed,) = _proposeAs(v1, CUIT_V1, 50e18, LINE_OPS);
        assertTrue(executed);
    }

    function test_AutoPayment_EscalatesOverVendorPeriodCap_AndResetsNextPeriod() public {
        (, bool e1,) = _proposeAs(v1, CUIT_V1, 100e18, LINE_SUPPLIES);
        (, bool e2,) = _proposeAs(v1, CUIT_V1, 100e18, LINE_SUPPLIES);
        (, bool e3,) = _proposeAs(v1, CUIT_V1, 51e18, LINE_SUPPLIES); // 251 > 250
        assertTrue(e1 && e2);
        assertFalse(e3);
        // Another vendor is unaffected.
        (, bool other,) = _proposeAs(v2, CUIT_V2, 100e18, LINE_REPAIRS);
        assertTrue(other);

        // Next 30-day bucket starts from zero.
        vm.warp((block.timestamp / 30 days + 1) * 30 days);
        assertEq(treasury.vendorSpentThisPeriod(v1), 0);
        (, bool e4,) = _proposeAs(v1, CUIT_V1, 51e18, LINE_SUPPLIES);
        assertTrue(e4);
    }

    function test_AutoPayment_EscalatesWhenBalanceIsShort() public {
        TreasuryPolicy poor = _deployTreasury(address(wars));
        vm.prank(s1);
        uint256 pid = poor.propose(SET_BUDGET, abi.encode(LINE_SUPPLIES, 500e18, _in(1 days)));
        vm.prank(s2);
        poor.approveProposal(pid);
        vm.prank(s1);
        pid = poor.propose(SET_VENDOR, abi.encode(v1, CUIT_V1, true));
        vm.prank(s2);
        poor.approveProposal(pid);
        wars.mint(address(poor), 10e18); // direct transfer

        ITreasuryPolicy.Invoice memory inv = _invoice(CUIT_V1);
        vm.prank(agent);
        (uint256 id, bool executed) = poor.proposePayment(v1, inv, 20e18, LINE_SUPPLIES, bytes32(0));
        assertFalse(executed);

        // Reaching the threshold without balance reverts and keeps the payment pending.
        vm.prank(s1);
        poor.approve(id);
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InsufficientBalance.selector, 10e18, 20e18));
        poor.approve(id);

        wars.mint(address(poor), 10e18);
        vm.prank(s2);
        poor.approve(id);
        assertEq(wars.balanceOf(v1), 20e18);
    }

    // =====================================================================
    // proposePayment guards
    // =====================================================================

    function test_ProposePayment_OnlyAgent() public {
        ITreasuryPolicy.Invoice memory inv = _invoice(CUIT_V1);
        address[3] memory others = [s1, stranger, v1];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotAgent.selector, others[i]));
            treasury.proposePayment(v1, inv, 1e18, LINE_SUPPLIES, bytes32(0));
        }
    }

    function test_ProposePayment_Guards() public {
        ITreasuryPolicy.Invoice memory inv = _invoice(CUIT_V1);
        vm.startPrank(agent);

        vm.expectRevert(TreasuryPolicy.ZeroAmount.selector);
        treasury.proposePayment(v1, inv, 0, LINE_SUPPLIES, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.VendorNotEnabled.selector, stranger));
        treasury.proposePayment(stranger, inv, 1e18, LINE_SUPPLIES, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.CuitMismatch.selector, CUIT_V1, CUIT_V2));
        treasury.proposePayment(v2, inv, 1e18, LINE_SUPPLIES, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.UnknownBudgetLine.selector, keccak256("nope")));
        treasury.proposePayment(v1, inv, 1e18, keccak256("nope"), bytes32(0));

        // Pending duplicate.
        treasury.proposePayment(v1, inv, 200e18, LINE_SUPPLIES, bytes32(0));
        bytes32 invoiceId = treasury.invoiceIdOf(inv);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvoiceAlreadyPending.selector, invoiceId));
        treasury.proposePayment(v1, inv, 1e18, LINE_SUPPLIES, bytes32(0));

        // Paid duplicate.
        ITreasuryPolicy.Invoice memory inv2 = _invoice(CUIT_V1);
        treasury.proposePayment(v1, inv2, 1e18, LINE_SUPPLIES, bytes32(0));
        bytes32 invoiceId2 = treasury.invoiceIdOf(inv2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvoiceAlreadyPaid.selector, invoiceId2));
        treasury.proposePayment(v1, inv2, 1e18, LINE_SUPPLIES, bytes32(0));
        vm.stopPrank();
    }

    // =====================================================================
    // Escalated payments
    // =====================================================================

    function test_EscalatedPayment_ApprovedTwoOfThree() public {
        (uint256 id, bool executed, ITreasuryPolicy.Invoice memory inv) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);
        assertFalse(executed);
        bytes32 invoiceId = treasury.invoiceIdOf(inv);

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentApproved(id, s1, 1);
        vm.prank(s1);
        treasury.approve(id);
        assertEq(wars.balanceOf(v1), 0);
        assertTrue(treasury.hasApproved(id, s1));
        assertEq(treasury.payment(id).approvals, 1);

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentApproved(id, s3, 2);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentExecuted(
            id,
            v1,
            LINE_SUPPLIES,
            150e18,
            invoiceId,
            keccak256(abi.encode(inv)),
            ITreasuryPolicy.Rule.Signers,
            false,
            false
        );
        vm.prank(s3);
        treasury.approve(id);

        assertEq(wars.balanceOf(v1), 150e18);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Executed));
        // Signer-approved payments do not count toward the automatic vendor cap.
        assertEq(treasury.vendorSpentThisPeriod(v1), 0);

        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.PaymentNotPending.selector, id));
        treasury.approve(id);
    }

    function test_EscalatedPayment_RevalidatesVendorAtExecution() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);
        _pass(SET_VENDOR, abi.encode(v1, CUIT_V1, false));

        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.VendorNotEnabled.selector, v1));
        treasury.approve(id);

        // Re-enabled with a different CUIT: the invoice no longer matches.
        _pass(SET_VENDOR, abi.encode(v1, CUIT_V2, true));
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.CuitMismatch.selector, CUIT_V1, CUIT_V2));
        treasury.approve(id);
        assertEq(wars.balanceOf(v1), 0);
    }

    function test_Reject() public {
        (uint256 id,, ITreasuryPolicy.Invoice memory inv) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, agent));
        treasury.reject(id);

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentRejected(id, s2);
        vm.prank(s2);
        treasury.reject(id);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Rejected));

        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.PaymentNotPending.selector, id));
        treasury.approve(id);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.PaymentNotPending.selector, id));
        treasury.reject(id);

        // A rejected invoice can be proposed again (e.g. with the right amount).
        vm.prank(agent);
        (uint256 id2, bool executed) = treasury.proposePayment(v1, inv, 90e18, LINE_SUPPLIES, bytes32(0));
        assertTrue(executed);
        assertEq(id2, id + 1);
    }

    function test_DuplicateVotes_Revert() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);
        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AlreadyApproved.selector, s1));
        treasury.approve(id);
        assertEq(treasury.payment(id).approvals, 1);

        vm.prank(s1);
        uint256 pid = treasury.propose(SET_CONFIG, abi.encode(keccak256("acta-2")));
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AlreadyApproved.selector, s1));
        treasury.approveProposal(pid);
    }

    function test_SignerRotation_InvalidatesOpenVotes() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);
        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s3);
        uint256 openProposal = treasury.propose(SET_CONFIG, abi.encode(keccak256("acta-2")));
        assertEq(treasury.payment(id).approvals, 1);

        // Rotate to {s1, s2, s4}, threshold 2.
        _pass(SET_SIGNERS, abi.encode(_addrs3(s1, s2, s4), uint256(2)));
        assertEq(treasury.signerEpoch(), 1);
        assertFalse(treasury.isSigner(s3));
        assertTrue(treasury.isSigner(s4));

        assertEq(treasury.payment(id).approvals, 0);
        assertFalse(treasury.hasApproved(id, s1));
        (,,,, uint256 propApprovals) = treasury.proposal(openProposal);
        assertEq(propApprovals, 0);

        vm.prank(s3);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, s3));
        treasury.approve(id);

        vm.prank(s2);
        treasury.approve(id);
        assertEq(wars.balanceOf(v1), 0, "a single fresh vote is not enough");
        vm.prank(s1);
        treasury.approve(id); // s1 may vote again in the new epoch
        assertEq(wars.balanceOf(v1), 150e18);
    }

    // =====================================================================
    // Pause
    // =====================================================================

    function test_Pause_KeepsVotes_ThenUnpauseAndExecute() public {
        (uint256 id,, ITreasuryPolicy.Invoice memory inv) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, agent));
        treasury.pause();

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.Paused(s3);
        vm.prank(s3);
        treasury.pause();
        assertTrue(treasury.paused());

        vm.prank(s1);
        vm.expectRevert(TreasuryPolicy.ContractPaused.selector);
        treasury.pause();

        // Agent frozen.
        vm.prank(agent);
        vm.expectRevert(TreasuryPolicy.ContractPaused.selector);
        treasury.proposePayment(v2, _invoice(CUIT_V2), 1e18, LINE_REPAIRS, bytes32(0));

        // Votes accumulate but nothing executes.
        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s2);
        treasury.approve(id);
        assertEq(treasury.payment(id).approvals, 2);
        assertEq(uint8(_status(id)), uint8(ITreasuryPolicy.PaymentStatus.Pending));
        assertEq(wars.balanceOf(v1), 0);

        vm.prank(s1);
        vm.expectRevert(TreasuryPolicy.ContractPaused.selector);
        treasury.executePayment(id);

        // Unpause needs the threshold.
        vm.prank(s1);
        uint256 pid = treasury.propose(UNPAUSE, "");
        assertTrue(treasury.paused());
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.Unpaused();
        vm.prank(s2);
        treasury.approveProposal(pid);
        assertFalse(treasury.paused());

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, agent));
        treasury.executePayment(id);

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentExecuted(
            id,
            v1,
            LINE_SUPPLIES,
            150e18,
            treasury.invoiceIdOf(inv),
            keccak256(abi.encode(inv)),
            ITreasuryPolicy.Rule.Signers,
            false,
            false
        );
        vm.prank(s3);
        treasury.executePayment(id);
        assertEq(wars.balanceOf(v1), 150e18);
    }

    function test_ExecutePayment_NeedsThreshold() public {
        (uint256 id,,) = _proposeAs(v1, CUIT_V1, 150e18, LINE_SUPPLIES);
        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotEnoughApprovals.selector, 1, 2));
        treasury.executePayment(id);
    }

    function test_Unpause_RevertsWhenNotPaused() public {
        vm.prank(s1);
        uint256 pid = treasury.propose(UNPAUSE, "");
        vm.prank(s2);
        vm.expectRevert(TreasuryPolicy.NotPaused.selector);
        treasury.approveProposal(pid);
    }

    // =====================================================================
    // Budgets
    // =====================================================================

    function test_MoveBudget_WithReason() public {
        bytes32 reason = keccak256("acta 12: se reasigna para la estufa");
        uint256 pid = _open(MOVE_BUDGET, abi.encode(LINE_SUPPLIES, LINE_REPAIRS, 120e18, reason));
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.BudgetMoved(LINE_SUPPLIES, LINE_REPAIRS, 120e18, reason);
        vm.prank(s2);
        treasury.approveProposal(pid);
        assertEq(treasury.budget(LINE_SUPPLIES).allocated, 380e18);
        assertEq(treasury.budget(LINE_REPAIRS).allocated, 420e18);
    }

    function test_MoveBudget_Validation() public {
        vm.startPrank(s1);
        vm.expectRevert(TreasuryPolicy.MissingReason.selector);
        treasury.propose(MOVE_BUDGET, abi.encode(LINE_SUPPLIES, LINE_REPAIRS, 1e18, bytes32(0)));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.SameBudgetLine.selector, LINE_SUPPLIES));
        treasury.propose(MOVE_BUDGET, abi.encode(LINE_SUPPLIES, LINE_SUPPLIES, 1e18, bytes32("r")));
        vm.stopPrank();

        // Only the unspent part can move.
        _proposeAs(v1, CUIT_V1, 30e18, LINE_OPS); // spent 30 of 50
        vm.prank(s1);
        uint256 pid = treasury.propose(MOVE_BUDGET, abi.encode(LINE_OPS, LINE_SUPPLIES, 21e18, bytes32("r")));
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InsufficientBudget.selector, LINE_OPS, 20e18, 21e18));
        treasury.approveProposal(pid);

        vm.prank(s1);
        pid = treasury.propose(MOVE_BUDGET, abi.encode(LINE_OPS, keccak256("missing"), 1e18, bytes32("r")));
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.UnknownBudgetLine.selector, keccak256("missing")));
        treasury.approveProposal(pid);
    }

    function test_SetBudget_ReplacesAllocationKeepsSpent() public {
        _proposeAs(v1, CUIT_V1, 40e18, LINE_SUPPLIES);
        _pass(SET_BUDGET, abi.encode(LINE_SUPPLIES, 10e18, _in(1 days)));
        ITreasuryPolicy.Budget memory b = treasury.budget(LINE_SUPPLIES);
        assertEq(b.allocated, 10e18);
        assertEq(b.spent, 40e18);
        assertTrue(b.exists);
        assertEq(treasury.budgetLines().length, 3, "existing line is not duplicated");

        bytes32 newLine = keccak256("comedor");
        _pass(SET_BUDGET, abi.encode(newLine, 1e18, _in(1 days)));
        assertEq(treasury.budgetLines().length, 4);
        assertEq(treasury.budgetLines()[3], newLine);
    }

    function test_ExpiredBudget_StillPays_FlagsExpired() public {
        vm.warp(block.timestamp + 181 days);
        ITreasuryPolicy.Invoice memory inv = _invoice(CUIT_V1);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentExecuted(
            1, v1, LINE_SUPPLIES, 10e18, treasury.invoiceIdOf(inv), bytes32("f"), ITreasuryPolicy.Rule.Auto, false, true
        );
        vm.prank(agent);
        (, bool executed) = treasury.proposePayment(v1, inv, 10e18, LINE_SUPPLIES, bytes32("f"));
        assertTrue(executed);
    }

    function test_EscalatedPayment_OverBudget_Flagged() public {
        // LINE_OPS: 50 allocated. 80 escalates and signers pay it anyway.
        (uint256 id, bool executed, ITreasuryPolicy.Invoice memory inv) = _proposeAs(v1, CUIT_V1, 80e18, LINE_OPS);
        assertFalse(executed);
        vm.prank(s1);
        treasury.approve(id);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.PaymentExecuted(
            id,
            v1,
            LINE_OPS,
            80e18,
            treasury.invoiceIdOf(inv),
            keccak256(abi.encode(inv)),
            ITreasuryPolicy.Rule.Signers,
            true,
            false
        );
        vm.prank(s2);
        treasury.approve(id);
        assertEq(treasury.budget(LINE_OPS).spent, 80e18);
    }

    // =====================================================================
    // Agent as vendor
    // =====================================================================

    function test_PaymentToAgent_AlwaysEscalated() public {
        _pass(SET_VENDOR, abi.encode(agent, CUIT_AGENT, true));
        (uint256 id, bool executed,) = _proposeAs(agent, CUIT_AGENT, 1e18, LINE_OPS);
        assertFalse(executed, "tiny reimbursement to the agent still needs signers");
        assertEq(wars.balanceOf(agent), 0);

        vm.prank(s1);
        treasury.approve(id);
        vm.prank(s2);
        treasury.approve(id);
        assertEq(wars.balanceOf(agent), 1e18);
    }

    // =====================================================================
    // Configuration proposals
    // =====================================================================

    function test_Propose_OnlySigners() public {
        address[2] memory others = [agent, stranger];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, others[i]));
            treasury.propose(SET_CAPS, abi.encode(1e30, 1e30));
        }
        vm.prank(s1);
        uint256 pid = treasury.propose(SET_CAPS, abi.encode(1e30, 1e30));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotSigner.selector, agent));
        treasury.approveProposal(pid);
        assertEq(treasury.perTxCap(), PER_TX_CAP);
    }

    function test_Propose_EmitsAndExecutesAtThreshold() public {
        bytes memory data = abi.encode(uint256(5e18), uint256(7e18));
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.ProposalCreated(6, s1, SET_CAPS, data);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.ProposalApproved(6, s1, 1);
        vm.prank(s1);
        uint256 pid = treasury.propose(SET_CAPS, data);
        assertEq(pid, 6); // five proposals ran in setUp
        assertEq(treasury.proposalCount(), 6);
        assertTrue(treasury.hasApprovedProposal(pid, s1));

        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.ProposalApproved(pid, s2, 2);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.CapsSet(5e18, 7e18);
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.ProposalExecuted(pid, SET_CAPS);
        vm.prank(s2);
        treasury.approveProposal(pid);
        assertEq(treasury.perTxCap(), 5e18);
        assertEq(treasury.vendorMonthlyCap(), 7e18);

        vm.prank(s3);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.ProposalAlreadyExecuted.selector, pid));
        treasury.approveProposal(pid);

        vm.prank(s3);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.UnknownProposal.selector, 99));
        treasury.approveProposal(99);
    }

    function test_Propose_ThresholdOneExecutesImmediately() public {
        _pass(SET_SIGNERS, abi.encode(_addrs3(s1, s2, s3), uint256(1)));
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.ConfigHashSet(keccak256("acta-3"));
        vm.prank(s3);
        treasury.propose(SET_CONFIG, abi.encode(keccak256("acta-3")));
        assertEq(treasury.configHash(), keccak256("acta-3"));
    }

    function test_SetSigners_Validation() public {
        vm.startPrank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AgentIsSigner.selector, agent));
        treasury.propose(SET_SIGNERS, abi.encode(_addrs(s1, agent), uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.DuplicateSigner.selector, s2));
        treasury.propose(SET_SIGNERS, abi.encode(_addrs(s2, s2), uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidThreshold.selector, 3, 2));
        treasury.propose(SET_SIGNERS, abi.encode(_addrs(s1, s2), uint256(3)));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidThreshold.selector, 0, 0));
        treasury.propose(SET_SIGNERS, abi.encode(new address[](0), uint256(0)));
        vm.stopPrank();
    }

    function test_SetAgent() public {
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AgentIsSigner.selector, s2));
        treasury.propose(SET_AGENT, abi.encode(s2));

        address newAgent = makeAddr("newAgent");
        uint256 pid = _open(SET_AGENT, abi.encode(newAgent));
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.AgentSet(newAgent);
        vm.prank(s2);
        treasury.approveProposal(pid);
        assertEq(treasury.agent(), newAgent);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.NotAgent.selector, agent));
        treasury.proposePayment(v1, _invoice(CUIT_V1), 1e18, LINE_SUPPLIES, bytes32(0));
    }

    function test_SetAgent_RevalidatedAtExecution() public {
        address candidate = makeAddr("candidate");
        vm.prank(s1);
        uint256 pid = treasury.propose(SET_AGENT, abi.encode(candidate));
        // Meanwhile the candidate becomes a signer.
        _pass(SET_SIGNERS, abi.encode(_addrs3(s1, s2, candidate), uint256(2)));
        vm.prank(s1);
        treasury.approveProposal(pid);
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.AgentIsSigner.selector, candidate));
        treasury.approveProposal(pid);
    }

    function test_SetVendor_Validation() public {
        vm.startPrank(s1);
        vm.expectRevert(TreasuryPolicy.InvalidCuit.selector);
        treasury.propose(SET_VENDOR, abi.encode(v1, uint64(0), true));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidVendor.selector, address(0)));
        treasury.propose(SET_VENDOR, abi.encode(address(0), CUIT_V1, true));
        vm.expectRevert(abi.encodeWithSelector(TreasuryPolicy.InvalidVendor.selector, address(treasury)));
        treasury.propose(SET_VENDOR, abi.encode(address(treasury), CUIT_V1, true));
        vm.stopPrank();

        uint256 pid = _open(SET_VENDOR, abi.encode(v1, CUIT_V1, false));
        vm.expectEmit(address(treasury));
        emit ITreasuryPolicy.VendorSet(v1, CUIT_V1, false);
        vm.prank(s2);
        treasury.approveProposal(pid);
        (uint64 cuit, bool enabled) = treasury.vendorCuit(v1);
        assertEq(cuit, CUIT_V1);
        assertFalse(enabled);
    }

    function test_Propose_RejectsMalformedData() public {
        vm.prank(s1);
        vm.expectRevert();
        treasury.propose(SET_CAPS, hex"1234");
    }

    // =====================================================================
    // Fuzz: amounts around the automatic limits
    // =====================================================================

    /// Picks one limit as the binding one and probes amounts a few wei around it.
    function testFuzz_AutoLimitsBoundary(uint8 which, int8 delta, uint96 base) public {
        uint256 limit = bound(uint256(base), 10, 1_000e18);
        int256 d = int256(bound(int256(delta), -3, 3));
        uint256 amount = uint256(int256(limit) + d);
        uint256 big = 10_000e18;

        uint256 perTx = big;
        uint256 allocated = big;
        uint256 vendorCap = big;
        uint256 balance = big;
        which = which % 4;
        if (which == 0) perTx = limit;
        else if (which == 1) allocated = limit;
        else if (which == 2) vendorCap = limit;
        else balance = limit;

        TreasuryPolicy t = _deployTreasury(address(wars));
        _passOn(t, SET_CAPS, abi.encode(perTx, vendorCap));
        _passOn(t, SET_BUDGET, abi.encode(LINE_SUPPLIES, allocated, _in(1 days)));
        _passOn(t, SET_VENDOR, abi.encode(v1, CUIT_V1, true));
        wars.mint(address(t), balance);

        ITreasuryPolicy.Invoice memory inv = _invoice(CUIT_V1);
        vm.prank(agent);
        (uint256 id, bool executed) = t.proposePayment(v1, inv, amount, LINE_SUPPLIES, bytes32(0));

        bool fits = amount <= perTx && amount <= allocated && amount <= vendorCap && amount <= balance;
        assertEq(executed, fits);
        assertEq(wars.balanceOf(v1), fits ? amount : 0);
        assertEq(
            uint8(t.payment(id).status),
            uint8(fits ? ITreasuryPolicy.PaymentStatus.Executed : ITreasuryPolicy.PaymentStatus.Pending)
        );
        if (fits) {
            assertLe(amount, t.perTxCap());
            assertLe(t.budget(LINE_SUPPLIES).spent, t.budget(LINE_SUPPLIES).allocated);
            assertLe(t.vendorSpentThisPeriod(v1), t.vendorMonthlyCap());
        }
    }

    /// Cumulative auto payments to one vendor never exceed the period cap.
    function testFuzz_VendorCapAccumulates(uint256[6] memory amounts) public {
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 a = bound(amounts[i], 1, PER_TX_CAP);
            (, bool executed,) = _proposeAs(v1, CUIT_V1, a, LINE_SUPPLIES); // line has 500, cap binds first
            assertEq(executed, total + a <= VENDOR_MONTHLY_CAP);
            if (executed) total += a;
        }
        assertEq(treasury.vendorSpentThisPeriod(v1), total);
        assertLe(total, VENDOR_MONTHLY_CAP);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _open(ITreasuryPolicy.ProposalKind kind, bytes memory data) internal returns (uint256 id) {
        vm.prank(s1);
        id = treasury.propose(kind, data);
    }

    function _passOn(TreasuryPolicy t, ITreasuryPolicy.ProposalKind kind, bytes memory data) internal {
        vm.prank(s1);
        uint256 id = t.propose(kind, data);
        vm.prank(s2);
        t.approveProposal(id);
    }

    function _addrs(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _addrs3(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }
}
