// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TreasuryPolicy} from "./TreasuryPolicy.sol";
import {BoxFactory} from "./BoxFactory.sol";

/// @title CooperadoraFactory
/// @notice Deploys one TreasuryPolicy and its BoxFactory per school cooperative, in a single
/// transaction. Every treasury shares the platform agent and auditor; signers, threshold, caps
/// and the config hash belong to that cooperative.
contract CooperadoraFactory {
    struct Record {
        address treasury;
        address boxFactory;
        address creator;
        bytes32 configHash;
        uint64 createdAt;
    }

    error InvalidToken();
    error InvalidAgent();
    error UnknownCooperadora(uint256 id);

    /// wARS (or MockWARS off mainnet).
    address public immutable token;
    /// Platform treasurer. Set on every treasury this factory deploys.
    address public immutable agent;
    /// Platform auditor. address(0) means treasuries are deployed without one.
    address public immutable auditor;

    /// Ids start at 1. `count` is the last id issued.
    uint256 public count;
    mapping(uint256 => Record) private _records;
    /// treasury => id. 0 means that address was not deployed here.
    mapping(address => uint256) public idOf;

    event CooperadoraCreated(
        uint256 indexed id,
        address indexed treasury,
        address indexed boxFactory,
        address creator,
        bytes32 configHash
    );

    constructor(address token_, address agent_, address auditor_) {
        if (token_ == address(0)) revert InvalidToken();
        if (agent_ == address(0)) revert InvalidAgent();
        token = token_;
        agent = agent_;
        // forge-lint: disable-next-line(missing-zero-check)
        auditor = auditor_;
    }

    /// Deploys a treasury and its deposit-box factory. Anyone may call: the signers, not the
    /// caller, control the new treasury. Reverts with the treasury's own errors on a bad roster.
    function create(
        address[] calldata signers,
        uint256 threshold,
        uint256 perTxCap,
        uint256 vendorMonthlyCap,
        bytes32 configHash
    ) external returns (uint256 id, address treasury, address boxFactory) {
        TreasuryPolicy policy = new TreasuryPolicy(
            token, signers, threshold, agent, perTxCap, vendorMonthlyCap, configHash, auditor
        );
        BoxFactory boxes = new BoxFactory(address(policy), token);

        id = ++count;
        treasury = address(policy);
        boxFactory = address(boxes);
        _records[id] = Record({
            treasury: treasury,
            boxFactory: boxFactory,
            creator: msg.sender,
            configHash: configHash,
            createdAt: uint64(block.timestamp)
        });
        idOf[treasury] = id;
        emit CooperadoraCreated(id, treasury, boxFactory, msg.sender, configHash);
    }

    function cooperadora(uint256 id)
        external
        view
        returns (address treasury, address boxFactory, address creator, bytes32 configHash, uint64 createdAt)
    {
        Record storage r = _records[id];
        if (r.treasury == address(0)) revert UnknownCooperadora(id);
        return (r.treasury, r.boxFactory, r.creator, r.configHash, r.createdAt);
    }
}
