// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./STBTBase.sol";

contract CCSTBTBase is STBTBase {
    mapping(address => uint) public permissionSyncTimes;

    uint public totalSentToEthereum;
    uint public totalReceivedFromEthereum;

    function getInternalTotalSupplyAndShares() public view returns (uint, uint) {
        return (totalSupply_, totalShares_);
    }

    function totalShares() public view returns (uint) {
        return totalReceivedFromEthereum - totalSentToEthereum;
    }

    function totalSupply() public view returns (uint) {
        return totalSupply_ * totalShares() / totalShares_;
    }

    function setPermission(address addr, Permission calldata permission, uint timestamp) public onlyOwner {
        permissions[addr] = permission;
        permissionSyncTimes[addr] = timestamp;
    }

    function _burnSharesWithCheck(address _account, uint256 _shares) internal override returns (uint) {
        Permission memory perm = permissions[_account];
        require(perm.sendAllowed, 'STBT: NO_SEND_PERMISSION');
        require(perm.expiryTime == 0 || perm.expiryTime > block.timestamp, 'STBT: SEND_PERMISSION_EXPIRED');
        require(perm.receiveAllowed, 'STBT: NO_RECEIVE_PERMISSION');
        return _burnShares(_account, _shares);
    }

    function _burnShares(address _account, uint256 _shares) internal override returns (uint) {
        require(_account != address(0), "STBT: BURN_FROM_THE_ZERO_ADDRESS");

        uint256 accountShares = shares[_account];
        require(_shares <= accountShares, "STBT: BURN_AMOUNT_EXCEEDS_BALANCE");

        shares[_account] = accountShares - _shares;

        emit TransferShares(_account, address(0), _shares);
        return 0; // return value not used
    }

    function _rebase(uint256 newTotalSupply, uint256 newTotalShares) internal {
        totalSupply_ = newTotalSupply;
        totalShares_ = newTotalShares;
    }

    function rebase(uint256 newTotalSupply, uint256 newTotalShares) external onlyController {
        uint oldTotalSupply = totalSupply_;
        uint oldTotalShares = totalShares_;
        (uint _lastTime, uint _minInterval, uint _maxRatio) = (
             lastDistributeTime, minDistributeInterval, maxDistributeRatio);
        uint x = newTotalSupply*oldTotalShares;
        uint y = oldTotalSupply*newTotalShares;
        uint unit = 10**18;
        require(x*unit <= y*(unit+_maxRatio), "STBT: MAX_DISTRIBUTE_RATIO_EXCEEDED");
        require(y*unit <= x*(unit+_maxRatio), "STBT: MAX_DISTRIBUTE_RATIO_EXCEEDED");
        require(_lastTime + _minInterval < block.timestamp, 'STBT: MIN_DISTRIBUTE_INTERVAL_VIOLATED');
        lastDistributeTime = uint64(block.timestamp);
        _rebase(newTotalSupply, newTotalShares);
    }

    function _ccSetPermission(address account, bool s, bool r, uint64 expiryTime,
                 uint permissionSyncTime) internal {
        if(permissionSyncTime >= permissionSyncTimes[account]) {
            permissions[account] = Permission({
                sendAllowed: s,
                receiveAllowed: r,
                expiryTime: expiryTime
            });
            permissionSyncTimes[account] = permissionSyncTime;
        }
    }

    function _ccIssue(address _recipient, uint256 _shares, uint64 expiryTime, uint permissionSyncTime) internal {
        if(permissionSyncTime >= permissionSyncTimes[_recipient]) {
            permissions[_recipient] = Permission(true, true, expiryTime);
            permissionSyncTimes[_recipient] = permissionSyncTime;
        }
        Permission memory p = permissions[_recipient];
        bool ok = p.receiveAllowed && (p.expiryTime == 0 || p.expiryTime > block.timestamp);
        if(!ok) {
            _recipient = controller;
        }
        shares[_recipient] += _shares;
        emit TransferShares(address(0), _recipient, _shares);
        uint _value = getAmountByShares(_shares);
        emit Transfer(address(0), _recipient, _value);
        totalReceivedFromEthereum += _shares;
    }

    function _ccBurn(uint256 _value) internal returns (bytes memory) {
        uint sharesDelta = getSharesByAmount(_value);
        _burnSharesWithCheck(msg.sender, sharesDelta);

        _value = getAmountByShares(sharesDelta);
        emit Transfer(msg.sender, address(0), _value);
        totalSentToEthereum += sharesDelta;
        return abi.encodeWithSignature("ccRelease(address,uint256)", msg.sender, sharesDelta);
    }

    function controllerRedeem(address /*_tokenHolder*/,
                              uint256 /*_value*/,
                              bytes calldata /*_data*/,
                              bytes calldata /*_operatorData*/) external override pure {
        revert("NOT_IMPLEMENTED");
    }
}
