// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockWARS} from "../../src/test/MockWARS.sol";
import {ITreasuryPolicy} from "../../src/interfaces/ITreasuryPolicy.sol";

/// @notice MockWARS that observes every balance change, so invariants can check each transfer
/// at the exact moment it happens (vendor enabled, contract paused, box destinations).
contract TrackedWARS is MockWARS {
    ITreasuryPolicy public treasury;
    mapping(address => bool) public isBox;

    uint256 public inflow; // everything credited to the treasury
    uint256 public outflow; // everything debited from the treasury
    uint256 public outflowCount;
    uint256 public nonVendorOutflows; // treasury -> address that is not an enabled vendor
    uint256 public pausedOutflows; // treasury -> anyone while paused
    uint256 public boxLeaks; // box -> anything but the treasury

    function setTreasury(address treasury_) external {
        treasury = ITreasuryPolicy(treasury_);
    }

    function registerBox(address box) external {
        isBox[box] = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        address t = address(treasury);
        if (t != address(0)) {
            if (from == t) {
                outflow += value;
                outflowCount++;
                (, bool enabled) = treasury.vendorCuit(to);
                if (!enabled) nonVendorOutflows++;
                if (treasury.paused()) pausedOutflows++;
            }
            if (to == t) inflow += value;
        }
        if (isBox[from] && to != t) boxLeaks++;
    }
}
