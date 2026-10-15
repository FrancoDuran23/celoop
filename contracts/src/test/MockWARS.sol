// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test and local-only stand-in for wARS: 18 decimals, anyone can mint.
contract MockWARS is ERC20 {
    constructor() ERC20("Mock wARS", "wARS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
