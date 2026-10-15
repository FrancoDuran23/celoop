// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {TreasuryPolicy} from "../../src/TreasuryPolicy.sol";
import {BoxFactory} from "../../src/BoxFactory.sol";
import {DepositBox} from "../../src/DepositBox.sol";
import {ITreasuryPolicy} from "../../src/interfaces/ITreasuryPolicy.sol";
import {TrackedWARS} from "../utils/TrackedWARS.sol";

/// @notice Drives every public entry point of the treasury and the box factory with random
/// actors (agent, auditor, signers, ex-signers, strangers, vendors) and records ghost state and
/// violations. All treasury/factory calls go through `_call`, which captures their logs.
contract TreasuryHandler is Test {
    TreasuryPolicy public immutable treasury;
    TrackedWARS public immutable token;
    BoxFactory public immutable factory;

    address[] internal signerPool;
    address[] internal agentPool;
    address[] internal auditorPool;
    address[] internal vendorPool; // vendors that may get enabled (includes agent addresses)
    address[] internal strangers; // never enabled as vendors
    address[] internal actors;
    bytes32[] internal lines;
    bytes32[] internal refs;
    mapping(address => uint64) internal cuitOf;

    struct Meta {
        bool known;
        address vendor;
        uint256 amount;
        bytes32 lineId;
        bytes32 fileHash;
        ITreasuryPolicy.Invoice invoice;
    }

    mapping(uint256 => Meta) internal meta;
    uint256[] internal proposalIds;
    uint256[] internal pendingIds; // payments that were left Pending when proposed

    // ---- ghosts ----
    uint256 public ghostContributions;
    uint256 public ghostDirect;
    uint256 public ghostPaid;
    uint256 public executedEvents;
    uint256 public autoExecutions;
    uint256 public signerExecutions;
    uint256 public proposalsExecuted;
    uint256 public sweeps;
    mapping(bytes32 => uint256) public timesPaid;

    // ---- violations ----
    bool public autoLimitViolation; // invariant 2
    bool public agentViolation; // invariant 3
    bool public eventViolation; // invariant 5
    bool public duplicateViolation; // invariant 7
    bool public cuitViolation; // invariant 8
    bool public boxViolation; // invariant 9
    bool public auditorViolation; // invariant 10

    uint256 public auditedClears;
    uint256 public auditedFlags;

    bytes4 internal currentSelector;
    address internal agentAtCall;
    address internal auditorAtCall;
    /// Payments cleared by the auditor in the call being processed.
    mapping(uint256 => bool) internal clearedNow;
    uint256[] internal clearedNowIds;

    constructor(
        TreasuryPolicy treasury_,
        TrackedWARS token_,
        BoxFactory factory_,
        address[] memory signerPool_,
        address[] memory agentPool_,
        address[] memory auditorPool_,
        address[] memory vendorPool_,
        address[] memory strangers_,
        bytes32[] memory lines_,
        bytes32[] memory refs_
    ) {
        treasury = treasury_;
        token = token_;
        factory = factory_;
        signerPool = signerPool_;
        agentPool = agentPool_;
        auditorPool = auditorPool_;
        vendorPool = vendorPool_;
        strangers = strangers_;
        lines = lines_;
        refs = refs_;
        for (uint256 i = 0; i < signerPool_.length; i++) {
            actors.push(signerPool_[i]);
        }
        for (uint256 i = 0; i < agentPool_.length; i++) {
            actors.push(agentPool_[i]);
        }
        for (uint256 i = 0; i < auditorPool_.length; i++) {
            actors.push(auditorPool_[i]);
        }
        for (uint256 i = 0; i < vendorPool_.length; i++) {
            actors.push(vendorPool_[i]);
        }
        for (uint256 i = 0; i < strangers_.length; i++) {
            actors.push(strangers_[i]);
        }
        for (uint256 i = 0; i < vendorPool_.length; i++) {
            cuitOf[vendorPool_[i]] = uint64(20_000_000_000 + i * 1_111_111);
        }
        for (uint256 i = 0; i < strangers_.length; i++) {
            cuitOf[strangers_[i]] = uint64(27_000_000_000 + i * 1_111_111);
        }
    }

    // =====================================================================
    // Income
    // =====================================================================

    function contribute(uint256 actorSeed, uint256 amount, uint256 refSeed) public {
        address from = _actor(actorSeed);
        amount = bound(amount, 0, 600e18);
        token.mint(from, amount);
        vm.prank(from);
        token.approve(address(treasury), amount);
        _call(from, address(treasury), abi.encodeCall(treasury.contribute, (amount, refs[refSeed % refs.length])));
    }

    function directTransfer(uint256 actorSeed, uint256 amount) public {
        address from = _actor(actorSeed);
        amount = bound(amount, 0, 300e18);
        token.mint(from, amount);
        vm.prank(from);
        token.transfer(address(treasury), amount);
        ghostDirect += amount;
    }

    function depositToBox(uint256 refSeed, uint256 amount) public {
        amount = bound(amount, 0, 400e18);
        token.mint(factory.boxAddress(refs[refSeed % refs.length]), amount);
    }

    function sweepBox(uint256 refSeed, uint256 callerSeed) public {
        (bool ok,) =
            _call(_actor(callerSeed), address(factory), abi.encodeCall(factory.sweep, (refs[refSeed % refs.length])));
        if (ok) sweeps++;
    }

    /// Anyone but the factory calling a box directly must fail.
    function sweepBoxDirectly(uint256 refSeed, uint256 callerSeed) public {
        address box = factory.boxAddress(refs[refSeed % refs.length]);
        if (box.code.length == 0) return;
        vm.prank(_actor(callerSeed));
        try DepositBox(box).sweep() {
            boxViolation = true;
        } catch {}
    }

    // =====================================================================
    // Payments
    // =====================================================================

    struct AutoSnapshot {
        uint256 perTxCap;
        uint256 spent;
        uint256 allocated;
        uint256 vendorSpent;
        uint256 vendorCap;
        uint256 balance;
    }

    function proposePayment(
        uint256 callerSeed,
        uint256 vendorSeed,
        uint256 nroSeed,
        uint256 amount,
        uint256 lineSeed,
        bytes32 fileHash,
        uint256 cuitSeed
    ) public {
        callerSeed = _h(callerSeed);
        vendorSeed = _h(vendorSeed);
        nroSeed = _h(nroSeed);
        bool wrongCuit = _h(cuitSeed) % 8 == 0;
        address caller = callerSeed % 5 == 0 ? _actor(callerSeed / 5) : treasury.agent();
        address vendor = _paymentTarget(vendorSeed);
        // Half raw (lets the fuzzer hit 0 and the edges), half spread over the range.
        amount = amount % 2 == 0 ? bound(amount, 0, 400e18) : bound(_h(amount), 1, 400e18);
        uint256 expectedId = treasury.paymentCount() + 1;
        {
            (uint64 configured,) = treasury.vendorCuit(vendor);
            uint64 cuit = configured == 0 ? cuitOf[vendor] : configured;
            if (wrongCuit) cuit += 1;
            meta[expectedId] = Meta({
                known: true,
                vendor: vendor,
                amount: amount,
                lineId: lines[lineSeed % lines.length],
                fileHash: fileHash,
                invoice: ITreasuryPolicy.Invoice({cuit: cuit, tipo: 11, ptoVta: 1, nro: uint64(nroSeed % 48)})
            });
        }
        _proposeStored(caller, expectedId);
    }

    function _proposeStored(address caller, uint256 expectedId) internal {
        Meta storage m = meta[expectedId];
        address vendor = m.vendor;
        uint256 amount = m.amount;

        // Snapshot the automatic limits as they stand right before the call.
        ITreasuryPolicy.Budget memory b = treasury.budget(m.lineId);
        AutoSnapshot memory snap = AutoSnapshot({
            perTxCap: treasury.perTxCap(),
            spent: b.spent,
            allocated: b.allocated,
            vendorSpent: treasury.vendorSpentThisPeriod(vendor),
            vendorCap: treasury.vendorMonthlyCap(),
            balance: token.balanceOf(address(treasury))
        });

        (bool ok, bytes memory ret) = _call(
            caller,
            address(treasury),
            abi.encodeCall(treasury.proposePayment, (vendor, m.invoice, amount, m.lineId, m.fileHash))
        );
        if (!ok) return;
        if (caller != agentAtCall) agentViolation = true; // non-agent proposed a payment
        (uint256 id, bool executed) = abi.decode(ret, (uint256, bool));
        if (id != expectedId) eventViolation = true;
        if (!executed) pendingIds.push(id);
        if (executed && auditorAtCall != address(0)) auditorViolation = true; // skipped the auditor
        if (
            executed
                && (amount > snap.perTxCap
                    || snap.spent + amount > snap.allocated
                    || snap.vendorSpent + amount > snap.vendorCap
                    || amount > snap.balance
                    || vendor == agentAtCall)
        ) autoLimitViolation = true;
    }

    /// Mostly the current auditor, sometimes anyone (must fail).
    function auditPayment(uint256 callerSeed, uint256 idSeed, uint256 verdictSeed, bytes32 reportHash) public {
        uint256 id = _pickPayment(idSeed);
        if (id == 0) return;
        callerSeed = _h(callerSeed);
        address current = treasury.auditor();
        address caller = callerSeed % 5 == 0 || current == address(0) ? _actor(callerSeed / 5) : current;
        bool cleared = _h(verdictSeed) % 4 != 0;
        if (uint256(reportHash) % 16 == 0) reportHash = bytes32(0); // must be refused
        _auditStored(caller, id, cleared, reportHash);
    }

    function _auditStored(address caller, uint256 id, bool cleared, bytes32 reportHash) internal {
        ITreasuryPolicy.Payment memory p = treasury.payment(id);
        AutoSnapshot memory snap = _snapshot(p.vendor, p.lineId);

        (bool ok, bytes memory ret) =
            _call(caller, address(treasury), abi.encodeCall(treasury.auditPayment, (id, cleared, reportHash)));
        if (!ok) return;
        if (caller != auditorAtCall || reportHash == bytes32(0)) auditorViolation = true;
        if (cleared) auditedClears++;
        else auditedFlags++;
        bool executed = abi.decode(ret, (bool));
        if (executed && !cleared) auditorViolation = true;
        if (
            executed
                && (p.amount > snap.perTxCap
                    || snap.spent + p.amount > snap.allocated
                    || snap.vendorSpent + p.amount > snap.vendorCap
                    || p.amount > snap.balance
                    || p.vendor == agentAtCall
                    || p.vendor == auditorAtCall)
        ) autoLimitViolation = true;
    }

    function _snapshot(address vendor, bytes32 lineId) internal view returns (AutoSnapshot memory) {
        ITreasuryPolicy.Budget memory b = treasury.budget(lineId);
        return AutoSnapshot({
            perTxCap: treasury.perTxCap(),
            spent: b.spent,
            allocated: b.allocated,
            vendorSpent: treasury.vendorSpentThisPeriod(vendor),
            vendorCap: treasury.vendorMonthlyCap(),
            balance: token.balanceOf(address(treasury))
        });
    }

    function approve(uint256 callerSeed, uint256 idSeed) public {
        uint256 id = _pickPayment(idSeed);
        if (id == 0) return;
        _call(_signerBiased(callerSeed), address(treasury), abi.encodeCall(treasury.approve, (id)));
    }

    function executePayment(uint256 callerSeed, uint256 idSeed) public {
        uint256 id = _pickPayment(idSeed);
        if (id == 0) return;
        _call(_signerBiased(callerSeed), address(treasury), abi.encodeCall(treasury.executePayment, (id)));
    }

    function reject(uint256 callerSeed, uint256 idSeed) public {
        // Rejections are rarer than approvals, so payments get a chance to execute.
        idSeed = _h(idSeed);
        if (idSeed % 3 != 0) return;
        uint256 id = _pickPayment(idSeed / 3);
        if (id == 0) return;
        _call(_signerBiased(callerSeed), address(treasury), abi.encodeCall(treasury.reject, (id)));
    }

    // =====================================================================
    // Configuration
    // =====================================================================

    function propose(uint256 callerSeed, uint256 kindSeed, uint256 a, uint256 b, uint256 c) public {
        // While paused, half of the proposals try to unpause.
        ITreasuryPolicy.ProposalKind kind = treasury.paused() && kindSeed % 2 == 0
            ? ITreasuryPolicy.ProposalKind.Unpause
            : ITreasuryPolicy.ProposalKind((kindSeed / 2) % 9);
        bytes memory data = _proposalData(kind, a, b, c);
        address caller = _signerBiased(callerSeed);
        uint256 thresholdBefore = treasury.threshold();
        uint256 expectedId = treasury.proposalCount() + 1;

        (bool ok, bytes memory ret) = _call(caller, address(treasury), abi.encodeCall(treasury.propose, (kind, data)));
        if (!ok) return;
        uint256 id = abi.decode(ret, (uint256));
        if (id != expectedId) eventViolation = true;
        proposalIds.push(id);
        (,,, bool executed,) = treasury.proposal(id);
        if (executed) {
            proposalsExecuted++;
            if (thresholdBefore > 1) agentViolation = true; // executed without enough votes
        }
    }

    function approveProposal(uint256 callerSeed, uint256 idSeed) public {
        uint256 len = proposalIds.length;
        if (len == 0) return;
        idSeed = _h(idSeed);
        // Mostly vote on the most recent proposals, sometimes on any (including executed ones).
        uint256 id = idSeed % 4 == 0
            ? proposalIds[(idSeed / 4) % len]
            : proposalIds[len - 1 - (idSeed / 4) % (len < 3 ? len : 3)];
        address caller = _signerBiased(callerSeed);
        uint256 thresholdBefore = treasury.threshold();
        (,,, bool executedBefore, uint256 approvalsBefore) = treasury.proposal(id);

        (bool ok,) = _call(caller, address(treasury), abi.encodeCall(treasury.approveProposal, (id)));
        if (!ok) return;
        (,,, bool executedAfter,) = treasury.proposal(id);
        if (!executedBefore && executedAfter) {
            proposalsExecuted++;
            if (approvalsBefore + 1 < thresholdBefore) agentViolation = true;
        }
    }

    function pause(uint256 callerSeed) public {
        // Keep pauses rare enough that the system spends most of its time live.
        callerSeed = _h(callerSeed);
        if (callerSeed % 12 != 0) return;
        _call(_signerBiased(callerSeed / 12), address(treasury), abi.encodeCall(treasury.pause, ()));
    }

    function warp(uint256 secs) public {
        vm.warp(block.timestamp + bound(secs, 0, 20 days));
    }

    // =====================================================================
    // Invariant helpers
    // =====================================================================

    /// Number of payments whose status is Executed, and whether each matches the ghosts.
    function executedPaymentsConsistent() external view returns (uint256 executedCount, bool consistent) {
        consistent = true;
        uint256 count = treasury.paymentCount();
        for (uint256 id = 1; id <= count; id++) {
            ITreasuryPolicy.Payment memory p = treasury.payment(id);
            if (p.status == ITreasuryPolicy.PaymentStatus.Executed) {
                executedCount++;
                if (timesPaid[p.invoiceId] != 1 || !treasury.invoicePaid(p.invoiceId)) consistent = false;
            } else if (p.status == ITreasuryPolicy.PaymentStatus.Pending && timesPaid[p.invoiceId] != 0) {
                consistent = false; // a paid invoice cannot be pending again
            }
        }
    }

    // =====================================================================
    // Internal
    // =====================================================================

    function _call(address caller, address target, bytes memory data) internal returns (bool ok, bytes memory ret) {
        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
        }
        currentSelector = selector;
        agentAtCall = treasury.agent();
        auditorAtCall = treasury.auditor();
        bool callerWasSigner = treasury.isSigner(caller);

        vm.recordLogs();
        vm.prank(caller);
        (ok, ret) = target.call(data);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        if (ok && target == address(treasury) && _isSignerOnly(selector) && (!callerWasSigner || caller == agentAtCall))
        {
            agentViolation = true;
        }
        if (ok && target == address(treasury) && _isSignerOnly(selector) && caller == auditorAtCall) {
            auditorViolation = true;
        }
        _processLogs(logs);
        for (uint256 i = 0; i < clearedNowIds.length; i++) {
            clearedNow[clearedNowIds[i]] = false;
        }
        delete clearedNowIds;
    }

    function _processLogs(Vm.Log[] memory logs) internal {
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory log = logs[i];
            if (log.emitter != address(treasury)) continue;
            bytes32 sig = log.topics[0];
            if (sig == ITreasuryPolicy.Contribution.selector) {
                ghostContributions += abi.decode(log.data, (uint256));
            } else if (sig == ITreasuryPolicy.PaymentAudited.selector) {
                uint256 id = uint256(log.topics[1]);
                (bool cleared,) = abi.decode(log.data, (bool, bytes32));
                if (cleared) {
                    clearedNow[id] = true;
                    clearedNowIds.push(id);
                }
            } else if (sig == ITreasuryPolicy.PaymentExecuted.selector) {
                _onPaymentExecuted(log);
            }
        }
    }

    function _onPaymentExecuted(Vm.Log memory log) internal {
        uint256 id = uint256(log.topics[1]);
        address vendor = address(uint160(uint256(log.topics[2])));
        bytes32 lineId = log.topics[3];
        (uint256 amount, bytes32 invoiceId, bytes32 fileHash, ITreasuryPolicy.Rule rule,,) =
            abi.decode(log.data, (uint256, bytes32, bytes32, ITreasuryPolicy.Rule, bool, bool));

        Meta storage m = meta[id];
        bytes32 expectedInvoiceId =
            keccak256(abi.encode(m.invoice.cuit, m.invoice.tipo, m.invoice.ptoVta, m.invoice.nro));
        if (
            !m.known || m.vendor != vendor || m.amount != amount || m.lineId != lineId || m.fileHash != fileHash
                || expectedInvoiceId != invoiceId
        ) eventViolation = true;
        ITreasuryPolicy.Payment memory p = treasury.payment(id);
        if (p.status != ITreasuryPolicy.PaymentStatus.Executed || p.invoiceId != invoiceId) eventViolation = true;

        (uint64 vendorCuitNow,) = treasury.vendorCuit(vendor);
        if (vendorCuitNow != m.invoice.cuit) cuitViolation = true;

        if (++timesPaid[invoiceId] > 1) duplicateViolation = true;

        if (rule == ITreasuryPolicy.Rule.Auto) {
            autoExecutions++;
            // Automatic payments come out of proposePayment without an auditor, or out of the
            // auditor's clearance with one; never from anywhere else.
            bool viaProposal = currentSelector == TreasuryPolicy.proposePayment.selector && auditorAtCall == address(0);
            bool viaAudit = currentSelector == TreasuryPolicy.auditPayment.selector && clearedNow[id];
            if (!viaProposal && !viaAudit) auditorViolation = true;
            if (currentSelector != TreasuryPolicy.proposePayment.selector && !viaAudit) autoLimitViolation = true;
            if (vendor == agentAtCall) agentViolation = true;
            if (vendor == auditorAtCall) auditorViolation = true;
        } else {
            signerExecutions++;
            if (p.approvals < treasury.threshold()) agentViolation = true;
        }

        ghostPaid += amount;
        executedEvents++;
    }

    function _isSignerOnly(bytes4 s) internal pure returns (bool) {
        return s == TreasuryPolicy.approve.selector || s == TreasuryPolicy.executePayment.selector
            || s == TreasuryPolicy.reject.selector || s == TreasuryPolicy.propose.selector
            || s == TreasuryPolicy.approveProposal.selector || s == TreasuryPolicy.pause.selector;
    }

    function _proposalData(ITreasuryPolicy.ProposalKind kind, uint256 a, uint256 b, uint256 c)
        internal
        view
        returns (bytes memory)
    {
        if (kind == ITreasuryPolicy.ProposalKind.SetBudget) {
            uint64 periodEnd = uint64(bound(c, 0, block.timestamp + 365 days));
            return abi.encode(lines[a % lines.length], bound(b, 0, 1_500e18), periodEnd);
        }
        if (kind == ITreasuryPolicy.ProposalKind.MoveBudget) {
            bytes32 reason = c % 6 == 0 ? bytes32(0) : bytes32(c);
            return abi.encode(lines[a % lines.length], lines[(a / 7) % lines.length], bound(b, 0, 400e18), reason);
        }
        if (kind == ITreasuryPolicy.ProposalKind.SetVendor) {
            address vendor = vendorPool[a % vendorPool.length];
            uint64 cuit = b % 6 == 0 ? cuitOf[vendor] + 1 : cuitOf[vendor];
            return abi.encode(vendor, cuit, c % 4 != 0);
        }
        if (kind == ITreasuryPolicy.ProposalKind.SetCaps) {
            return abi.encode(bound(a, 0, 300e18), bound(b, 0, 600e18));
        }
        if (kind == ITreasuryPolicy.ProposalKind.SetSigners) {
            uint256 mask = 1 + a % ((1 << signerPool.length) - 1);
            uint256 n;
            for (uint256 i = 0; i < signerPool.length; i++) {
                if (mask & (1 << i) != 0) n++;
            }
            bool withAgent = c % 10 == 0; // must be rejected
            address[] memory set = new address[](n + (withAgent ? 1 : 0));
            uint256 k;
            for (uint256 i = 0; i < signerPool.length; i++) {
                if (mask & (1 << i) != 0) set[k++] = signerPool[i];
            }
            if (withAgent) set[k] = treasury.agent();
            return abi.encode(set, 1 + b % set.length);
        }
        if (kind == ITreasuryPolicy.ProposalKind.SetAgent) {
            address candidate = b % 10 == 0
                ? signerPool[a % signerPool.length]
                : b % 10 == 1 ? auditorPool[a % auditorPool.length] : agentPool[a % agentPool.length];
            return abi.encode(candidate);
        }
        if (kind == ITreasuryPolicy.ProposalKind.SetConfigHash) {
            return abi.encode(bytes32(a));
        }
        if (kind == ITreasuryPolicy.ProposalKind.SetAuditor) {
            // Signers and the agent must be refused; address(0) turns the auditor off.
            if (c % 10 == 0) return abi.encode(signerPool[a % signerPool.length]);
            if (c % 10 == 1) return abi.encode(treasury.agent());
            if (b % 3 == 0) return abi.encode(address(0));
            return abi.encode(auditorPool[a % auditorPool.length]);
        }
        return "";
    }

    /// Fuzzers favour edge values (0, max); hash seeds used for probability gates.
    function _h(uint256 seed) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed)));
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// 3 out of 4 calls come from a current signer; the rest from anyone (agent, strangers...).
    function _signerBiased(uint256 seed) internal view returns (address) {
        seed = _h(seed);
        if (seed % 4 == 0) return _actor(seed / 4);
        address[] memory current = treasury.signers();
        return current[(seed / 4) % current.length];
    }

    /// Mostly the regular vendors; sometimes agent addresses or strangers (never enabled).
    function _paymentTarget(uint256 seed) internal view returns (address) {
        if (seed % 4 != 0) return vendorPool[(seed / 4) % 4];
        uint256 i = (seed / 4) % (vendorPool.length + strangers.length);
        return i < vendorPool.length ? vendorPool[i] : strangers[i - vendorPool.length];
    }

    /// Mostly a payment that was left pending, sometimes any id (0 if there are none).
    function _pickPayment(uint256 seed) internal view returns (uint256) {
        uint256 count = treasury.paymentCount();
        if (count == 0) return 0;
        seed = _h(seed);
        uint256 len = pendingIds.length;
        if (len == 0 || seed % 4 == 0) return 1 + (seed / 4) % count;
        return pendingIds[len - 1 - (seed / 4) % (len < 4 ? len : 4)];
    }
}
