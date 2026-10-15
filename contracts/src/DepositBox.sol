// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {ITreasuryPolicy} from "./interfaces/ITreasuryPolicy.sol";

/// @title DepositBox
/// @notice Single-use deposit address. Deployed as a minimal clone by `BoxFactory`, with its `ref`
/// stored as an immutable clone argument. Its only way to move funds is `sweep`, which only the
/// factory can call and which can only contribute the whole wARS balance to the treasury.
contract DepositBox {
    using SafeERC20 for IERC20;

    error OnlyFactory(address caller);
    error NotAClone();

    address public immutable factory;
    IERC20 public immutable token;
    ITreasuryPolicy public immutable treasury;
    address private immutable _self;

    constructor(IERC20 token_, ITreasuryPolicy treasury_) {
        factory = msg.sender;
        token = token_;
        treasury = treasury_;
        _self = address(this);
    }

    /// The contribution reference fixed at clone creation.
    function ref() public view returns (bytes32) {
        if (address(this) == _self) revert NotAClone();
        return abi.decode(Clones.fetchCloneArgs(address(this)), (bytes32));
    }

    /// Factory only. Contributes the whole wARS balance to the treasury under `ref`.
    /// Returns 0 without calling the treasury when the box is empty.
    function sweep() external returns (uint256 amount) {
        if (msg.sender != factory) revert OnlyFactory(msg.sender);
        if (address(this) == _self) revert NotAClone();

        amount = token.balanceOf(address(this));
        if (amount == 0) return 0;

        token.forceApprove(address(treasury), amount);
        treasury.contribute(amount, ref());
    }
}
