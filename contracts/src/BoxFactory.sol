// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBoxFactory, ITreasuryPolicy} from "./interfaces/ITreasuryPolicy.sol";
import {DepositBox} from "./DepositBox.sol";

/// @title BoxFactory
/// @notice Deterministic single-use deposit boxes. `boxAddress(ref)` is known before deployment;
/// `sweep(ref)` deploys the box if needed and contributes its balance to the treasury.
contract BoxFactory is IBoxFactory, ReentrancyGuard {
    error InvalidTreasury();
    error InvalidToken();
    error TokenMismatch(address expected, address actual);
    error SweepMismatch(uint256 expected, uint256 swept);

    address public immutable treasury;
    address public immutable token;
    /// DepositBox implementation every box clones.
    address public immutable implementation;

    constructor(address treasury_, address token_) {
        if (treasury_ == address(0) || treasury_.code.length == 0) revert InvalidTreasury();
        if (token_ == address(0)) revert InvalidToken();
        address treasuryToken = ITreasuryPolicy(treasury_).token();
        if (treasuryToken != token_) revert TokenMismatch(treasuryToken, token_);

        treasury = treasury_;
        token = token_;
        implementation = address(new DepositBox(IERC20(token_), ITreasuryPolicy(treasury_)));
    }

    /// @inheritdoc IBoxFactory
    function boxAddress(bytes32 ref) public view returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(implementation, abi.encode(ref), ref);
    }

    /// @inheritdoc IBoxFactory
    /// @dev Emits `BoxSwept` only when something was swept; an empty box returns 0 silently.
    function sweep(bytes32 ref) external nonReentrant returns (uint256 amount) {
        address box = boxAddress(ref);
        if (box.code.length == 0) {
            Clones.cloneDeterministicWithImmutableArgs(implementation, abi.encode(ref), ref);
        }
        amount = IERC20(token).balanceOf(box);
        if (amount == 0) return 0;

        // The only prior external call is a balanceOf view on the immutable token; sweep is nonReentrant.
        // forge-lint: disable-next-line(reentrancy-events)
        emit BoxSwept(ref, box, amount);
        uint256 swept = DepositBox(box).sweep();
        if (swept != amount) revert SweepMismatch(amount, swept);
    }
}
