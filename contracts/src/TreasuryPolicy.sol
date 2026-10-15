// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ITreasuryPolicy} from "./interfaces/ITreasuryPolicy.sol";

/// @title TreasuryPolicy
/// @notice Holds a school cooperative's wARS. The agent can only pay enabled vendors against valid
/// invoices within automatic limits; everything else needs `threshold` signer approvals.
contract TreasuryPolicy is ITreasuryPolicy, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// Upper bound on the signer set, keeps signer rotation loops bounded.
    uint256 public constant MAX_SIGNERS = 20;

    /// Length of a vendor cap period.
    uint256 public constant VENDOR_PERIOD = 30 days;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotAgent(address caller);
    error NotSigner(address caller);
    error ContractPaused();
    error NotPaused();
    error ZeroAmount();
    error InvalidToken();
    error InvalidAgent(address agent);
    error AgentIsSigner(address agent);
    error InvalidThreshold(uint256 threshold, uint256 signerCount);
    error InvalidSigner(address signer);
    error DuplicateSigner(address signer);
    error TooManySigners(uint256 count);
    error VendorNotEnabled(address vendor);
    error CuitMismatch(uint64 invoiceCuit, uint64 vendorCuit);
    error UnknownBudgetLine(bytes32 lineId);
    error InvalidBudgetLine();
    error SameBudgetLine(bytes32 lineId);
    error InsufficientBudget(bytes32 lineId, uint256 available, uint256 requested);
    error MissingReason();
    error InvalidVendor(address vendor);
    error InvalidCuit();
    error InvoiceAlreadyPaid(bytes32 invoiceId);
    error InvoiceAlreadyPending(bytes32 invoiceId);
    error PaymentNotPending(uint256 paymentId);
    error AlreadyApproved(address signer);
    error NotEnoughApprovals(uint256 approvals, uint256 threshold);
    error InsufficientBalance(uint256 balance, uint256 amount);
    error ContributionMismatch(uint256 expected, uint256 received);
    error UnknownProposal(uint256 proposalId);
    error ProposalAlreadyExecuted(uint256 proposalId);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Vendor {
        uint64 cuit;
        bool enabled;
    }

    /// Internal payment record. Approvals are counted per signer epoch, outside the struct.
    struct PaymentRecord {
        address vendor;
        uint64 cuit;
        PaymentStatus status;
        uint256 amount;
        bytes32 lineId;
        bytes32 invoiceId;
        bytes32 fileHash;
    }

    struct Proposal {
        ProposalKind kind;
        bool executed;
        address proposer;
        bytes data;
    }

    IERC20 private immutable _token;

    address[] private _signers;
    mapping(address => bool) private _isSigner;
    uint256 private _threshold;
    /// Bumped on every signer rotation; votes cast in an older epoch no longer count.
    uint256 private _signerEpoch;

    address private _agent;
    uint256 private _perTxCap;
    uint256 private _vendorMonthlyCap;
    bytes32 private _configHash;
    bool private _paused;

    mapping(bytes32 => Budget) private _budgets;
    bytes32[] private _budgetLines;

    mapping(address => Vendor) private _vendors;
    mapping(address => mapping(uint256 period => uint256)) private _vendorPeriodSpent;

    mapping(bytes32 => bool) private _invoicePaid;
    mapping(bytes32 => bool) private _invoicePending;

    /// Payment ids start at 1; `_paymentCount` is the last id issued.
    uint256 private _paymentCount;
    mapping(uint256 => PaymentRecord) private _payments;
    mapping(uint256 id => mapping(uint256 epoch => uint256)) private _paymentApprovals;
    mapping(uint256 id => mapping(uint256 epoch => mapping(address => bool))) private _paymentVoted;

    /// Proposal ids start at 1; `_proposalCount` is the last id issued.
    uint256 private _proposalCount;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 id => mapping(uint256 epoch => uint256)) private _proposalApprovals;
    mapping(uint256 id => mapping(uint256 epoch => mapping(address => bool))) private _proposalVoted;

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyAgent() {
        if (msg.sender != _agent) revert NotAgent(msg.sender);
        _;
    }

    modifier onlySigner() {
        if (!_isSigner[msg.sender]) revert NotSigner(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        address token_,
        address[] memory signers_,
        uint256 threshold_,
        address agent_,
        uint256 perTxCap_,
        uint256 vendorMonthlyCap_,
        bytes32 configHash_
    ) {
        if (token_ == address(0)) revert InvalidToken();
        _token = IERC20(token_);

        if (agent_ == address(0)) revert InvalidAgent(agent_);
        _checkAgent(agent_);
        _agent = agent_;
        _setSigners(signers_, threshold_);

        _perTxCap = perTxCap_;
        _vendorMonthlyCap = vendorMonthlyCap_;
        _configHash = configHash_;

        emit SignersSet(signers_, threshold_);
        emit AgentSet(agent_);
        emit CapsSet(perTxCap_, vendorMonthlyCap_);
        emit ConfigHashSet(configHash_);
    }

    // ---------------------------------------------------------------------
    // Income
    // ---------------------------------------------------------------------

    /// @inheritdoc ITreasuryPolicy
    function contribute(uint256 amount, bytes32 ref) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = _token.balanceOf(address(this));
        _token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = _token.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert ContributionMismatch(amount, received);

        emit Contribution(ref, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Payments
    // ---------------------------------------------------------------------

    /// @inheritdoc ITreasuryPolicy
    function proposePayment(address vendor, Invoice calldata invoice, uint256 amount, bytes32 lineId, bytes32 fileHash)
        external
        nonReentrant
        onlyAgent
        returns (uint256 paymentId, bool executed)
    {
        if (_paused) revert ContractPaused();
        if (amount == 0) revert ZeroAmount();

        Vendor memory v = _vendors[vendor];
        if (!v.enabled) revert VendorNotEnabled(vendor);
        if (invoice.cuit != v.cuit) revert CuitMismatch(invoice.cuit, v.cuit);

        Budget storage line = _budgets[lineId];
        if (!line.exists) revert UnknownBudgetLine(lineId);

        bytes32 invoiceId = _invoiceId(invoice);
        if (_invoicePaid[invoiceId]) revert InvoiceAlreadyPaid(invoiceId);
        if (_invoicePending[invoiceId]) revert InvoiceAlreadyPending(invoiceId);

        paymentId = ++_paymentCount;
        PaymentRecord storage p = _payments[paymentId];
        p.vendor = vendor;
        p.cuit = invoice.cuit;
        p.status = PaymentStatus.Pending;
        p.amount = amount;
        p.lineId = lineId;
        p.invoiceId = invoiceId;
        p.fileHash = fileHash;
        _invoicePending[invoiceId] = true;

        emit PaymentProposed(paymentId, vendor, lineId, amount, invoiceId, fileHash);

        if (_withinAutoLimits(vendor, amount, line)) {
            _executePayment(paymentId, p, Rule.Auto);
            executed = true;
        }
    }

    /// @inheritdoc ITreasuryPolicy
    function approve(uint256 paymentId) external nonReentrant onlySigner {
        PaymentRecord storage p = _payments[paymentId];
        if (p.status != PaymentStatus.Pending) revert PaymentNotPending(paymentId);

        uint256 epoch = _signerEpoch;
        if (_paymentVoted[paymentId][epoch][msg.sender]) revert AlreadyApproved(msg.sender);
        _paymentVoted[paymentId][epoch][msg.sender] = true;
        uint256 approvals = ++_paymentApprovals[paymentId][epoch];

        emit PaymentApproved(paymentId, msg.sender, approvals);

        if (approvals >= _threshold && !_paused) {
            _executePayment(paymentId, p, Rule.Signers);
        }
    }

    /// @inheritdoc ITreasuryPolicy
    function executePayment(uint256 paymentId) external nonReentrant onlySigner {
        if (_paused) revert ContractPaused();
        PaymentRecord storage p = _payments[paymentId];
        if (p.status != PaymentStatus.Pending) revert PaymentNotPending(paymentId);

        uint256 approvals = _paymentApprovals[paymentId][_signerEpoch];
        if (approvals < _threshold) revert NotEnoughApprovals(approvals, _threshold);

        _executePayment(paymentId, p, Rule.Signers);
    }

    /// @inheritdoc ITreasuryPolicy
    function reject(uint256 paymentId) external nonReentrant onlySigner {
        PaymentRecord storage p = _payments[paymentId];
        if (p.status != PaymentStatus.Pending) revert PaymentNotPending(paymentId);

        p.status = PaymentStatus.Rejected;
        _invoicePending[p.invoiceId] = false;

        emit PaymentRejected(paymentId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    /// @inheritdoc ITreasuryPolicy
    function propose(ProposalKind kind, bytes calldata data)
        external
        nonReentrant
        onlySigner
        returns (uint256 proposalId)
    {
        _validateProposal(kind, data);

        proposalId = ++_proposalCount;
        Proposal storage prop = _proposals[proposalId];
        prop.kind = kind;
        prop.proposer = msg.sender;
        prop.data = data;

        emit ProposalCreated(proposalId, msg.sender, kind, data);

        _voteProposal(proposalId, prop);
    }

    /// @inheritdoc ITreasuryPolicy
    function approveProposal(uint256 proposalId) external nonReentrant onlySigner {
        if (proposalId == 0 || proposalId > _proposalCount) revert UnknownProposal(proposalId);
        Proposal storage prop = _proposals[proposalId];
        if (prop.executed) revert ProposalAlreadyExecuted(proposalId);

        _voteProposal(proposalId, prop);
    }

    /// @inheritdoc ITreasuryPolicy
    function pause() external nonReentrant onlySigner {
        if (_paused) revert ContractPaused();
        _paused = true;
        emit Paused(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views (interface)
    // ---------------------------------------------------------------------

    /// @inheritdoc ITreasuryPolicy
    function invoiceIdOf(Invoice calldata invoice) external pure returns (bytes32) {
        return _invoiceId(invoice);
    }

    function token() external view returns (address) {
        return address(_token);
    }

    function agent() external view returns (address) {
        return _agent;
    }

    function signers() external view returns (address[] memory) {
        return _signers;
    }

    function threshold() external view returns (uint256) {
        return _threshold;
    }

    function isSigner(address account) external view returns (bool) {
        return _isSigner[account];
    }

    function perTxCap() external view returns (uint256) {
        return _perTxCap;
    }

    function vendorMonthlyCap() external view returns (uint256) {
        return _vendorMonthlyCap;
    }

    function configHash() external view returns (bytes32) {
        return _configHash;
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    function budget(bytes32 lineId) external view returns (Budget memory) {
        return _budgets[lineId];
    }

    function budgetLines() external view returns (bytes32[] memory) {
        return _budgetLines;
    }

    function vendorCuit(address vendor) external view returns (uint64 cuit, bool enabled) {
        Vendor memory v = _vendors[vendor];
        return (v.cuit, v.enabled);
    }

    /// @inheritdoc ITreasuryPolicy
    function vendorSpentThisPeriod(address vendor) public view returns (uint256) {
        return _vendorPeriodSpent[vendor][block.timestamp / VENDOR_PERIOD];
    }

    function invoicePaid(bytes32 invoiceId) external view returns (bool) {
        return _invoicePaid[invoiceId];
    }

    /// Approvals reported are the ones valid in the current signer epoch.
    function payment(uint256 paymentId) external view returns (Payment memory) {
        PaymentRecord storage p = _payments[paymentId];
        return Payment({
            vendor: p.vendor,
            amount: p.amount,
            lineId: p.lineId,
            invoiceId: p.invoiceId,
            fileHash: p.fileHash,
            status: p.status,
            approvals: _paymentApprovals[paymentId][_signerEpoch]
        });
    }

    function paymentCount() external view returns (uint256) {
        return _paymentCount;
    }

    function hasApproved(uint256 paymentId, address signer) external view returns (bool) {
        return _paymentVoted[paymentId][_signerEpoch][signer];
    }

    // ---------------------------------------------------------------------
    // Views (extra, not in ITreasuryPolicy)
    // ---------------------------------------------------------------------

    function signerEpoch() external view returns (uint256) {
        return _signerEpoch;
    }

    function proposalCount() external view returns (uint256) {
        return _proposalCount;
    }

    /// Approvals reported are the ones valid in the current signer epoch.
    function proposal(uint256 proposalId)
        external
        view
        returns (ProposalKind kind, bytes memory data, address proposer, bool executed, uint256 approvals)
    {
        Proposal storage prop = _proposals[proposalId];
        return (prop.kind, prop.data, prop.proposer, prop.executed, _proposalApprovals[proposalId][_signerEpoch]);
    }

    function hasApprovedProposal(uint256 proposalId, address signer) external view returns (bool) {
        return _proposalVoted[proposalId][_signerEpoch][signer];
    }

    // ---------------------------------------------------------------------
    // Internal: payments
    // ---------------------------------------------------------------------

    function _withinAutoLimits(address vendor, uint256 amount, Budget storage line) private view returns (bool) {
        return amount <= _perTxCap && line.spent + amount <= line.allocated
            && vendorSpentThisPeriod(vendor) + amount <= _vendorMonthlyCap && amount <= _token.balanceOf(address(this))
            && vendor != _agent;
    }

    /// Single execution path for both rules. Checks, then effects, then the transfer.
    function _executePayment(uint256 paymentId, PaymentRecord storage p, Rule rule) private {
        // checks (revalidated even on the auto path, where they are already known to hold)
        if (_paused) revert ContractPaused();
        address vendor = p.vendor;
        uint256 amount = p.amount;
        Vendor memory v = _vendors[vendor];
        if (!v.enabled) revert VendorNotEnabled(vendor);
        if (v.cuit != p.cuit) revert CuitMismatch(p.cuit, v.cuit);
        if (_invoicePaid[p.invoiceId]) revert InvoiceAlreadyPaid(p.invoiceId);
        uint256 balance = _token.balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance(balance, amount);

        // effects
        p.status = PaymentStatus.Executed;
        _invoicePaid[p.invoiceId] = true;
        _invoicePending[p.invoiceId] = false;

        Budget storage line = _budgets[p.lineId];
        line.spent += amount;
        if (rule == Rule.Auto) {
            _vendorPeriodSpent[vendor][block.timestamp / VENDOR_PERIOD] += amount;
        }

        emit PaymentExecuted(
            paymentId,
            vendor,
            p.lineId,
            amount,
            p.invoiceId,
            p.fileHash,
            rule,
            line.spent > line.allocated,
            // periodEnd is informative only; a few seconds of validator skew are harmless here.
            // forge-lint: disable-next-line(block-timestamp)
            block.timestamp > line.periodEnd
        );

        // interaction
        _token.safeTransfer(vendor, amount);
    }

    function _invoiceId(Invoice calldata invoice) private pure returns (bytes32) {
        return keccak256(abi.encode(invoice.cuit, invoice.tipo, invoice.ptoVta, invoice.nro));
    }

    // ---------------------------------------------------------------------
    // Internal: proposals
    // ---------------------------------------------------------------------

    function _voteProposal(uint256 proposalId, Proposal storage prop) private {
        uint256 epoch = _signerEpoch;
        if (_proposalVoted[proposalId][epoch][msg.sender]) revert AlreadyApproved(msg.sender);
        _proposalVoted[proposalId][epoch][msg.sender] = true;
        uint256 approvals = ++_proposalApprovals[proposalId][epoch];

        emit ProposalApproved(proposalId, msg.sender, approvals);

        if (approvals >= _threshold) {
            prop.executed = true;
            _executeProposal(prop.kind, prop.data);
            emit ProposalExecuted(proposalId, prop.kind);
        }
    }

    /// Static checks run at proposal time so obviously invalid proposals never collect votes.
    /// Every check is repeated at execution, where state may have changed.
    function _validateProposal(ProposalKind kind, bytes calldata data) private view {
        if (kind == ProposalKind.SetBudget) {
            (bytes32 lineId,,) = abi.decode(data, (bytes32, uint256, uint64));
            if (lineId == bytes32(0)) revert InvalidBudgetLine();
        } else if (kind == ProposalKind.MoveBudget) {
            (bytes32 fromLine, bytes32 toLine, uint256 amount, bytes32 reasonHash) =
                abi.decode(data, (bytes32, bytes32, uint256, bytes32));
            if (fromLine == toLine) revert SameBudgetLine(fromLine);
            if (amount == 0) revert ZeroAmount();
            if (reasonHash == bytes32(0)) revert MissingReason();
        } else if (kind == ProposalKind.SetVendor) {
            (address vendor, uint64 cuit, bool enabled) = abi.decode(data, (address, uint64, bool));
            _checkVendor(vendor, cuit, enabled);
        } else if (kind == ProposalKind.SetCaps) {
            abi.decode(data, (uint256, uint256));
        } else if (kind == ProposalKind.SetSigners) {
            (address[] memory newSigners, uint256 newThreshold) = abi.decode(data, (address[], uint256));
            _checkSignerSet(newSigners, newThreshold, _agent);
        } else if (kind == ProposalKind.SetAgent) {
            address newAgent = abi.decode(data, (address));
            _checkAgent(newAgent);
        } else if (kind == ProposalKind.SetConfigHash) {
            abi.decode(data, (bytes32));
        }
        // Unpause takes no data; it is validated at execution (must be paused).
    }

    function _executeProposal(ProposalKind kind, bytes memory data) private {
        if (kind == ProposalKind.SetBudget) {
            (bytes32 lineId, uint256 allocated, uint64 periodEnd) = abi.decode(data, (bytes32, uint256, uint64));
            if (lineId == bytes32(0)) revert InvalidBudgetLine();
            Budget storage line = _budgets[lineId];
            if (!line.exists) {
                line.exists = true;
                _budgetLines.push(lineId);
            }
            line.allocated = allocated;
            line.periodEnd = periodEnd;
            emit BudgetSet(lineId, allocated, periodEnd);
        } else if (kind == ProposalKind.MoveBudget) {
            (bytes32 fromLine, bytes32 toLine, uint256 amount, bytes32 reasonHash) =
                abi.decode(data, (bytes32, bytes32, uint256, bytes32));
            if (fromLine == toLine) revert SameBudgetLine(fromLine);
            if (amount == 0) revert ZeroAmount();
            if (reasonHash == bytes32(0)) revert MissingReason();
            Budget storage src = _budgets[fromLine];
            Budget storage dst = _budgets[toLine];
            if (!src.exists) revert UnknownBudgetLine(fromLine);
            if (!dst.exists) revert UnknownBudgetLine(toLine);
            uint256 available = src.allocated > src.spent ? src.allocated - src.spent : 0;
            if (available < amount) revert InsufficientBudget(fromLine, available, amount);
            src.allocated -= amount;
            dst.allocated += amount;
            emit BudgetMoved(fromLine, toLine, amount, reasonHash);
        } else if (kind == ProposalKind.SetVendor) {
            (address vendor, uint64 cuit, bool enabled) = abi.decode(data, (address, uint64, bool));
            _checkVendor(vendor, cuit, enabled);
            _vendors[vendor] = Vendor({cuit: cuit, enabled: enabled});
            emit VendorSet(vendor, cuit, enabled);
        } else if (kind == ProposalKind.SetCaps) {
            (uint256 newPerTxCap, uint256 newVendorMonthlyCap) = abi.decode(data, (uint256, uint256));
            _perTxCap = newPerTxCap;
            _vendorMonthlyCap = newVendorMonthlyCap;
            emit CapsSet(newPerTxCap, newVendorMonthlyCap);
        } else if (kind == ProposalKind.SetSigners) {
            (address[] memory newSigners, uint256 newThreshold) = abi.decode(data, (address[], uint256));
            uint256 oldCount = _signers.length;
            for (uint256 i = 0; i < oldCount; ++i) {
                // The whole rotation is announced by SignersSet below.
                // forge-lint: disable-next-line(missing-events-access-control)
                _isSigner[_signers[i]] = false;
            }
            delete _signers;
            _setSigners(newSigners, newThreshold);
            unchecked {
                ++_signerEpoch;
            }
            emit SignersSet(newSigners, newThreshold);
        } else if (kind == ProposalKind.SetAgent) {
            address newAgent = abi.decode(data, (address));
            _checkAgent(newAgent);
            _agent = newAgent;
            emit AgentSet(newAgent);
        } else if (kind == ProposalKind.SetConfigHash) {
            bytes32 newConfigHash = abi.decode(data, (bytes32));
            _configHash = newConfigHash;
            emit ConfigHashSet(newConfigHash);
        } else {
            // ProposalKind.Unpause
            if (!_paused) revert NotPaused();
            _paused = false;
            emit Unpaused();
        }
    }

    // ---------------------------------------------------------------------
    // Internal: validation and signer set
    // ---------------------------------------------------------------------

    /// Validates and stores a signer set. Caller must have cleared the previous set.
    function _setSigners(address[] memory newSigners, uint256 newThreshold) private {
        _checkSignerSet(newSigners, newThreshold, _agent);
        uint256 count = newSigners.length;
        for (uint256 i = 0; i < count; ++i) {
            address s = newSigners[i];
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (_isSigner[s]) revert DuplicateSigner(s);
            _isSigner[s] = true;
            _signers.push(s);
        }
        _threshold = newThreshold;
    }

    /// Stateless checks of a signer set (duplicates are detected with an O(n^2) scan, n <= MAX_SIGNERS).
    function _checkSignerSet(address[] memory newSigners, uint256 newThreshold, address currentAgent) private pure {
        uint256 count = newSigners.length;
        if (count > MAX_SIGNERS) revert TooManySigners(count);
        if (newThreshold == 0 || newThreshold > count) revert InvalidThreshold(newThreshold, count);
        for (uint256 i = 0; i < count; ++i) {
            address s = newSigners[i];
            // Signer sets are tiny (<= MAX_SIGNERS) and validated rarely; clarity beats gas here.
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (s == address(0)) revert InvalidSigner(s);
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (s == currentAgent) revert AgentIsSigner(s);
            for (uint256 j = 0; j < i; ++j) {
                // forge-lint: disable-next-line(require-revert-in-loop)
                if (newSigners[j] == s) revert DuplicateSigner(s);
            }
        }
    }

    function _checkAgent(address newAgent) private view {
        if (newAgent == address(0) || newAgent == address(this)) revert InvalidAgent(newAgent);
        if (_isSigner[newAgent]) revert AgentIsSigner(newAgent);
    }

    function _checkVendor(address vendor, uint64 cuit, bool enabled) private view {
        if (vendor == address(0) || vendor == address(this) || vendor == address(_token)) {
            revert InvalidVendor(vendor);
        }
        if (enabled && cuit == 0) revert InvalidCuit();
    }
}
