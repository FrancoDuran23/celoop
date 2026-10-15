// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Shared contract surface. The app's ABI (app/src/lib/chain/abi.ts) mirrors this file;
/// changing a signature here means changing it there in the same change.
interface ITreasuryPolicy {
    enum PaymentStatus {
        None,
        Pending,
        Executed,
        Rejected
    }

    /// How a payment got executed.
    enum Rule {
        Auto,
        Signers
    }

    /// Proposal kinds and the abi-encoded `data` each one takes.
    enum ProposalKind {
        SetBudget, // (bytes32 lineId, uint256 allocated, uint64 periodEnd)
        MoveBudget, // (bytes32 fromLine, bytes32 toLine, uint256 amount, bytes32 reasonHash)
        SetVendor, // (address vendor, uint64 cuit, bool enabled)
        SetCaps, // (uint256 perTxCap, uint256 vendorMonthlyCap)
        SetSigners, // (address[] signers, uint256 threshold)
        SetAgent, // (address agent)
        SetConfigHash, // (bytes32 configHash)
        Unpause // ()
    }

    /// Fiscal identity of an Argentine invoice (ARCA). invoiceId = keccak256(abi.encode(cuit, tipo, ptoVta, nro)).
    struct Invoice {
        uint64 cuit; // issuer CUIT, 11 digits
        uint16 tipo; // ARCA comprobante code: 6 = Factura B, 11 = Factura C
        uint32 ptoVta;
        uint64 nro;
    }

    struct Budget {
        uint256 allocated;
        uint256 spent;
        uint64 periodEnd; // informative only: never blocks payments
        bool exists;
    }

    struct Payment {
        address vendor;
        uint256 amount;
        bytes32 lineId;
        bytes32 invoiceId;
        bytes32 fileHash;
        PaymentStatus status;
        uint256 approvals;
    }

    // ---- events ----
    event Contribution(bytes32 indexed ref, address indexed from, uint256 amount);

    event PaymentProposed(
        uint256 indexed paymentId,
        address indexed vendor,
        bytes32 indexed lineId,
        uint256 amount,
        bytes32 invoiceId,
        bytes32 fileHash
    );
    event PaymentExecuted(
        uint256 indexed paymentId,
        address indexed vendor,
        bytes32 indexed lineId,
        uint256 amount,
        bytes32 invoiceId,
        bytes32 fileHash,
        Rule rule,
        bool overBudget,
        bool budgetExpired
    );
    event PaymentApproved(uint256 indexed paymentId, address indexed signer, uint256 approvals);
    event PaymentRejected(uint256 indexed paymentId, address indexed signer);

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, ProposalKind kind, bytes data);
    event ProposalApproved(uint256 indexed proposalId, address indexed signer, uint256 approvals);
    event ProposalExecuted(uint256 indexed proposalId, ProposalKind kind);

    event BudgetSet(bytes32 indexed lineId, uint256 allocated, uint64 periodEnd);
    event BudgetMoved(bytes32 indexed fromLine, bytes32 indexed toLine, uint256 amount, bytes32 reasonHash);
    event VendorSet(address indexed vendor, uint64 cuit, bool enabled);
    event CapsSet(uint256 perTxCap, uint256 vendorMonthlyCap);
    event SignersSet(address[] signers, uint256 threshold);
    event AgentSet(address agent);
    event ConfigHashSet(bytes32 configHash);
    event Paused(address indexed by);
    event Unpaused();

    // ---- income ----
    /// Pulls `amount` wARS from msg.sender (transferFrom) and emits Contribution. Anyone may call.
    function contribute(uint256 amount, bytes32 ref) external;

    // ---- payments ----
    /// Agent only. Reverts if paused, vendor not enabled, CUIT mismatch, invoice already paid
    /// or already pending. Executes immediately when every automatic limit holds; otherwise
    /// stores it as Pending.
    function proposePayment(
        address vendor,
        Invoice calldata invoice,
        uint256 amount,
        bytes32 lineId,
        bytes32 fileHash
    ) external returns (uint256 paymentId, bool executed);

    /// Signer only. One vote per signer; executes on reaching threshold unless paused.
    function approve(uint256 paymentId) external;

    /// Signer only. Executes a Pending payment that already has enough approvals (e.g. after unpause).
    function executePayment(uint256 paymentId) external;

    /// Signer only. Cancels a Pending payment.
    function reject(uint256 paymentId) external;

    // ---- configuration ----
    /// Signer only. Creates a proposal; the proposer's approval counts. Executes at threshold.
    function propose(ProposalKind kind, bytes calldata data) external returns (uint256 proposalId);

    /// Signer only. One vote per signer; executes on reaching threshold.
    function approveProposal(uint256 proposalId) external;

    /// Any signer. Freezes every payment execution and every agent proposal.
    function pause() external;

    // ---- views ----
    function invoiceIdOf(Invoice calldata invoice) external pure returns (bytes32);
    function token() external view returns (address);
    function agent() external view returns (address);
    function signers() external view returns (address[] memory);
    function threshold() external view returns (uint256);
    function isSigner(address account) external view returns (bool);
    function perTxCap() external view returns (uint256);
    function vendorMonthlyCap() external view returns (uint256);
    function configHash() external view returns (bytes32);
    function paused() external view returns (bool);
    function budget(bytes32 lineId) external view returns (Budget memory);
    function budgetLines() external view returns (bytes32[] memory);
    function vendorCuit(address vendor) external view returns (uint64 cuit, bool enabled);
    /// Automatic-payment spend of `vendor` in the current 30-day bucket (block.timestamp / 30 days).
    function vendorSpentThisPeriod(address vendor) external view returns (uint256);
    function invoicePaid(bytes32 invoiceId) external view returns (bool);
    function payment(uint256 paymentId) external view returns (Payment memory);
    function paymentCount() external view returns (uint256);
    function hasApproved(uint256 paymentId, address signer) external view returns (bool);
    /// Incremented by SetSigners; votes are counted per epoch.
    function signerEpoch() external view returns (uint256);
    function proposalCount() external view returns (uint256);
    /// Approvals reported are the ones valid in the current signer epoch.
    function proposal(uint256 proposalId)
        external
        view
        returns (ProposalKind kind, bytes memory data, address proposer, bool executed, uint256 approvals);
    function hasApprovedProposal(uint256 proposalId, address signer) external view returns (bool);
}

interface IBoxFactory {
    event BoxSwept(bytes32 indexed ref, address indexed box, uint256 amount);

    /// CREATE2 address of the deposit box for `ref`, deployed or not.
    function boxAddress(bytes32 ref) external view returns (address);

    /// Anyone. Deploys the box if needed and contributes its whole wARS balance to the treasury
    /// with `ref`. The box has no other way to move funds.
    function sweep(bytes32 ref) external returns (uint256 amount);

    function treasury() external view returns (address);
    function token() external view returns (address);
}
