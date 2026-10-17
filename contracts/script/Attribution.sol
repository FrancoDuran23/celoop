// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice ERC-8021 tagging for contract creations.
/// The transaction input of a CREATE is the init code. Solidity reads constructor arguments from
/// the start of the tail and ignores leftover bytes, so the attribution suffix can sit after them.
/// Indexers read it from the end of the creation transaction.
library Attribution {
    function taggedInitCode(bytes memory creationCode, bytes memory args, bytes memory suffix)
        internal
        pure
        returns (bytes memory)
    {
        return bytes.concat(creationCode, args, suffix);
    }

    function create(bytes memory creationCode, bytes memory args, bytes memory suffix) internal returns (address addr) {
        bytes memory initCode = taggedInitCode(creationCode, args, suffix);
        assembly ("memory-safe") {
            addr := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(addr != address(0) && addr.code.length > 0, "Deploy: contract creation failed");
    }
}
