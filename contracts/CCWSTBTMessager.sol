// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {OwnerIsCreator} from "@chainlink/contracts-ccip/src/v0.8/shared/access/OwnerIsCreator.sol";

interface ICCIPClient {
    function getCcSendData(address receiver, uint256 value) external view returns (bytes memory message);

    function ccSend(address sender, address recipient, uint256 value) external returns (bytes memory message);

    function ccReceive(bytes calldata message) external;
}

contract CCWSTBTMessager is CCIPReceiver, OwnerIsCreator {
    ICCIPClient public ccipClient;

    mapping(uint64 => mapping(address => bool)) public allowedPeer;

    event AllowedPeer(uint64 chainSelector, address messager, bool allowed);

    error NotAllowlisted(uint64 chainSelector, address messager);

    constructor(
        address _router,
        address _ccipClient
    ) CCIPReceiver(_router) {
        ccipClient = ICCIPClient(_ccipClient);
    }

    function setAllowedPeer(uint64 chainSelector, address messager, bool allowed) external onlyOwner {
        allowedPeer[chainSelector][messager] = allowed;
    }

    function _ccipReceive(
        Client.Any2EVMMessage memory any2EvmMessage
    ) internal override {
        address sender = abi.decode(any2EvmMessage.sender, (address));
        if (!allowedPeer[any2EvmMessage.sourceChainSelector][sender]) {
            revert NotAllowlisted(any2EvmMessage.sourceChainSelector, sender);
        }

        bytes memory message = abi.decode(any2EvmMessage.data, (bytes));
        ccipClient.ccReceive(message);
    }

    function calculateFeeAndMessage(
        uint64 destinationChainSelector,
        address messageReceiver,
        address recipient,
        uint value
    ) public view returns (uint256 fee, Client.EVM2AnyMessage memory evm2AnyMessage) {
        bytes memory data = ccipClient.getCcSendData(recipient, value);
        evm2AnyMessage = Client.EVM2AnyMessage({
        receiver : abi.encode(messageReceiver),
        data : data,
        tokenAmounts : new Client.EVMTokenAmount[](0),
        extraArgs : Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit : 200_000})
            ),
        feeToken : address(0)
        });
        fee = IRouterClient(getRouter()).getFee(destinationChainSelector, evm2AnyMessage);
    }

    function transferToChain(
        uint64 destinationChainSelector,
        address messageReceiver,
        address recipient,
        uint value
    ) external payable returns (bytes32 messageId) {
        if (!allowedPeer[destinationChainSelector][messageReceiver]) {
            revert NotAllowlisted(destinationChainSelector, messageReceiver);
        }
        bytes memory data = ccipClient.ccSend(msg.sender, recipient, value);
        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
        receiver : abi.encode(messageReceiver),
        data : data,
        tokenAmounts : new Client.EVMTokenAmount[](0),
        extraArgs : Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit : 200_000})),
        feeToken : address(0)
        });
        uint256 fee = IRouterClient(getRouter()).getFee(destinationChainSelector, evm2AnyMessage);
        require(msg.value >= fee, "Insufficient funds");
        messageId = IRouterClient(getRouter()).ccipSend{value : fee}(
            destinationChainSelector,
            evm2AnyMessage
        );
        if (msg.value - fee > 0) {
            bool success = payable(msg.sender).send(msg.value - fee);
            require(success, "Transfer failed");
        }
        return messageId;
    }
}
