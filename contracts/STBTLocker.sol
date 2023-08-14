// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@arbitrum/nitro-contracts/src/bridge/Inbox.sol";
import "@arbitrum/nitro-contracts/src/bridge/Outbox.sol";

import "./interfaces/ISTBT.sol";
import "./STBTLockerBase.sol";

// based on: https://developer.arbitrum.io/for-devs/cross-chain-messsaging#ethereum-to-arbitrum-messaging

contract STBTLocker is STBTLockerBase {
    IInbox public inbox;
    address public guestTarget;

    event RetryableTicketCreated(uint256 indexed ticketId);

    modifier onlyController() {
        require(msg.sender == ISTBT(stbtAddress).controller(), 'WSTBT: NOT_CONTROLLER');
        _;
    }

    modifier onlyFromGuest() {
        IBridge bridge = inbox.bridge();
        // this prevents reentrancies on L2 to L1 txs
        require(msg.sender == address(bridge), "NOT_BRIDGE");
        IOutbox outbox = IOutbox(bridge.activeOutbox());
        address guestSender = outbox.l2ToL1Sender();
        require(guestSender == guestTarget, "NOT_GUEST_TARGET");
        _;
    }

    constructor(address _stbtAddress, address _inbox) STBTLockerBase(_stbtAddress) {
        inbox = IInbox(_inbox);
    }

    function setGuestTarget(address _guestTarget) onlyController public {
        guestTarget = _guestTarget;
    }

    function ccRebase(uint maxSubmissionCost, uint maxGas,
                      uint gasPriceBid) public payable returns (uint) {
        bytes memory data = _ccRebase();
        return ccCreateTicket(data, maxSubmissionCost, maxGas, gasPriceBid);
    }

    function ccSetPermission(address account, uint maxSubmissionCost, uint maxGas,
                             uint gasPriceBid) public payable returns (uint) {
        bytes memory data = _ccSetPermission(account);
        return ccCreateTicket(data, maxSubmissionCost, maxGas, gasPriceBid);
    }

    function ccLock(uint amount, uint maxSubmissionCost, uint maxGas,
                    uint gasPriceBid) public payable returns (uint) {
        bytes memory data = _ccLock(amount);
        return ccCreateTicket(data, maxSubmissionCost, maxGas, gasPriceBid);
    }

    function ccCreateTicket(bytes memory data,uint maxSubmissionCost,
                            uint maxGas, uint gasPriceBid) internal returns (uint) {
        uint256 ticketID = inbox.createRetryableTicket{ value: msg.value }(
            guestTarget,
            0,
            maxSubmissionCost,
            msg.sender,
            msg.sender,
            maxGas,
            gasPriceBid,
            data
        );

        emit RetryableTicketCreated(ticketID);
        return ticketID;
    }
    
    function ccRelease(address _recipient, uint256 _shares) onlyFromGuest public {
        _ccRelease(_recipient, _shares);
    }
}
