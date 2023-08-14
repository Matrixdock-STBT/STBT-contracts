// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "./interfaces/ISTBT.sol";

contract STBTLockerBase {
    uint public totalSentToGuest;
    uint public totalReceivedFromGuest;

    address immutable public stbtAddress;

    constructor(address _stbtAddress) {
        stbtAddress = _stbtAddress;
    }

    function _ccRebase() internal view returns (bytes memory) {
        uint totalSupply = ISTBT(stbtAddress).totalSupply();
        uint totalShares = ISTBT(stbtAddress).totalShares();
        return abi.encodeWithSignature("ccRebase(uint256,uint256)", totalSupply, totalShares);
    }

    function _ccSetPermission(address account) internal view returns (bytes memory) {
        (bool sendAllowed, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(account);
        return abi.encodeWithSignature("ccSetPermission(address,bool,bool,uint64,uint256)",
                                       account, sendAllowed, receiveAllowed, expiryTime, block.timestamp);
    }

    function _ccLock(uint amount) internal returns (bytes memory) {
        (bool sendAllowed, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(msg.sender);
        bool ok = sendAllowed && receiveAllowed && (expiryTime == 0 || expiryTime > block.timestamp);
        require(ok, "NO_PERMISSION");
        ISTBT STBTContract = ISTBT(stbtAddress);
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
