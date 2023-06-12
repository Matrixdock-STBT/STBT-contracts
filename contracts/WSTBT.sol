// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import "./interfaces/ISTBT.sol";

contract UpgradeableWSTBT is Proxy {
    address public implementation;

    constructor(address _impl) {
        implementation = _impl;
    }

    function resetImplementation(address _impl) external {
        require(msg.sender == Ownable(implementation).owner(), "WSTBT: NOT_OWNER");
        implementation = _impl;
    }

    function _implementation() internal view override returns (address) {
        return implementation;
    }
}

contract WSTBT is ERC20Permit {
    address constant public stbtAddress = 0x530824DA86689C9C17CdC2871Ff29B058345b44a;

    uint[300] public placeholders;

    uint256 private _totalSupply;
    mapping(address => uint256) private shares;
    mapping(address => mapping(address => uint256)) private allowances;

    event Wrap(address indexed sender, uint stbtAmount, uint shares);
    event Unwrap(address indexed sender, uint stbtAmount, uint shares);

    event ControllerTransfer(
        address _controller,
        address indexed _from,
        address indexed _to,
        uint256 _value,
        bytes _data,
        bytes _operatorData
    );

    constructor(string memory name_, string memory symbol_) ERC20Permit(name_) ERC20(name_, symbol_) {
    }

    modifier onlyController() {
        require(msg.sender == ISTBT(stbtAddress).controller(), 'WSTBT: NOT_CONTROLLER');
        _;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address _account) public override view returns (uint256) {
        return shares[_account];
    }

    function transfer(address _recipient, uint256 _amount) public override returns (bool) {
        _transferWithCheck(msg.sender, _recipient, _amount);
        return true;
    }

    function allowance(address _owner, address _spender) public override view returns (uint256) {
        return allowances[_owner][_spender];
    }

    function approve(address _spender, uint256 _amount) public override returns (bool) {
        _approve(msg.sender, _spender, _amount);
        return true;
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public override returns (bool) {
        uint256 currentAllowance = allowances[_sender][msg.sender];
        require(currentAllowance >= _amount, "WSTBT: TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE");

        _transferWithCheck(_sender, _recipient, _amount);
        _approve(_sender, msg.sender, currentAllowance - _amount);
        return true;
    }

    function increaseAllowance(address _spender, uint256 _addedValue) public override returns (bool) {
        _approve(msg.sender, _spender, allowances[msg.sender][_spender] + _addedValue);
        return true;
    }

    function decreaseAllowance(address _spender, uint256 _subtractedValue) public override returns (bool) {
        uint256 currentAllowance = allowances[msg.sender][_spender];
        require(currentAllowance >= _subtractedValue, "WSTBT: DECREASED_ALLOWANCE_BELOW_ZERO");
        _approve(msg.sender, _spender, currentAllowance - _subtractedValue);
        return true;
    }

    function _transferWithCheck(address _sender, address _recipient, uint256 _amount) internal {
        _checkSendPermission(_sender);
        _checkReceivePermission(_recipient);
        _transfer(_sender, _recipient, _amount);
    }

    function _checkSendPermission(address _sender) private view {
        (bool sendAllowed, , uint64 expiryTime) = ISTBT(stbtAddress).permissions(_sender);
        require(sendAllowed, 'WSTBT: NO_SEND_PERMISSION');
        require(expiryTime == 0 || expiryTime > block.timestamp, 'WSTBT: SEND_PERMISSION_EXPIRED');
    }

    function _checkReceivePermission(address _recipient) private view {
        (, bool receiveAllowed, uint64 expiryTime) = ISTBT(stbtAddress).permissions(_recipient);
        require(receiveAllowed, 'WSTBT: NO_RECEIVE_PERMISSION');
        require(expiryTime == 0 || expiryTime > block.timestamp, 'WSTBT: RECEIVE_PERMISSION_EXPIRED');
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) internal override {
        shares[_sender] -= _amount;
        shares[_recipient] += _amount;
        emit Transfer(_sender, _recipient, _amount);
    }

    function _approve(address _owner, address _spender, uint256 _amount) internal override {
        allowances[_owner][_spender] = _amount;
        emit Approval(_owner, _spender, _amount);
    }

    function controllerTransfer(address _from, address _to, uint256 _value, bytes calldata _data, bytes calldata _operatorData) external onlyController {
        _transfer(_from, _to, _value);
        emit ControllerTransfer(msg.sender, _from, _to, _value, _data, _operatorData);
    }

    function _mint(address account, uint256 amount) internal override {
        _totalSupply += amount;
        shares[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal override {
        _totalSupply -= amount;
        shares[account] -= amount;
        emit Transfer(account, address(0), amount);
    }

    function wrap(uint256 stbtAmount) public returns (uint wrappedShares) {
        require(stbtAmount != 0, "WSTBT: ZERO_AMOUNT");
        wrappedShares = ISTBT(stbtAddress).getSharesByAmount(stbtAmount);
        ISTBT(stbtAddress).transferFrom(msg.sender, address(this), stbtAmount);
        _mint(msg.sender, wrappedShares);
        emit Wrap(msg.sender, stbtAmount, wrappedShares);
    }

    function unwrap(uint256 unwrappedShares) public returns (uint stbtAmount) {
        require(unwrappedShares != 0, "WSTBT: ZERO_AMOUNT");
        stbtAmount = ISTBT(stbtAddress).getAmountByShares(stbtAmount);
        ISTBT(stbtAddress).transfer(msg.sender, stbtAmount);
        _burn(msg.sender, unwrappedShares);
        emit Unwrap(msg.sender, stbtAmount, unwrappedShares);
    }

    function getWstbtByStbt(uint256 stbtAmount) external view returns (uint256) {
        return ISTBT(stbtAddress).getSharesByAmount(stbtAmount);
    }
    function getStbtByWstbt(uint256 wstbtAmount) external view returns (uint256) {
        return ISTBT(stbtAddress).getAmountByShares(wstbtAmount);
    }
    function stbtPerToken() external view returns (uint256) {
        return ISTBT(stbtAddress).getAmountByShares(1 ether);
    }
    function tokensPerStbt() external view returns (uint256) {
        return ISTBT(stbtAddress).getSharesByAmount(1 ether);
    }
}


