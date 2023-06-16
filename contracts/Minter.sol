// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import "./interfaces/ISTBT.sol";
import "./interfaces/IStbtTimelockController.sol";

contract Minter is Ownable {
	using EnumerableMap for EnumerableMap.AddressToUintMap;

	struct DepositConfig {
		bool   needDivAdjust;
		uint96 adjustUnit;
		uint96 minimumDepositAmount;
	}
	
	struct RedeemConfig {
		bool   needDivAdjust;
		uint96 adjustUnit;
		uint96 minimumRedeemAmount;
	}
	
	address public timeLockContract;
	address public targetContract;
	address public poolAccount;
	uint public nonceForMint;
	uint public nonceForRedeem;
	mapping(address => DepositConfig) public depositConfigMap;
	mapping(address => RedeemConfig) public redeemConfigMap;
	mapping(address => uint) public redeemFeeRateMap;
	mapping(uint => address) public redeemTargetMap;
	uint public depositPeriod;
	uint public redeemPeriod;
	EnumerableMap.AddressToUintMap private purchaseInfoMap;
	
	uint private constant UNIT = 10**18;

	event Mint(address indexed requestor, address indexed token, uint indexed nonce,
		   uint depositAmount, uint proposeAmount, bytes32 salt, bytes data);
	event Redeem(address indexed requestor, address indexed token, uint indexed nonce, uint amount,
		    bytes32 salt, bytes data);
	event Settle(address indexed target, uint amount, bytes32 redeemTxId,
		     uint redeemServiceFeeRate, uint executionPrice);

	constructor(address _timeLockContract, address _targetContract, address _poolAccount) Ownable() {
		timeLockContract = _timeLockContract;
		targetContract = _targetContract;
		poolAccount = _poolAccount;
	}

	function setCoinInfo(address token, uint receiverAndRate) onlyOwner external {
		purchaseInfoMap.set(token, receiverAndRate);
	}

	function getCoinInfo(address coin) external view returns (uint) {
		return purchaseInfoMap.get(coin);
	}

	function getCoinsInfo() external view returns (address[] memory coinList, uint[] memory receiverAndRateList) {
		coinList = new address[](purchaseInfoMap.length());
		receiverAndRateList = new uint[](purchaseInfoMap.length());
		for(uint i=0; i<coinList.length; i++) {
			(address coin, uint reveiverAndRate) = purchaseInfoMap.at(i);
			coinList[i] = coin;
			receiverAndRateList[i] = reveiverAndRate;
		}
	}

	function setDepositConfig(address token, DepositConfig calldata config) onlyOwner external {
		depositConfigMap[token] = config;
	}

	function setRedeemConfig(address token, RedeemConfig calldata config) onlyOwner external {
		redeemConfigMap[token] = config;
	}

	function setRedeemFeeRate(address token, uint r) onlyOwner external {
		redeemFeeRateMap[token] = r;
	}

	function setDepositPeriod(uint p) onlyOwner external {
		depositPeriod = p;
	}

	function setRedeemPeriod(uint p) onlyOwner external {
		redeemPeriod = p;
	}

	function setTimeLockContract(address _timeLockContract) onlyOwner external {
		timeLockContract = _timeLockContract;
	}

	function setTargetContract(address _targetContract) onlyOwner external {
		targetContract = _targetContract;
	}

	function setPoolAccount(address _poolAccount) onlyOwner external {
		poolAccount = _poolAccount;
	}

	// token: which token to deposit?
	// depositAmount: how much to deposit?
	// minProposedAmount: the sender use this value to protect against sudden rise of feeRate
	// salt: a random number that can affect TimelockController's input salt
	// extraData: will be used to call STBT's issue functions
	function mint(address token, uint depositAmount, uint minProposedAmount, bytes32 salt,
		      bytes calldata extraData) external {
		{
		(, bool receiveAllowed, uint64 expiryTime) = ISTBT(targetContract).permissions(msg.sender);
		require(receiveAllowed, 'MINTER: NO_RECEIVE_PERMISSION');
		require(expiryTime == 0 || expiryTime > block.timestamp, 'MINTER: RECEIVE_PERMISSION_EXPIRED');
		}

		uint receiverAndRate = purchaseInfoMap.get(token);
		require(receiverAndRate != 0, "MINTER: TOKEN_NOT_SUPPORTED");
		address receiver = address(uint160(receiverAndRate>>96));
		uint feeRate = uint96(receiverAndRate);
		DepositConfig memory config = depositConfigMap[token];
		require(depositAmount >= config.minimumDepositAmount, "MINTER: DEPOSIT_AMOUNT_TOO_SMALL");
		uint proposeAmount = depositAmount*(UNIT-feeRate)/UNIT;
		proposeAmount = config.needDivAdjust? proposeAmount / config.adjustUnit : proposeAmount * config.adjustUnit;
		require(proposeAmount >= minProposedAmount, "MINTER: PROPOSE_AMOUNT_TOO_SMALL");
		IERC20(token).transferFrom(msg.sender, receiver, depositAmount);
		bytes memory data = abi.encodeWithSignature("issue(address,uint256,bytes)",
							    msg.sender, proposeAmount, extraData);
		salt = keccak256(abi.encodePacked(salt, nonceForMint));
		nonceForMint = nonceForMint + 1;
		IStbtTimelockController(timeLockContract).schedule(targetContract, 0, data, bytes32(""), salt, 0);
		emit Mint(msg.sender, token, nonceForMint, depositAmount, proposeAmount, salt, data);
	}

	// token: which token to receive after redeem?
	// amount: how much STBT to deposit?
	// salt: a random number that can affect TimelockController's input salt
	// extraData: will be used to call STBT's issue functions
	function redeem(uint amount, address token, bytes32 salt, bytes calldata extraData) external {
		RedeemConfig memory config = redeemConfigMap[token];
		require(amount >= config.minimumRedeemAmount, "MINTER: REDEEM_AMOUNT_TOO_SMALL");
		amount = config.needDivAdjust? amount / config.adjustUnit : amount * config.adjustUnit;
		bytes memory data = abi.encodeWithSignature("redeemFrom(address,uint256,bytes)",
							    poolAccount, amount, extraData);
		IERC20(targetContract).transferFrom(msg.sender, poolAccount, amount);
		salt = keccak256(abi.encodePacked(salt, nonceForRedeem));
		IStbtTimelockController(timeLockContract).schedule(targetContract, 0, data, bytes32(""), salt, 0);
		redeemTargetMap[nonceForRedeem] = msg.sender;
		emit Redeem(msg.sender, token, nonceForRedeem, amount, salt, data);
		nonceForRedeem = nonceForRedeem + 1;
	}

	// token: which token to refund the customer?
	// amount: how much to refund?
	// nonce: the nonce assigned to this redeem operation
	// redeemTxId: at which tx did the customer call 'redeem'?
	// redeemServiceFeeRate: some of the refunded tokens will be deducted as fee
	// executionPrice: the price of STBT measure by 'token'
	function redeemSettle(address token, uint amount, uint nonce, bytes32 redeemTxId,
			      uint redeemServiceFeeRate, uint executionPrice) onlyOwner external {
		address target = redeemTargetMap[nonce];
		require(target != address(0), "MINTER: NULL_TARGET");
		IERC20(token).transfer(target, amount);
		emit Settle(target, amount, redeemTxId, redeemServiceFeeRate, executionPrice);
		delete redeemTargetMap[nonce];
	}

	// the rescue ETH or ERC20 tokens which were accidentally sent to this contract
	function rescue(address token, address receiver, uint amount) onlyOwner external {
		require(redeemTargetMap[nonceForRedeem-1] == address(0), "MINTER: PENDING_REDEEM");
		if(token == address(0)) {
			(bool success,) = receiver.call{value : amount}(new bytes(0));
			require(success, "MINTER: FAIL_TO_RESCUE_ETH");
		} else {
			IERC20(token).transfer(receiver, amount);
		}
	}
}
