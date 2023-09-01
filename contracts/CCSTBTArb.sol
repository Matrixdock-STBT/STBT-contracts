// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./CCSTBTBase.sol";
import "./CCSTBTArbBase.sol";

contract CCSTBTArb is CCSTBTArbBase {

    function initialize(
        address _owner, address _target, uint256 _totalSupply, uint256 _totalShares) public {
        require(ethereumTarget == address(0), "already initialized");
        _transferOwnership(_owner);
        ethereumTarget = _target;
        _rebase(_totalSupply, _totalShares);
    }

    function getArbSys() override public pure returns (address) {
        return address(100);
    }
}

contract CCSTBTArbForUT is CCSTBTArbBase {
    address public arbsys;

    function initialize(
        address _owner,
        address _arbSys, address _target, uint256 _totalSupply, uint256 _totalShares) public {
        require(ethereumTarget == address(0), "already initialized");
        _transferOwnership(_owner);
        arbsys = _arbSys;
        ethereumTarget = _target;
        _rebase(_totalSupply, _totalShares);
    }

    function getArbSys() override public view returns (address) {
        return address(arbsys);
    }
}
