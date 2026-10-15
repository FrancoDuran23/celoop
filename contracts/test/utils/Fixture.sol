// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {TreasuryPolicy} from "../../src/TreasuryPolicy.sol";
import {BoxFactory} from "../../src/BoxFactory.sol";
import {MockWARS} from "../../src/test/MockWARS.sol";
import {ITreasuryPolicy} from "../../src/interfaces/ITreasuryPolicy.sol";

/// @notice Common deployment for scenario tests: 2-of-3 signers, one agent, three vendors,
/// two budget lines and a funded treasury.
abstract contract Fixture is Test {
    uint256 internal constant PER_TX_CAP = 100e18;
    uint256 internal constant VENDOR_MONTHLY_CAP = 250e18;
    uint256 internal constant INITIAL_FUNDS = 1_000e18;

    bytes32 internal constant LINE_SUPPLIES = keccak256("materiales");
    bytes32 internal constant LINE_REPAIRS = keccak256("reparaciones");
    bytes32 internal constant LINE_OPS = keccak256("gastos-operativos");
    bytes32 internal constant CONFIG_HASH = keccak256("acta-2026-03");

    uint64 internal constant CUIT_V1 = 20_111_111_112;
    uint64 internal constant CUIT_V2 = 30_222_222_223;
    uint64 internal constant CUIT_AGENT = 20_333_333_334;

    MockWARS internal wars;
    TreasuryPolicy internal treasury;
    BoxFactory internal factory;

    address internal s1 = makeAddr("signer1");
    address internal s2 = makeAddr("signer2");
    address internal s3 = makeAddr("signer3");
    address internal s4 = makeAddr("signer4");
    address internal agent = makeAddr("agent");
    address internal auditorAddr = makeAddr("auditor");
    address internal v1 = makeAddr("vendor1");
    address internal v2 = makeAddr("vendor2");
    address internal stranger = makeAddr("stranger");
    address internal donor = makeAddr("donor");

    uint256 internal nextNro = 1;

    function setUp() public virtual {
        wars = new MockWARS();
        treasury = _deployTreasury(address(wars));
        factory = new BoxFactory(address(treasury), address(wars));

        _pass(ITreasuryPolicy.ProposalKind.SetBudget, abi.encode(LINE_SUPPLIES, 500e18, _in(180 days)));
        _pass(ITreasuryPolicy.ProposalKind.SetBudget, abi.encode(LINE_REPAIRS, 300e18, _in(180 days)));
        _pass(ITreasuryPolicy.ProposalKind.SetBudget, abi.encode(LINE_OPS, 50e18, _in(180 days)));
        _pass(ITreasuryPolicy.ProposalKind.SetVendor, abi.encode(v1, CUIT_V1, true));
        _pass(ITreasuryPolicy.ProposalKind.SetVendor, abi.encode(v2, CUIT_V2, true));

        _fund(INITIAL_FUNDS);
    }

    /// Override to deploy with an auditor (address(0) = none).
    function _auditorAtDeploy() internal view virtual returns (address) {
        return address(0);
    }

    function _deployTreasury(address token) internal returns (TreasuryPolicy) {
        address[] memory signers = new address[](3);
        signers[0] = s1;
        signers[1] = s2;
        signers[2] = s3;
        return
            new TreasuryPolicy(
                token, signers, 2, agent, PER_TX_CAP, VENDOR_MONTHLY_CAP, CONFIG_HASH, _auditorAtDeploy()
            );
    }

    function _in(uint256 secs) internal view returns (uint64) {
        return uint64(block.timestamp + secs);
    }

    /// s1 proposes, s2 approves: passes a 2-of-3 proposal.
    function _pass(ITreasuryPolicy.ProposalKind kind, bytes memory data) internal returns (uint256 id) {
        vm.prank(s1);
        id = treasury.propose(kind, data);
        vm.prank(s2);
        treasury.approveProposal(id);
    }

    function _fund(uint256 amount) internal {
        wars.mint(donor, amount);
        vm.startPrank(donor);
        wars.approve(address(treasury), amount);
        treasury.contribute(amount, keccak256("seed"));
        vm.stopPrank();
    }

    function _invoice(uint64 cuit) internal returns (ITreasuryPolicy.Invoice memory inv) {
        inv = ITreasuryPolicy.Invoice({cuit: cuit, tipo: 11, ptoVta: 3, nro: uint64(nextNro++)});
    }

    function _proposeAs(address vendor, uint64 cuit, uint256 amount, bytes32 lineId)
        internal
        returns (uint256 id, bool executed, ITreasuryPolicy.Invoice memory inv)
    {
        inv = _invoice(cuit);
        vm.prank(agent);
        (id, executed) = treasury.proposePayment(vendor, inv, amount, lineId, keccak256(abi.encode(inv)));
    }

    function _status(uint256 id) internal view returns (ITreasuryPolicy.PaymentStatus) {
        return treasury.payment(id).status;
    }
}
