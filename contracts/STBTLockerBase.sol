// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "./interfaces/ISTBT.sol";

contract STBTLockerBase {
    uint public totalSentToGuest;
    uint public totalReceivedFromGuest;
    uint public lastWSTBTPrice;
    uint constant private MIN_DIFF = 10**4;
    uint constant private UNIT = 10**18;

    address immutable public stbtAddress;

    constructor(address _stbtAddress) {
        stbtAddress = _stbtAddress;
    }

    function _ccRebase() internal returns (bytes memory) {
        uint totalSupply = ISTBT(stbtAddress).totalSupply();
        uint totalShares = ISTBT(stbtAddress).totalShares();
        uint wstbtPrice = totalSupply * UNIT / totalShares;
        uint _last = lastWSTBTPrice;
        require(wstbtPrice + MIN_DIFF < _last || _last + MIN_DIFF < wstbtPrice, "CHANGE_TOO_SMALL");
        lastWSTBTPrice = wstbtPrice;
        return abi.encodeWithSignature("ccRebase(uint256,uint256)", totalSupply, totalShares);
    }

    function _ccSetPermission(address account) internal view returns (bytes memory) {
        (bool sendAllowed, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(account);
        return abi.encodeWithSignature("ccSetPermission(address,bool,bool,uint64,uint256)",
                                       account, sendAllowed, receiveAllowed, expiryTime, block.timestamp);
    }

    function _ccLock(uint amount) internal returns (bytes memory) {
        ISTBT STBTContract = ISTBT(stbtAddress);
        (bool sendAllowed, bool receiveAllowed, uint64 expiryTime) = STBTContract.permissions(msg.sender);
        bool ok = sendAllowed && receiveAllowed && (expiryTime == 0 || expiryTime > block.timestamp);
        require(ok, "NO_PERMISSION");
        uint shares = STBTContract.getSharesByAmount(amount);
        STBTContract.transferFrom(msg.sender, address(this), amount);
        totalSentToGuest += shares;
        return abi.encodeWithSignature("ccIssue(address,uint256,uint64,uint256)",
                                       msg.sender, shares, expiryTime, block.timestamp);
    }

    function _ccRelease(address _recipient, uint256 _shares) internal {
        ISTBT STBTContract = ISTBT(stbtAddress);
        (, bool receiveAllowed, uint64 expiryTime) = STBTContract.permissions(_recipient);
        bool ok = receiveAllowed && (expiryTime == 0 || expiryTime > block.timestamp);
        if(!ok) {
            _recipient = STBTContract.controller();
        }
        uint stbtAmount = STBTContract.getAmountByShares(_shares);
        STBTContract.transfer(_recipient, stbtAmount);
        totalReceivedFromGuest += _shares;
    }
}
