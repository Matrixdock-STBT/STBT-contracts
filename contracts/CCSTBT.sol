// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@arbitrum/nitro-contracts/src/precompiles/ArbSys.sol";
import "@arbitrum/nitro-contracts/src/libraries/AddressAliasHelper.sol";
import "./interfaces/ISTBT.sol";
import "./CCSTBTBase.sol";

contract CCSTBT is CCSTBTBase {
    ArbSys constant arbsys = ArbSys(address(100));
    address public ethereumTarget;
    event CCTxCreated(uint256 indexed burnId);

    modifier onlyFromEthereum() {
        address addressAlias = AddressAliasHelper.applyL1ToL2Alias(ethereumTarget);
        require(msg.sender == addressAlias, "STBT: NOT_FROM_ETHEREUM");
        _;
    }

    constructor(address _target) {
        ethereumTarget = _target;
    }

    function updateEthereumTarget(address _target) public onlyOwner {
        ethereumTarget = _target;
    }

    function ccSetPermission(address account, bool s, bool r, uint64 expiryTime,
			     uint permissionSyncTime) public onlyFromEthereum {
        _ccSetPermission(account, s, r, expiryTime, permissionSyncTime);
    }

    function ccRebase(uint256 newTotalSupply, uint256 newTotalShares) external onlyFromEthereum {
        _rebase(newTotalSupply, newTotalShares);
    }

    function ccIssue(address _recipient, uint256 _shares, uint64 expiryTime,
		     uint permissionSyncTime) external onlyFromEthereum {
        _ccIssue(_recipient, _shares, expiryTime, permissionSyncTime);
    }

    function ccBurn(uint256 _value) external {
        bytes memory data = _ccBurn(_value);
        uint256 burnId = arbsys.sendTxToL1(ethereumTarget, data);
        emit CCTxCreated(burnId);
    }
}


