// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockWARS} from "../../src/test/MockWARS.sol";

/// @notice Token that, once armed, calls back into a target during its next balance change
/// and records how the reentrant call ended.
contract ReentrantToken is MockWARS {
    address public target;
    bytes public payload;
    bool public armed;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && (from == target || to == target)) {
            armed = false;
            attempted = true;
            (bool ok, bytes memory ret) = target.call(payload);
            reentrySucceeded = ok;
            reentryRevertData = ret;
        }
    }
}

/// @notice Token that burns 1% of every transfer, so the recipient gets less than `amount`.
contract FeeOnTransferToken is MockWARS {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
