const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const {anyValue} = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const {expect} = require("chai");
const {ethers} = require("hardhat");

// EIP-1066 status code
const Success = 0x01;
const UpperLimit = 0x06;
const PermissionRequested = 0x13;
const RevokedOrBanned = 0x16;

const CANNOT_SEND = ethers.utils.formatBytes32String('CANNOT_SEND');
const CANNOT_RECEIVE = ethers.utils.formatBytes32String('CANNOT_RECEIVE');
const SHARES_NOT_ENOUGH = ethers.utils.formatBytes32String('SHARES_NOT_ENOUGH');
const ALLOWANCE_NOT_ENOUGH = ethers.utils.formatBytes32String('ALLOWANCE_NOT_ENOUGH');
const ZERO_BYTES32 = ethers.utils.formatBytes32String('');

const zeroAddr = '0x0000000000000000000000000000000000000000';


describe("CCWSTBT", function () {

    async function deployStbtFixture() {
        // Contracts are deployed using the first signer/account by default
        const [owner, issuer, controller, moderator, messager, alice, bob, cindy] = await ethers.getSigners();

        const STBT = await ethers.getContractFactory("STBT");
        let stbt = await STBT.deploy();
        await stbt.setIssuer(issuer.address);
        await stbt.setController(controller.address);
        await stbt.setModerator(moderator.address);

        let WSTBT = await ethers.getContractFactory("WSTBT");
        let wstbt = await WSTBT.deploy("WSTBT", "WSTBT", stbt.address);

        let WSTBTBridge = await ethers.getContractFactory("WSTBTBridge");
        let bridge = await WSTBTBridge.deploy(stbt.address, wstbt.address);
        await bridge.setMessager(messager.address);

        let CCWSTBT = await ethers.getContractFactory("CCWSTBT");
        let ccwstbt = await CCWSTBT.deploy("CCWSTBT", "CCWSTBT", messager.address);

        return {stbt, wstbt, bridge, ccwstbt, owner, issuer, controller, moderator, messager, alice, bob, cindy};
    }

    it("mainToSideSend-disabled", async function () {
        const {bridge, messager, alice, bob} = await loadFixture(deployStbtFixture);

        await expect(bridge.connect(messager).ccSend(alice.address, bob.address, 1000))
            .to.be.revertedWith("WSTBTBridge: SEND_DISABLED");
    });

    it("mainToSideSend-noReceivePermission", async function () {
        const {bridge, messager, alice, bob} = await loadFixture(deployStbtFixture);
        await bridge.setSendEnabled(true);
        await expect(bridge.connect(messager).ccSend(alice.address, bob.address, 1000))
            .to.be.revertedWith("WSTBTBridge: NO_RECEIVE_PERMISSION");
    });

    it("cc", async function () {
        const {stbt, wstbt, bridge, ccwstbt, issuer, owner, controller, moderator, messager, alice, bob} = await loadFixture(deployStbtFixture);
        await stbt.connect(moderator).setPermission(bob.address, [true, true, 0])
        await stbt.connect(moderator).setPermission(alice.address, [true, true, 0])
        await stbt.connect(moderator).setPermission(wstbt.address, [true, true, 0])
        await stbt.connect(moderator).setPermission(bridge.address, [true, true, 0])
        await stbt.connect(issuer).issue(alice.address, 1000000, '0x');
        expect(await stbt.balanceOf(alice.address)).to.equal(1000000);
        await stbt.connect(alice).approve(wstbt.address, 1000000);
        await wstbt.connect(alice).wrap(1000000);
        expect(await wstbt.balanceOf(alice.address)).to.equal(1000000);

        await bridge.setSendEnabled(true);
        // send success
        await wstbt.connect(alice).approve(bridge.address, 1000000);
        let res = await bridge.connect(messager).ccSend(alice.address, bob.address, 1000);
        expect(await wstbt.balanceOf(bridge.address)).to.equal(1000);

        let msg = await bridge.getCcSendData(alice.address, bob.address, 1000);
        await ccwstbt.connect(messager).ccReceive(msg);
        expect(await ccwstbt.balanceOf(bob.address)).to.equal(1000);
        expect(await ccwstbt.permissions(bob.address)).to.deep.equal([true,true,0]);
        let b = await ethers.provider.getBlock(res.blockNumber);
        expect(await ccwstbt.priceToSTBTUpdateTime()).to.equal(b.timestamp);

        // receiver local forbidden
        await ccwstbt.connect(owner).setController(controller.address);
        await ccwstbt.connect(controller).setForbidden(bob.address, true);
        await stbt.connect(moderator).setPermission(bob.address, [false, true, 0])
        res = await bridge.connect(messager).ccSend(alice.address, bob.address, 1000);
        expect(await wstbt.balanceOf(bridge.address)).to.equal(2000);
        expect(await wstbt.balanceOf(alice.address)).to.equal(1000000 - 2000);
        msg = await bridge.getCcSendData(alice.address, bob.address, 1000);
        await ccwstbt.connect(messager).ccReceive(msg);
        expect(await ccwstbt.balanceOf(owner.address)).to.equal(1000);
        expect(await ccwstbt.permissions(bob.address)).to.deep.equal([true,true,0]);
        b = await ethers.provider.getBlock(res.blockNumber);
        expect(await ccwstbt.priceToSTBTUpdateTime()).to.equal(b.timestamp);

        // local forbidden cannot send token
        await ccwstbt.connect(controller).setPermission(alice.address, [true, true, 0]);
        await expect(ccwstbt.connect(bob).transfer(alice.address, 1000)).to.be.revertedWith("CCWSTBT: FORBIDDEN");

        // controller transfer
        await ccwstbt.connect(controller).controllerTransfer(owner.address, bob.address, 1000, '0x','0x');
        expect(await ccwstbt.balanceOf(owner.address)).to.equal(0);
        expect(await ccwstbt.balanceOf(bob.address)).to.equal(2000);

        // local forbidden cannot ccSend
        await expect(ccwstbt.connect(messager).ccSend(bob.address, alice.address, 1000)).to.be.revertedWith("CCWSTBT: SENDER_FORBIDDEN");

        // local forbidden receiver cannot ccSend
        await ccwstbt.connect(controller).setForbidden(alice.address, true);
        await ccwstbt.connect(controller).setForbidden(bob.address, false);
        await expect(ccwstbt.connect(messager).ccSend(bob.address, alice.address, 1000)).to.be.revertedWith("CCWSTBT: RECEIVER_FORBIDDEN");

        // side to main cc：sender not sendAllowed
        await ccwstbt.connect(controller).setForbidden(alice.address, false);
        await stbt.connect(moderator).setPermission(bob.address, [false, true, 0])
        await stbt.connect(moderator).setPermission(owner.address, [true, true, 0])
        await ccwstbt.connect(messager).ccSend(bob.address, alice.address, 1000);
        expect(await ccwstbt.balanceOf(bob.address)).to.equal(1000);
        msg = await ccwstbt.getCcSendData(bob.address, alice.address, 1000);
        await bridge.connect(messager).ccReceive(msg);
        expect(await wstbt.balanceOf(alice.address)).to.equal(1000000 - 2000);
        expect(await wstbt.balanceOf(bridge.address)).to.equal(1000);
        expect(await wstbt.balanceOf(owner.address)).to.equal(1000);

        // side to main, but receiver not has correct permission
        await stbt.connect(moderator).setPermission(bob.address, [true, true, 0])
        await stbt.connect(moderator).setPermission(alice.address, [true, false, 0])
        await ccwstbt.connect(messager).ccSend(bob.address, alice.address, 500);
        expect(await ccwstbt.balanceOf(bob.address)).to.equal(500);
        msg = await ccwstbt.getCcSendData(bob.address, alice.address, 500);
        await bridge.connect(messager).ccReceive(msg);
        expect(await wstbt.balanceOf(alice.address)).to.equal(1000000 - 2000);
        expect(await wstbt.balanceOf(bridge.address)).to.equal(500);
        expect(await wstbt.balanceOf(owner.address)).to.equal(1500);

        // normal send
        await stbt.connect(moderator).setPermission(alice.address, [true, true, 0])
        await ccwstbt.connect(messager).ccSend(bob.address, alice.address, 500);
        expect(await ccwstbt.balanceOf(bob.address)).to.equal(0);
        msg = await ccwstbt.getCcSendData(bob.address, alice.address, 500);
        await bridge.connect(messager).ccReceive(msg);
        expect(await wstbt.balanceOf(alice.address)).to.equal(1000000 - 1500);
        expect(await wstbt.balanceOf(bridge.address)).to.equal(0);
        expect(await wstbt.balanceOf(owner.address)).to.equal(1500);
    });
});


