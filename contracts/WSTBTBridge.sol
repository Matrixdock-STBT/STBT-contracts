// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "./interfaces/ISTBT.sol";
import "./CCWSTBTMessager.sol";

contract WSTBTBridge is Ownable, ICCIPClient {
    address immutable public stbtAddress; // = 0x530824DA86689C9C17CdC2871Ff29B058345b44a;
    address immutable public wstbtAddress;
    address public messager;
    bool public sendEnabled;

    modifier onlyMessager() {
        require(msg.sender == messager, 'WSTBTBridge: NOT_MESSAGER');
        _;
    }

    constructor(address _stbtAddress, address _wstbtAddress) {
        stbtAddress = _stbtAddress;
        wstbtAddress = _wstbtAddress;
    }

    function setMessager(address _messager) public onlyOwner {
        messager = _messager;
    }

    function setSendEnabled(bool b) public onlyOwner {
        sendEnabled = b;
    }

    function ccSend(address sender, address receiver, uint256 value) public onlyMessager returns (bytes memory message) {
        require(sendEnabled, "WSTBTBridge: SEND_DISABLED");

        (bool sendAllowed, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(receiver);
        if(value != 0) {
            require(receiveAllowed, 'WSTBTBridge: NO_RECEIVE_PERMISSION');
            require(expiryTime == 0 || expiryTime > block.timestamp, 'WSTBTBridge: RECEIVE_PERMISSION_EXPIRED');
            IERC20(wstbtAddress).transferFrom(sender, address(this), value);
        }

        return _getCcSendData(receiver, value, sendAllowed, receiveAllowed, expiryTime);
    }

    function getCcSendData(address, address receiver, uint256 value) external view returns (bytes memory message) {
        (bool sendAllowed, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(receiver);
        return _getCcSendData(receiver, value, sendAllowed, receiveAllowed, expiryTime);
    }

    function _getCcSendData(address receiver, uint256 value, bool sendAllowed, bool receiveAllowed, uint64 expiryTime) private view returns (bytes memory message) {
        uint receiverAndPermission = uint(uint160(receiver));
        receiverAndPermission = (receiverAndPermission<<8)|(sendAllowed? 1 : 0);
        receiverAndPermission = (receiverAndPermission<<8)|(receiveAllowed? 1 : 0);
        receiverAndPermission = (receiverAndPermission<<64)|uint(expiryTime);
        uint priceToSTBT = ISTBT(stbtAddress).getAmountByShares(10**18);
        uint priceToSTBTUpdateTime = block.timestamp;
        uint priceAndUpdateTime = (priceToSTBT<<64) | priceToSTBTUpdateTime;
        return abi.encode(value, receiverAndPermission, priceAndUpdateTime);
    }

    function ccReceive(bytes calldata message) public onlyMessager {
        (address sender, address receiver, uint value) =
            abi.decode(message, (address, address, uint));
        if(value == 0) return;
        (/*bool sendAllowed*/, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(receiver);
        if(!receiveAllowed || (expiryTime != 0 && expiryTime < block.timestamp)) {
            receiver = owner();
        } else {
            bool sendAllowed;
            (sendAllowed,,expiryTime) = ISTBT(stbtAddress).permissions(sender);
            if(!sendAllowed || (expiryTime != 0 && expiryTime <= block.timestamp)) {
                receiver = owner();
            }
        }
        IERC20(wstbtAddress).transfer(receiver, value);
    }
}

