// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import "./interfaces/ISTBT.sol";
import "./CCWSTBTMessager.sol";

contract CCWSTBT is ERC20Permit, Ownable, ICCIPClient {
    address public messager;
    address public controller;
    mapping(address => Permission) public permissions; // Address-transfer permissions
    mapping(address => bool) public localForbidden; // forbidden accounts locally, despite global permission

    uint128 public priceToSTBT;
    uint64 public priceToSTBTUpdateTime;
    bool public sendEnabled;

    event ControllerTransfer(
        address indexed _from,
        address indexed _to,
        uint256 _value,
        bytes _data,
        bytes _operatorData
    );

    constructor(string memory name_, string memory symbol_)
                ERC20Permit(name_) ERC20(name_, symbol_) {}

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

    function setSendEnabled(bool b) public onlyOwner {
        sendEnabled = b;
    }

    function transfer(address _recipient, uint256 _amount) public override returns (bool) {
        _checkSendPermission(msg.sender);
        _checkReceivePermission(_recipient);
        require(!localForbidden[msg.sender] && !localForbidden[_recipient], "CCWSTBT: FORBIDDEN");
        return super.transfer(_recipient, _amount);
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public override returns (bool) {
        _checkSendPermission(_sender);
        _checkReceivePermission(_recipient);
        require(!localForbidden[_sender] && !localForbidden[_recipient], "CCWSTBT: FORBIDDEN");
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
        emit ControllerTransfer(_from, _to, _value, _data, _operatorData);
    }

    // a cc-message always contains the value, the receiver, the sender
    function ccSend(address sender, address receiver, uint256 value) public onlyMessager returns (bytes memory message) {
        require(sendEnabled, "CCWSTBT: SEND_DISABLED");
        require(value != 0, "CCWSTBT: ZERO_VALUE_FORBIDDEN");
        require(!localForbidden[sender], "CCWSTBT: SENDER_FORBIDDEN");
        require(!localForbidden[receiver], "CCWSTBT: RECEIVER_FORBIDDEN");
        _checkReceivePermission(receiver);
        _burn(sender, value);
        return getCcSendData(sender, receiver, value);
    }

    function getCcSendData(address sender, address receiver, uint256 value) public pure returns (bytes memory message) {
        return abi.encode(sender, receiver, value);
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

        if(!localForbidden[receiver]) {
            permissions[receiver] = p;
        }
        if(value != 0) {
            if(localForbidden[receiver]) {
                receiver = owner();
            }
            _mint(receiver, value);
        }

        if(_priceToSTBTUpdateTime > priceToSTBTUpdateTime) {
            (priceToSTBT, priceToSTBTUpdateTime) = (_priceToSTBT, _priceToSTBTUpdateTime);
        }
    }
}

