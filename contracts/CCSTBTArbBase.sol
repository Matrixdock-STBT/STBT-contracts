// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@arbitrum/nitro-contracts/src/precompiles/ArbSys.sol";
import "@arbitrum/nitro-contracts/src/libraries/AddressAliasHelper.sol";

import "./CCSTBTBase.sol";

abstract contract CCSTBTArbBase is CCSTBTBase {

    address public ethereumTarget;

    modifier onlyFromEthereum() {
        address addressAlias = AddressAliasHelper.applyL1ToL2Alias(ethereumTarget);
        require(msg.sender == addressAlias, "STBT: NOT_FROM_ETHEREUM");
        _;
    }

    event CCTxCreated(uint256 indexed burnId);

    function getArbSys() virtual public view returns (address);

    function ccSetPermission(address account, bool s, bool r, uint64 expiryTime,
        uint permissionSyncTime) public onlyFromEthereum {
        _ccSetPermission(account, s, r, expiryTime, permissionSyncTime);
    }

    function ccRebase(uint256 newTotalSupply, uint256 newTotalShares) external onlyFromEthereum {
        (uint _lastTime, uint _minInterval, /*uint _maxRatio*/) = (
        lastDistributeTime, minDistributeInterval, maxDistributeRatio);
        require(_lastTime + _minInterval < block.timestamp, 'STBT: MIN_DISTRIBUTE_INTERVAL_VIOLATED');
        lastDistributeTime = uint64(block.timestamp);
        _rebase(newTotalSupply, newTotalShares);
    }

    function ccIssue(address _recipient, uint256 _shares, uint64 expiryTime,
        uint permissionSyncTime) external onlyFromEthereum {
        _ccIssue(_recipient, _shares, expiryTime, permissionSyncTime);
    }

    function ccBurn(uint256 _value) external {
        bytes memory data = _ccBurn(_value);
        uint256 burnId = ArbSys(getArbSys()).sendTxToL1(ethereumTarget, data);
        emit CCTxCreated(burnId);
    }
}
