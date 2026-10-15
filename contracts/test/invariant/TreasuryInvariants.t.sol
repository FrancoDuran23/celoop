// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {TreasuryPolicy} from "../../src/TreasuryPolicy.sol";
import {BoxFactory} from "../../src/BoxFactory.sol";
import {ITreasuryPolicy} from "../../src/interfaces/ITreasuryPolicy.sol";
import {TrackedWARS} from "../utils/TrackedWARS.sol";
import {TreasuryHandler} from "./TreasuryHandler.sol";

/// @notice The nine invariants of docs/specs/01-contratos.md, checked after every random call
/// sequence driven by `TreasuryHandler`.
/// forge-config: default.invariant.depth = 128
contract TreasuryInvariants is StdInvariant, Test {
    TrackedWARS internal token;
    TreasuryPolicy internal treasury;
    BoxFactory internal factory;
    TreasuryHandler internal handler;

    function setUp() public {
        address[] memory signerPool = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            signerPool[i] = makeAddr(string.concat("signer", vm.toString(i)));
        }
        address[] memory agentPool = new address[](2);
        agentPool[0] = makeAddr("agent0");
        agentPool[1] = makeAddr("agent1");
        address[] memory vendorPool = new address[](6);
        for (uint256 i = 0; i < 4; i++) {
            vendorPool[i] = makeAddr(string.concat("vendor", vm.toString(i)));
        }
        vendorPool[4] = agentPool[0];
        vendorPool[5] = agentPool[1];
        address[] memory strangers = new address[](2);
        strangers[0] = makeAddr("stranger0");
        strangers[1] = makeAddr("stranger1");
        bytes32[] memory lines = new bytes32[](3);
        lines[0] = keccak256("materiales");
        lines[1] = keccak256("reparaciones");
        lines[2] = keccak256("gastos-operativos");
        bytes32[] memory refs = new bytes32[](4);
        for (uint256 i = 0; i < 4; i++) {
            refs[i] = keccak256(abi.encode("ref", i));
        }

        token = new TrackedWARS();
        address[] memory initialSigners = new address[](3);
        initialSigners[0] = signerPool[0];
        initialSigners[1] = signerPool[1];
        initialSigners[2] = signerPool[2];
        treasury =
            new TreasuryPolicy(address(token), initialSigners, 2, agentPool[0], 100e18, 250e18, keccak256("acta"));
        factory = new BoxFactory(address(treasury), address(token));
        token.setTreasury(address(treasury));
        for (uint256 i = 0; i < refs.length; i++) {
            token.registerBox(factory.boxAddress(refs[i]));
        }

        handler =
            new TreasuryHandler(treasury, token, factory, signerPool, agentPool, vendorPool, strangers, lines, refs);

        // Initial configuration (no funds move here).
        _pass(
            signerPool,
            ITreasuryPolicy.ProposalKind.SetBudget,
            abi.encode(lines[0], 600e18, uint64(block.timestamp + 90 days))
        );
        _pass(
            signerPool,
            ITreasuryPolicy.ProposalKind.SetBudget,
            abi.encode(lines[1], 150e18, uint64(block.timestamp + 30 days))
        );
        _pass(
            signerPool,
            ITreasuryPolicy.ProposalKind.SetBudget,
            abi.encode(lines[2], 60e18, uint64(block.timestamp + 10 days))
        );
        // vendor0..2 are regular vendors; agent0 is a vendor too (fee reimbursements), vendor3 starts unknown.
        for (uint256 i = 0; i < 5; i++) {
            if (i == 3) continue;
            _pass(
                signerPool,
                ITreasuryPolicy.ProposalKind.SetVendor,
                abi.encode(vendorPool[i], uint64(20_000_000_000 + i * 1_111_111), true)
            );
        }
        // Funding goes through the handler so the ghosts see it.
        handler.contribute(0, 500e18, 0);

        // Weighted so that payments and votes, the core of the system, dominate the sequences.
        bytes4[] memory selectors = new bytes4[](20);
        selectors[0] = TreasuryHandler.contribute.selector;
        selectors[1] = TreasuryHandler.directTransfer.selector;
        selectors[2] = TreasuryHandler.depositToBox.selector;
        selectors[3] = TreasuryHandler.sweepBox.selector;
        selectors[4] = TreasuryHandler.sweepBoxDirectly.selector;
        selectors[5] = TreasuryHandler.proposePayment.selector;
        selectors[6] = TreasuryHandler.proposePayment.selector;
        selectors[7] = TreasuryHandler.proposePayment.selector;
        selectors[8] = TreasuryHandler.approve.selector;
        selectors[9] = TreasuryHandler.approve.selector;
        selectors[10] = TreasuryHandler.approve.selector;
        selectors[11] = TreasuryHandler.executePayment.selector;
        selectors[12] = TreasuryHandler.reject.selector;
        selectors[13] = TreasuryHandler.propose.selector;
        selectors[14] = TreasuryHandler.propose.selector;
        selectors[15] = TreasuryHandler.approveProposal.selector;
        selectors[16] = TreasuryHandler.approveProposal.selector;
        selectors[17] = TreasuryHandler.approveProposal.selector;
        selectors[18] = TreasuryHandler.pause.selector;
        selectors[19] = TreasuryHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// 1. No wARS leaves the treasury except to a vendor enabled at the moment of payment.
    function invariant_01_OnlyEnabledVendorsReceive() public view {
        assertEq(token.nonVendorOutflows(), 0);
    }

    /// 2. No automatic payment exceeds perTxCap, the line's available budget or the vendor period cap.
    function invariant_02_AutoPaymentsWithinLimits() public view {
        assertFalse(handler.autoLimitViolation());
    }

    /// 3. The agent cannot execute proposals or receive funds without the signer threshold.
    function invariant_03_AgentBoundByThreshold() public view {
        assertFalse(handler.agentViolation());
        assertFalse(treasury.isSigner(treasury.agent()));
    }

    /// 4. No payment executes while paused.
    function invariant_04_NoPaymentWhilePaused() public view {
        assertEq(token.pausedOutflows(), 0);
    }

    /// 5. Every executed payment emits PaymentExecuted with invoiceId, fileHash, lineId and rule.
    function invariant_05_EveryPaymentEmitsEvent() public view {
        assertFalse(handler.eventViolation());
        (uint256 executedCount,) = handler.executedPaymentsConsistent();
        assertEq(executedCount, handler.executedEvents());
        assertEq(token.outflowCount(), handler.executedEvents());
    }

    /// 6. Balance = contributions + direct transfers - payments; no Contribution without a real transfer.
    function invariant_06_BalanceAccounting() public view {
        uint256 balance = token.balanceOf(address(treasury));
        assertEq(token.inflow(), handler.ghostContributions() + handler.ghostDirect());
        assertEq(token.outflow(), handler.ghostPaid());
        assertEq(balance, handler.ghostContributions() + handler.ghostDirect() - handler.ghostPaid());
    }

    /// 7. An invoiceId is paid at most once.
    function invariant_07_InvoicePaidAtMostOnce() public view {
        assertFalse(handler.duplicateViolation());
        (, bool consistent) = handler.executedPaymentsConsistent();
        assertTrue(consistent);
    }

    /// 8. The invoice CUIT matches vendors[vendor].cuit for every executed payment.
    function invariant_08_InvoiceCuitMatchesVendor() public view {
        assertFalse(handler.cuitViolation());
    }

    /// 9. A deposit box only transfers to the treasury.
    function invariant_09_BoxOnlyPaysTreasury() public view {
        assertEq(token.boxLeaks(), 0);
        assertFalse(handler.boxViolation());
    }

    function _pass(address[] memory signerPool, ITreasuryPolicy.ProposalKind kind, bytes memory data) internal {
        vm.prank(signerPool[0]);
        uint256 id = treasury.propose(kind, data);
        vm.prank(signerPool[1]);
        treasury.approveProposal(id);
    }
}
