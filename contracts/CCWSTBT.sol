// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import "./interfaces/ISTBT.sol";

contract CCWSTBT is ERC20Permit, Ownable {
    address public messager;
    address public controller;
    mapping(address => Permission) public permissions; // Address-ansfer permissions
    mapping(address => bool) public localForbidden; // forbidden accounts locally, despite global permission

    uint128 public priceToSTBT;
    uint64 public priceToSTBTUpdateTime;
    bool public sendEnanbled;

    event ControllerTransfer(
        address _controller,
        address indexed _from,
        address indexed _to,
        uint256 _value,
        bytes _data,
        bytes _operatorData
    );

    constructor(string memory name_, string memory symbol_, address messager_) 
                ERC20Permit(name_) ERC20(name_, symbol_) {
        messager = messager_;
    }

    modifier onlyController() {
        require(msg.sender == controller, 'CCWSTBT: NOT_CONTROLLER');
        _;
    }

    modifier onlyMessager() {
        require(msg.sender == messager, 'CCWSTBT: NOT_MESSAGER');
        _;
    }

    function setController(address _controller) public onlyOwner {
        controller = _controller;
    }

    function setMessager(address _messager) public onlyOwner {
        messager = _messager;
    }

    function setPermissionAndForbidden(address account, Permission calldata permission, bool b) public onlyController {
        permissions[account] = permission;
        localForbidden[account] = b;
    }

    function setPermission(address account, Permission calldata permission) public onlyController {
        permissions[account] = permission;
    }

    function setForbidden(address account, bool b) public onlyController {
        localForbidden[account] = b;
    }

    function setSendEnalbed(bool b) public onlyOwner {
        sendEnanbled = b;
    }

    function transfer(address _recipient, uint256 _amount) public override returns (bool) {
        _checkSendPermission(msg.sender);
        _checkReceivePermission(_recipient);
        require(!localForbidden[msg.sender] && !localForbidden[_recipient], "forbidden");
        return super.transfer(_recipient, _amount);
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public override returns (bool) {
        _checkSendPermission(_sender);
        _checkReceivePermission(_recipient);
        require(!localForbidden[_sender] && !localForbidden[_recipient], "forbidden");
        return super.transferFrom(_sender, _recipient, _amount);
    }

    function _checkSendPermission(address _sender) private view {
        Permission memory p = permissions[_sender];
        require(p.sendAllowed, 'CCWSTBT: NO_SEND_PERMISSION');
        require(p.expiryTime == 0 || p.expiryTime > block.timestamp, 'CCWSTBT: SEND_PERMISSION_EXPIRED');
    }

    function _checkReceivePermission(address _recipient) private view {
        Permission memory p = permissions[_recipient];
        require(p.receiveAllowed, 'CCWSTBT: NO_RECEIVE_PERMISSION');
        require(p.expiryTime == 0 || p.expiryTime > block.timestamp, 'CCWSTBT: RECEIVE_PERMISSION_EXPIRED');
    }

    function controllerTransfer(address _from, address _to, uint256 _value, bytes calldata _data, bytes calldata _operatorData) external onlyController {
        _transfer(_from, _to, _value);
        emit ControllerTransfer(msg.sender, _from, _to, _value, _data, _operatorData);
    }

    // a cc-message always contains the value, the receiver, the receiver's permission and price info
    function ccSend(address sender, address receiver, uint256 value) public onlyMessager returns (bytes memory message) {
        if(value != 0) {
            _checkReceivePermission(receiver);
            _burn(sender, value);
        }
        return getCcSendData(receiver, value);
    }

    function getCcSendData(address receiver, uint256 value) public view returns (bytes memory message) {
        Permission memory p = permissions[receiver];
        uint receiverAndPermission = uint(uint160(receiver));
        receiverAndPermission = (receiverAndPermission<<8)|(p.sendAllowed? 1 : 0);
        receiverAndPermission = (receiverAndPermission<<8)|(p.receiveAllowed? 1 : 0);
        receiverAndPermission = (receiverAndPermission<<64)|uint(p.expiryTime);
        (uint _priceToSTBT, uint _priceToSTBTUpdateTime, bool _sendEnanbled) = 
                  (priceToSTBT, priceToSTBTUpdateTime, sendEnanbled);
        uint priceAndUpdateTime = (_priceToSTBT<<64) | _priceToSTBTUpdateTime;
        require(_sendEnanbled, "CCWSTBT: SEND_DISABLED");
        return abi.encode(value, receiverAndPermission, priceAndUpdateTime);
    }

    function ccReceive(bytes calldata message) public onlyMessager {
        (uint value, uint receiverAndPermission, uint priceAndUpdateTime) = 
            abi.decode(message, (uint, uint, uint));
        Permission memory p;
        p.expiryTime = uint64(receiverAndPermission);
        p.receiveAllowed = uint8(receiverAndPermission>>64) != 0;
        p.sendAllowed = uint8(receiverAndPermission>>72) != 0;
        address receiver = address(uint160(receiverAndPermission>>80));
        uint64 _priceToSTBTUpdateTime = uint64(priceAndUpdateTime);
        uint128 _priceToSTBT = uint128(priceAndUpdateTime>>64);
        
        if(value != 0) {
            if(localForbidden[receiver]) {
                receiver = owner();
            }
            _mint(receiver, value);
        }
        if(!localForbidden[receiver]) {
            permissions[receiver] = p;
        }
        
        if(_priceToSTBTUpdateTime > priceToSTBTUpdateTime) {
            (priceToSTBT, priceToSTBTUpdateTime) = (_priceToSTBT, _priceToSTBTUpdateTime);
        }
    }
}

