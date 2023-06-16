const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const {ethers} = require("hardhat");

// EIP-1066 status code
const Success             = 0x01;
const UpperLimit          = 0x06;
const PermissionRequested = 0x13;
const RevokedOrBanned     = 0x16;

const CANNOT_SEND          = ethers.utils.formatBytes32String('CANNOT_SEND');
const CANNOT_RECEIVE       = ethers.utils.formatBytes32String('CANNOT_RECEIVE');
const SHARES_NOT_ENOUGH    = ethers.utils.formatBytes32String('SHARES_NOT_ENOUGH');
const ALLOWANCE_NOT_ENOUGH = ethers.utils.formatBytes32String('ALLOWANCE_NOT_ENOUGH');
const ZERO_BYTES32         = ethers.utils.formatBytes32String('');

const zeroAddr = '0x0000000000000000000000000000000000000000';


describe("STBT", function () {

  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployStbtFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, issuer, controller, moderator, alice, bob, cindy] = await ethers.getSigners();

    const STBT = await ethers.getContractFactory("STBT");
    let stbt = await STBT.deploy();
    // await stbt.setIssuer(issuer.address);
    // await stbt.setController(controller.address);
    // await stbt.setModerator(moderator.address);

    const Proxy = await ethers.getContractFactory("UpgradeableSTBT");
    const proxy = await Proxy.deploy(owner.address, issuer.address, controller.address, moderator.address, stbt.address);
    stbt = stbt.attach(proxy.address);

    return { stbt, proxy, owner, issuer, controller, moderator, alice, bob, cindy };
  }

  describe("UpgradeableSTBT", function () {

    it("resetImplementation: NOT_OWNER", async function () {
      const { proxy, owner, alice } = await loadFixture(deployStbtFixture);

      await expect(proxy.connect(alice).resetImplementation(alice.address))
        .to.be.revertedWith("STBT: NOT_OWNER");
    });

    it("resetImplementation: ok", async function () {
      const { proxy, owner, alice } = await loadFixture(deployStbtFixture);

      proxy.connect(owner).resetImplementation(alice.address);
      expect(await proxy.implementation()).to.equal(alice.address);
    });

  });

  describe("STBT", function () {

    it("owner-only-ops", async function () {
      const { stbt, alice } = await loadFixture(deployStbtFixture);

      await expect(stbt.connect(alice).setIssuer(alice.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
      await expect(stbt.connect(alice).setController(alice.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
      await expect(stbt.connect(alice).setModerator(alice.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
      await expect(stbt.connect(alice).setMinDistributeInterval(123))
        .to.be.revertedWith("Ownable: caller is not the owner");
      await expect(stbt.connect(alice).setMaxDistributeRatio(456))
        .to.be.revertedWith("Ownable: caller is not the owner");
      await expect(stbt.connect(alice).transferOwnership(alice.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("transferOwnership", async function () {
      const { stbt, owner, alice } = await loadFixture(deployStbtFixture);
      expect(await stbt.owner()).to.equal(owner.address);

      await expect(stbt.connect(owner).transferOwnership(alice.address))
        .to.emit(stbt, "OwnershipTransferred").withArgs(owner.address, alice.address);
      expect(await stbt.owner()).to.equal(alice.address);
    });

    it("setPermission: NOT_MODERATOR", async function () {
      const { stbt, moderator, alice } = await loadFixture(deployStbtFixture);

      await expect(stbt.connect(alice).setPermission(alice.address, [true, true, 0]))
        .to.be.revertedWith("STBT: NOT_MODERATOR");
    });

    it("setPermission: ok", async function () {
      const { stbt, moderator, alice } = await loadFixture(deployStbtFixture);
      expect(await stbt.permissions(alice.address)).to.deep.equal([false, false, 0]);

      await stbt.connect(moderator).setPermission(alice.address, [true, true, 12345]);
      expect(await stbt.permissions(alice.address)).to.deep.equal([true, true, 12345]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 23456]);
      expect(await stbt.permissions(alice.address)).to.deep.equal([true, false, 23456]);

      await stbt.connect(moderator).setPermission(alice.address, [false, true, 34567]);
      expect(await stbt.permissions(alice.address)).to.deep.equal([false, true, 34567]);

      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);
      expect(await stbt.permissions(alice.address)).to.deep.equal([false, false, 0]);
    });

  });

  describe("ERC20", function () {

    it("metadata", async function () {
      const { stbt } = await loadFixture(deployStbtFixture);
      expect(await stbt.name()).to.equal('Short-term Treasury Bill Token');
      expect(await stbt.symbol()).to.equal('STBT');
      expect(await stbt.decimals()).to.equal(18);
    });

    it("transfer: permissions checks", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('STBT: NO_SEND_PERMISSION');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 11111111]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('STBT: SEND_PERMISSION_EXPIRED');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 0]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('STBT: NO_RECEIVE_PERMISSION');

      const ts = await lastBlockTS();
      await stbt.connect(moderator).setPermission(alice.address, [true, false, ts + 100]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('STBT: NO_RECEIVE_PERMISSION');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 11111111]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('STBT: RECEIVE_PERMISSION_EXPIRED');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, ts + 100]);
      await stbt.connect(alice).transfer(bob.address, 123); // ok
    });

    it("transfer: events and balances", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');

      await expect(stbt.connect(alice).transfer(bob.address, 4000))
        .to.emit(stbt, "Transfer").withArgs(alice.address, bob.address, 4000)
        .to.emit(stbt, "TransferShares").withArgs(alice.address, bob.address, 4000);

      expect(await stbt.totalSupply()).to.equal(10000);
      expect(await stbt.balanceOf(alice.address)).to.equal(6000);
      expect(await stbt.balanceOf(bob.address)).to.equal(4000);
    });

    it("approve: events and allowances", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      expect(await stbt.allowance(bob.address, alice.address)).to.equal(0);
      expect(await stbt.allowance(alice.address, bob.address)).to.equal(0);

      await expect(stbt.connect(bob).approve(alice.address, 2000))
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 2000);
      expect(await stbt.allowance(bob.address, alice.address)).to.equal(2000);
      expect(await stbt.allowance(alice.address, bob.address)).to.equal(0);

      await expect(stbt.connect(bob).approve(alice.address, 5000))
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 5000);
      expect(await stbt.allowance(bob.address, alice.address)).to.equal(5000);
      expect(await stbt.allowance(alice.address, bob.address)).to.equal(0);
    });

    it("increase/decreaseAllowance", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);

      await expect(stbt.connect(bob).increaseAllowance(alice.address, 1000))
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 1000);
      await expect(stbt.connect(bob).increaseAllowance(alice.address, 2000))
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 3000);

      await expect(stbt.connect(bob).decreaseAllowance(alice.address, 500))
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 2500);
      await expect(stbt.connect(bob).decreaseAllowance(alice.address, 600))
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 1900);

      await expect(stbt.connect(bob).decreaseAllowance(alice.address, 1901))
        .to.be.revertedWith('STBT: DECREASED_ALLOWANCE_BELOW_ZERO');

      expect(await stbt.allowance(bob.address, alice.address)).to.equal(1900);
      expect(await stbt.allowance(alice.address, bob.address)).to.equal(0);
    });

    it("transferFrom: allowance checks", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');

      await expect(stbt.connect(alice).transferFrom(bob.address, cindy.address, 123))
        .to.be.revertedWith('STBT: TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');

      stbt.connect(bob).approve(alice.address, 122);
      await expect(stbt.connect(alice).transferFrom(bob.address, cindy.address, 123))
        .to.be.revertedWith('STBT: TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');
    });

    it("transferFrom: permissions checks", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);
      await stbt.connect(alice).approve(cindy.address, 128);

      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('STBT: NO_SEND_PERMISSION');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 11111111]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('STBT: SEND_PERMISSION_EXPIRED');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 0]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('STBT: NO_RECEIVE_PERMISSION');

      const ts = await lastBlockTS();
      await stbt.connect(moderator).setPermission(alice.address, [true, false, ts + 100]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('STBT: NO_RECEIVE_PERMISSION');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 11111111]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('STBT: RECEIVE_PERMISSION_EXPIRED');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, ts + 100]);
      stbt.connect(cindy).transferFrom(alice.address, bob.address, 123); // ok
    });

    it("transferFrom: events, balances and allowances", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(alice).approve(cindy.address, 2000);

      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 800))
        .to.emit(stbt, "Transfer").withArgs(alice.address, bob.address, 800)
        .to.emit(stbt, "TransferShares").withArgs(alice.address, bob.address, 800)
        .to.emit(stbt, "Approval").withArgs(alice.address, cindy.address, 1200);

      expect(await stbt.balanceOf(alice.address)).to.equal(9200);
      expect(await stbt.balanceOf(bob.address)).to.equal(800);
      expect(await stbt.allowance(alice.address, cindy.address)).to.equal(1200);
    });

  });

  describe("ERC1643", function () {

    it("setDocument: errors", async function () {
      const { stbt, owner, alice } = await loadFixture(deployStbtFixture);

      const invalidName = ethers.utils.formatBytes32String("");
      const docHash = ethers.utils.formatBytes32String("docAHash");
      await expect(stbt.connect(owner).setDocument(invalidName, 'uri', docHash))
        .to.be.revertedWith('STBT: INVALID_DOC_NAME');

      const docName = ethers.utils.formatBytes32String("docA");
      await expect(stbt.connect(owner).setDocument(docName, '', docHash))
        .to.be.revertedWith('STBT: INVALID_URL');
    });

    it("removeDocument: errors", async function () {
      const { stbt, owner, alice } = await loadFixture(deployStbtFixture);

      const docName = ethers.utils.formatBytes32String("docA");
      await expect(stbt.connect(owner).removeDocument(docName))
        .to.be.revertedWith('STBT: DOC_NOT_EXIST');
    });

    it("set&get&remove document", async function () {
      const { stbt, owner, alice } = await loadFixture(deployStbtFixture);
      const name = ethers.utils.formatBytes32String("docA");
      const uri = "docAUri";
      const docHash = ethers.utils.formatBytes32String("docAHash");
      // permission test
      await expect(stbt.connect(alice).setDocument(name, uri, docHash))
          .to.be.revertedWith('Ownable: caller is not the owner');
      // set and get document
      await stbt.connect(owner).setDocument(name, uri, docHash);
      expect(await stbt.getDocument(name)).to.deep.equal([uri, docHash, await lastBlockTS()]);
      // get documents
      const newUri = "docANewUri";
      await stbt.connect(owner).setDocument(name, newUri, docHash);
      expect(await stbt.getDocument(name)).to.deep.equal([newUri, docHash, await lastBlockTS()]);
      const nameB = ethers.utils.formatBytes32String("docB");
      const uriB = "docBUri";
      const docHashB = ethers.utils.formatBytes32String("docBHash");
      await stbt.connect(owner).setDocument(nameB, uriB, docHashB);
      expect(await stbt.getDocument(nameB)).to.deep.equal([uriB, docHashB, await lastBlockTS()]);
      expect(await stbt.getAllDocuments()).to.deep.equal([name, nameB]);
      // remove document
      await expect(stbt.connect(alice).removeDocument(name))
          .to.be.revertedWith('Ownable: caller is not the owner');
      await stbt.connect(owner).removeDocument(name);
      expect(await stbt.getAllDocuments()).to.deep.equal([nameB]);
    });

  });

  describe("ERC1594", function () {

    it("isIssuable", async function () {
      const { stbt } = await loadFixture(deployStbtFixture);
      expect(await stbt.isIssuable()).to.equal(true);
    });

    it("issue: errors", async function () {
      const { stbt, issuer, alice } = await loadFixture(deployStbtFixture);

      await expect(stbt.issue(alice.address, 123, '0x'))
        .to.be.revertedWith("STBT: NOT_ISSUER");

      await expect(stbt.connect(issuer).issue(zeroAddr, 123, '0x'))
        .to.be.revertedWith("STBT: MINT_TO_THE_ZERO_ADDRESS");

      await expect(stbt.connect(issuer).issue(alice.address, 123, '0x'))
        .to.be.revertedWith("STBT: NO_RECEIVE_PERMISSION");
    });

    it("issue: zero_value", async function () {
      const { stbt, issuer, alice, } = await loadFixture(deployStbtFixture);
      await stbt.connect(issuer).issue(alice.address, 0, '0x1234');
      await stbt.connect(issuer).issue(zeroAddr, 0, '0x1234');
    });

    it("issue: events", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);

      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await expect(stbt.connect(issuer).issue(alice.address, 123, '0x0a11ce'))
        .to.emit(stbt, "Issued").withArgs(issuer.address, alice.address, 123, '0x0a11ce')
        .to.emit(stbt, "Transfer").withArgs(zeroAddr, alice.address, 123);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await expect(stbt.connect(issuer).issue(bob.address, 456789, '0x0b0b'))
        .to.emit(stbt, "Issued").withArgs(issuer.address, bob.address, 456789, '0x0b0b')
        .to.emit(stbt, "Transfer").withArgs(zeroAddr, bob.address, 456789);
    });

    it("issue: totalSupply & balanceOf", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);

      expect(await stbt.totalSupply()).to.equal(0);
      expect(await stbt.balanceOf(alice.address)).to.equal(0);
      expect(await stbt.balanceOf(bob.address)).to.equal(0);

      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      expect(await stbt.totalSupply()).to.equal(10000);
      expect(await stbt.balanceOf(alice.address)).to.equal(10000);
      expect(await stbt.balanceOf(bob.address)).to.equal(0);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await stbt.connect(issuer).issue(bob.address, 20000, '0x');
      expect(await stbt.totalSupply()).to.equal(30000);
      expect(await stbt.balanceOf(alice.address)).to.equal(10000);
      expect(await stbt.balanceOf(bob.address)).to.equal(20000);
    });

    // it("redeem & redeemFrom", async function () {
    //   const { stbt, alice } = await loadFixture(deployStbtFixture);

    //   await expect(stbt.redeem(10001, '0x')).to.be.revertedWith('UNSUPPORTED');
    //   await expect(stbt.redeemFrom(alice.address, 10001, '0x')).to.be.revertedWith('UNSUPPORTED');
    // });

    it("redeem: errors", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(issuer.address, [false, true, 0]);
      await stbt.connect(issuer).issue(issuer.address, 10000, '0x');

      await expect(stbt.connect(alice).redeem(123, '0x'))
        .to.be.revertedWith("STBT: NOT_ISSUER");

      await expect(stbt.connect(issuer).redeem(123, '0x'))
        .to.be.revertedWith("STBT: NO_SEND_PERMISSION");

      await stbt.connect(moderator).setPermission(issuer.address, [true, true, 0]);
      await expect(stbt.connect(issuer).redeem(10001, '0x'))
        .to.be.revertedWith("STBT: BURN_AMOUNT_EXCEEDS_BALANCE");
    });

    it("redeem: zero_value", async function () {
      const { stbt, issuer } = await loadFixture(deployStbtFixture);
      await stbt.connect(issuer).redeem(0, '0x');
    });

    it("redeem: events and balances", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(issuer.address, [true, true, 0]);
      await stbt.connect(issuer).issue(issuer.address, 10000, '0x');

      expect(await stbt.totalSupply()).to.equal(10000);
      expect(await stbt.balanceOf(issuer.address)).to.equal(10000);
      expect(await stbt.sharesOf(issuer.address)).to.equal(10000);

      await expect(stbt.connect(issuer).redeem(3000, '0x1234'))
        .to.emit(stbt, "TransferShares").withArgs(issuer.address, zeroAddr, 3000)
        .to.emit(stbt, "Redeemed").withArgs(issuer.address, issuer.address, 3000, '0x1234')
        .to.emit(stbt, "Transfer").withArgs(issuer.address, zeroAddr, 3000);

      expect(await stbt.totalSupply()).to.equal(7000);
      expect(await stbt.balanceOf(issuer.address)).to.equal(7000);
      expect(await stbt.sharesOf(issuer.address)).to.equal(7000);
    });

    it("redeemFrom: errors", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await stbt.connect(issuer).issue(bob.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(bob.address, [false, false, 0]);

      await expect(stbt.connect(alice).redeemFrom(bob.address, 123, '0x'))
        .to.be.revertedWith("STBT: NOT_ISSUER");

      await expect(stbt.connect(issuer).redeemFrom(bob.address, 123, '0x'))
        .to.be.revertedWith("STBT: REDEEM_AMOUNT_EXCEEDS_ALLOWANCE");

      await stbt.connect(bob).approve(issuer.address, 10000);
      await expect(stbt.connect(issuer).redeemFrom(bob.address, 12345, '0x'))
        .to.be.revertedWith("STBT: REDEEM_AMOUNT_EXCEEDS_ALLOWANCE");

      await expect(stbt.connect(issuer).redeemFrom(bob.address, 123, '0x'))
        .to.be.revertedWith("STBT: NO_SEND_PERMISSION");

      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await expect(stbt.connect(issuer).redeemFrom(bob.address, 12345, '0x'))
        .to.be.revertedWith("STBT: REDEEM_AMOUNT_EXCEEDS_ALLOWANCE");
    });

    it("redeemFrom: events and balances", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(bob.address, 10000, '0x');
      await stbt.connect(bob).approve(issuer.address, 20000);

      await expect(stbt.connect(issuer).redeemFrom(bob.address, 3000, '0x4321'))
        .to.emit(stbt, "TransferShares").withArgs(bob.address, zeroAddr, 3000)
        .to.emit(stbt, "Redeemed").withArgs(issuer.address, bob.address, 3000, '0x4321')
        .to.emit(stbt, "Approval").withArgs(bob.address, issuer.address, 17000)
        .to.emit(stbt, "Transfer").withArgs(bob.address, zeroAddr, 3000);

      expect(await stbt.totalSupply()).to.equal(7000);
      expect(await stbt.balanceOf(bob.address)).to.equal(7000);
      expect(await stbt.sharesOf(bob.address)).to.equal(7000);
    });

    it("canTransfer", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      expect(await stbt.connect(alice).canTransfer(bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_SEND]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 12345]); // expired
      expect(await stbt.connect(alice).canTransfer(bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_SEND]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, await lastBlockTS() + 100]);
      expect(await stbt.connect(alice).canTransfer(bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_RECEIVE]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 0]); // no expiry time
      expect(await stbt.connect(alice).canTransfer(bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_RECEIVE]);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 12345]); // expired
      expect(await stbt.connect(alice).canTransfer(bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_RECEIVE]);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, await lastBlockTS() + 100]);
      expect(await stbt.connect(alice).canTransfer(bob.address, 20000, '0x'))
        .to.deep.equal([false, UpperLimit, SHARES_NOT_ENOUGH]);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]); // no expiry time
      expect(await stbt.connect(alice).canTransfer(bob.address, 20000, '0x'))
        .to.deep.equal([false, UpperLimit, SHARES_NOT_ENOUGH]);

      expect(await stbt.connect(alice).canTransfer(bob.address, 200, '0x'))
        .to.deep.equal([true, Success, ZERO_BYTES32]);
    });

    it("canTransferFrom", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 100, '0x'))
        .to.deep.equal([false, UpperLimit, ALLOWANCE_NOT_ENOUGH]);

      await stbt.connect(alice).approve(cindy.address, 20000);
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_SEND]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 12345]); // expired
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_SEND]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, await lastBlockTS() + 100]);
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_RECEIVE]);

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 0]); // no expiry time
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_RECEIVE]);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 12345]); // expired
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 100, '0x'))
        .to.deep.equal([false, PermissionRequested, CANNOT_RECEIVE]);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, await lastBlockTS() + 100]);
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 20000, '0x'))
        .to.deep.equal([false, UpperLimit, SHARES_NOT_ENOUGH]);

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]); // no expiry time
      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 20000, '0x'))
        .to.deep.equal([false, UpperLimit, SHARES_NOT_ENOUGH]);

      expect(await stbt.connect(cindy).canTransferFrom(alice.address, bob.address, 200, '0x'))
        .to.deep.equal([true, Success, ZERO_BYTES32]);
    });

    it("transferWithData", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');

      await expect(stbt.connect(alice).transferWithData(bob.address, 4000, '0x1234'))
        .to.emit(stbt, "Transfer").withArgs(alice.address, bob.address, 4000)
        .to.emit(stbt, "TransferShares").withArgs(alice.address, bob.address, 4000);

      expect(await stbt.totalSupply()).to.equal(10000);
      expect(await stbt.balanceOf(alice.address)).to.equal(6000);
      expect(await stbt.balanceOf(bob.address)).to.equal(4000);
    });

    it("transferFromWithData", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(alice).approve(cindy.address, 2000);

      await expect(stbt.connect(cindy).transferFromWithData(alice.address, bob.address, 800, '0x1234'))
        .to.emit(stbt, "Transfer").withArgs(alice.address, bob.address, 800)
        .to.emit(stbt, "TransferShares").withArgs(alice.address, bob.address, 800)
        .to.emit(stbt, "Approval").withArgs(alice.address, cindy.address, 1200);

      expect(await stbt.balanceOf(alice.address)).to.equal(9200);
      expect(await stbt.balanceOf(bob.address)).to.equal(800);
      expect(await stbt.allowance(alice.address, cindy.address)).to.equal(1200);
    });

  });

  describe("ERC1644", function () {

    it("isControllable", async function () {
      const { stbt } = await loadFixture(deployStbtFixture);
      expect(await stbt.isControllable()).to.equal(true);
    });

    it("controllerTransfer: errors", async function () {
      const { stbt, issuer, moderator, controller, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(alice).controllerTransfer(alice.address, bob.address, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: NOT_CONTROLLER");

      await expect(stbt.connect(controller).controllerTransfer(zeroAddr, bob.address, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: TRANSFER_FROM_THE_ZERO_ADDRESS");

      await expect(stbt.connect(controller).controllerTransfer(bob.address, zeroAddr, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: TRANSFER_TO_THE_ZERO_ADDRESS");

      await expect(stbt.connect(controller).controllerTransfer(alice.address, bob.address, 12345, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: TRANSFER_AMOUNT_EXCEEDS_BALANCE");
    });

    it("controllerTransfer: events and balances", async function () {
      const { stbt, issuer, moderator, controller, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(issuer).issue(bob.address, 10000, '0x');

      await expect(stbt.connect(controller).controllerTransfer(alice.address, bob.address, 4000, '0x1234', '0x5678'))
        .to.emit(stbt, "Transfer").withArgs(alice.address, bob.address, 4000)
        .to.emit(stbt, "TransferShares").withArgs(alice.address, bob.address, 4000)
        .to.emit(stbt, "ControllerTransfer").withArgs(controller.address, alice.address, bob.address, 4000, '0x1234', '0x5678');

      expect(await stbt.balanceOf(alice.address)).to.equal(6000);
      expect(await stbt.balanceOf(bob.address)).to.equal(14000);
    });

    it("controllerRedeem: errors", async function () {
      const { stbt, issuer, moderator, controller, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(alice).controllerRedeem(alice.address, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: NOT_CONTROLLER");

      await expect(stbt.connect(controller).controllerRedeem(zeroAddr, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: BURN_FROM_THE_ZERO_ADDRESS");

      await expect(stbt.connect(controller).controllerRedeem(alice.address, 12345, '0x1234', '0x5678'))
        .to.be.revertedWith("STBT: BURN_AMOUNT_EXCEEDS_BALANCE");
    });

    it("controllerRedeem: events and balances", async function () {
      const { stbt, issuer, moderator, controller, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(controller).controllerRedeem(alice.address, 4000, '0x1234', '0x5678'))
        .to.emit(stbt, "TransferShares").withArgs(alice.address, zeroAddr, 4000)
        .to.emit(stbt, "ControllerRedemption").withArgs(controller.address, alice.address, 4000, '0x1234', '0x5678')
        .to.emit(stbt, "Transfer").withArgs(alice.address, zeroAddr, 4000);

      expect(await stbt.balanceOf(alice.address)).to.equal(6000);
    });

  });

  describe("REBASE", function () {

    it("distributeInterests: errors", async function () {
      const { stbt, owner, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(owner).setMaxDistributeRatio(ethers.utils.parseUnits('0.1')); // 10%
      await stbt.connect(owner).setMinDistributeInterval(24 * 3600); // 1 day

      await expect(stbt.connect(alice).distributeInterests(12345, 0, 0))
        .to.be.revertedWith("STBT: NOT_ISSUER");

      await expect(stbt.connect(issuer).distributeInterests(1001, 0, 0))
        .to.be.revertedWith("STBT: MAX_DISTRIBUTE_RATIO_EXCEEDED");

      await expect(stbt.connect(issuer).distributeInterests(-1001, 0, 0))
        .to.be.revertedWith("STBT: MAX_DISTRIBUTE_RATIO_EXCEEDED");

      await expect(stbt.connect(issuer).distributeInterests(1000, 0, 0))
        .to.be.revertedWith("STBT: MIN_DISTRIBUTE_INTERVAL_VIOLATED");

      await time.increase(24 * 3600);
      stbt.connect(issuer).distributeInterests(1000, 0, 0); // ok

      await expect(stbt.connect(issuer).distributeInterests(1000, 0, 0))
        .to.be.revertedWith("STBT: MIN_DISTRIBUTE_INTERVAL_VIOLATED");

      await time.increase(23 * 3600);
      await expect(stbt.connect(issuer).distributeInterests(1000, 0, 0))
        .to.be.revertedWith("STBT: MIN_DISTRIBUTE_INTERVAL_VIOLATED");

      await time.increase(1 * 3600);
      stbt.connect(issuer).distributeInterests(1000, 0, 0); // ok
    });

    it("distributeInterests: events and balances", async function () {
      const { stbt, owner, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(issuer).issue(bob.address, 20000, '0x');
      await stbt.connect(owner).setMaxDistributeRatio(ethers.utils.parseUnits('0.1')); // 10%
      await stbt.connect(owner).setMinDistributeInterval(24 * 3600); // 1 day

      await time.increase(24 * 3600);
      await expect(stbt.connect(issuer).distributeInterests(2100, 123456789, 123459999))
        .to.emit(stbt, "InterestsDistributed").withArgs(2100, 32100, 123456789, 123459999);

      expect(await stbt.totalSupply()).to.be.equal(32100);
      expect(await stbt.totalShares()).to.be.equal(30000);
      expect(await stbt.balanceOf(alice.address)).to.equal(10700);
      expect(await stbt.sharesOf(alice.address)).to.equal(10000);
      expect(await stbt.balanceOf(bob.address)).to.equal(21400);
      expect(await stbt.sharesOf(bob.address)).to.equal(20000);

      await time.increase(24 * 3600);
      await expect(stbt.connect(issuer).distributeInterests(-1500, 123456789, 123459999))
        .to.emit(stbt, "InterestsDistributed").withArgs(-1500, 30600, 123456789, 123459999);

      expect(await stbt.totalSupply()).to.be.equal(30600);
      expect(await stbt.totalShares()).to.be.equal(30000);
      expect(await stbt.balanceOf(alice.address)).to.equal(10200);
      expect(await stbt.sharesOf(alice.address)).to.equal(10000);
      expect(await stbt.balanceOf(bob.address)).to.equal(20400);
      expect(await stbt.sharesOf(bob.address)).to.equal(20000);
    });

  });

});

describe("STBT-TimelockController", function () {

  async function deployTimelockFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, proposer, executor, alice, bob, cindy] = await ethers.getSigners();

    const TimelockController = await ethers.getContractFactory("StbtTimelockController");
    const STBT = await ethers.getContractFactory("STBT");
    const Proxy = await ethers.getContractFactory("UpgradeableSTBT");

    // functions to be invoked by timelock
    const timelockIface = TimelockController.interface;
    const stbtIface = STBT.interface;
    const proxyIface = Proxy.interface;
    const delayMap = [
      { selector: stbtIface.getSighash("setIssuer"),                delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("setController"),            delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("setModerator"),             delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("setMinDistributeInterval"), delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("setMaxDistributeRatio"),    delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("setDocument"),              delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("removeDocument"),           delay: 4 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("transferOwnership"),        delay: 8 * 3600 }, // onlyOwner
      { selector: proxyIface.getSighash("resetImplementation"),     delay: 8 * 3600 }, // onlyOwner
      { selector: stbtIface.getSighash("issue"),                    delay: 4 * 3600 }, // onlyIssuer
      { selector: stbtIface.getSighash("redeem"),                   delay: 6 * 3600 }, // onlyIssuer
      { selector: stbtIface.getSighash("redeemFrom"),               delay: 6 * 3600 }, // onlyIssuer
      { selector: stbtIface.getSighash("distributeInterests"),      delay: 1 * 3600 }, // onlyIssuer
      { selector: stbtIface.getSighash("setPermission"),            delay: 2 * 3600 }, // onlyModerator
      { selector: stbtIface.getSighash("controllerTransfer"),       delay: 3 * 3600 }, // onlyController
      { selector: stbtIface.getSighash("controllerRedeem"),         delay: 3 * 3600 }, // onlyController
      { selector: timelockIface.getSighash("grantRole"),            delay: 8 * 3600 },
      { selector: timelockIface.getSighash("revokeRole"),           delay: 8 * 3600 },
    ];
    // console.log(delayMap);
    const selectors = delayMap.map(x => x.selector);
    const delays = delayMap.map(x => x.delay);

    const timelock = await TimelockController.deploy(
      [proposer.address], // proposers
      [executor.address], // executors
      zeroAddr,           // admin
      selectors,          // selectors
      delays,             // delays
    );
    const logic = await STBT.deploy();
    const proxy = await Proxy.deploy(timelock.address, timelock.address, timelock.address, timelock.address, logic.address);
    const stbt = logic.attach(proxy.address);

    return { timelock, logic, stbt, proxy, delayMap, owner, proposer, executor, alice, bob, cindy };
  }

  describe("deploy", function () {

    it("roles", async function () {
      const { timelock, logic, stbt, owner, proposer, executor, alice } = await loadFixture(deployTimelockFixture);

      // console.log('timelock :', timelock.address);
      // console.log('stbtLogic:', logic.address);
      // console.log('stbtProxy:', stbt.address);

      expect(await stbt.owner()).to.equal(timelock.address);
      expect(await stbt.issuer()).to.equal(timelock.address);
      expect(await stbt.controller()).to.equal(timelock.address);
      expect(await stbt.moderator()).to.equal(timelock.address);

      const adminRole = await timelock.TIMELOCK_ADMIN_ROLE();
      const proposerRole = await timelock.PROPOSER_ROLE();
      const executorRole = await timelock.EXECUTOR_ROLE();
      const cancellerRole = await timelock.CANCELLER_ROLE();
      expect(await timelock.getRoleAdmin(adminRole)).to.equal(adminRole);
      expect(await timelock.getRoleAdmin(proposerRole)).to.equal(adminRole);
      expect(await timelock.getRoleAdmin(executorRole)).to.equal(adminRole);
      expect(await timelock.getRoleAdmin(cancellerRole)).to.equal(adminRole);
      expect(await timelock.hasRole(adminRole, timelock.address)).to.equal(true);
      expect(await timelock.hasRole(adminRole, owner.address)).to.equal(false);
      expect(await timelock.hasRole(proposerRole, proposer.address)).to.equal(true);
      expect(await timelock.hasRole(proposerRole, alice.address)).to.equal(false);
      expect(await timelock.hasRole(cancellerRole, proposer.address)).to.equal(true);
      expect(await timelock.hasRole(cancellerRole, alice.address)).to.equal(false);
      expect(await timelock.hasRole(executorRole, executor.address)).to.equal(true);
    });

  });

  describe("TimelockController", function () {

    it("delays", async function () {
      const { timelock, delayMap } = await loadFixture(deployTimelockFixture);

      expect(await timelock.getMinDelay()).to.equal(0);
      expect(await timelock.delayMap('0x12345678')).to.equal(0);
      for (const { selector, delay } of delayMap) {   
        expect(await timelock.delayMap(selector)).to.equal(delay);
      }
    });

    it("updateDelay: UNSUPPORTED", async function () {
      const { timelock } = await loadFixture(deployTimelockFixture);

      await expect(timelock.updateDelay(1000))
        .to.be.revertedWith("TimelockController: UNSUPPORTED");
    });

    it("scheduleBatch: UNSUPPORTED", async function () {
      const { timelock, stbt, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const data = stbt.interface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 4 * 3600 + 1;

      await expect(timelock.connect(alice).scheduleBatch([target], [value], [data], predecessor, salt, delay))
        .to.be.revertedWith("TimelockController: UNSUPPORTED");
    });

    it("schedule: UNKNOWN_SELECTOR", async function () {
      const { timelock, stbt, proposer, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const data = '0x1234567890';
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 0;

      await expect(timelock.connect(proposer).schedule(target, value, data, predecessor, salt, delay))
        .to.be.revertedWith("TimelockController: UNKNOWN_SELECTOR");
    });

    // it("cancelOperation: AccessControl", async function () {
    //   const { timelock, stbt, proposer, alice } = await loadFixture(deployTimelockFixture);

    //   const target = stbt.address;
    //   const value = 0;
    //   const data = stbt.interface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
    //   const predecessor = ethers.utils.formatBytes32String('');
    //   const salt = ethers.utils.formatBytes32String('hahah');
    //   const delay = 4 * 3600;

    //   timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);

    //   await expect(timelock.connect(alice).cancelOperation(target, value, data, predecessor, salt))
    //     .to.be.revertedWith(`AccessControl: account ${alice.address.toLowerCase()} is missing role 0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783`);
    // });

    it("hashOperation", async function () {
      const { timelock } = await loadFixture(deployTimelockFixture);

      const target = '0x324E132EAc14AfFeA5dF80e04b919d97035dc952';
      const data = '0x1234';
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const opid = '0x66fe9bb6e79a0629e0daf63e1528284fc1887e17f45a559e5c5b7776ec59617b';

      expect(await timelock.hashOperation(target, 0, data, predecessor, salt))
        .to.equal(opid);
    });

  });

  describe("STBT", function () {

    it("issue: errors", async function () {
      const { stbt, timelock, proposer, executor, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const data = stbt.interface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 0;

      await expect(stbt.issue(alice.address, 1234, '0x5678'))
        .to.be.revertedWith("STBT: NOT_ISSUER");

      await expect(timelock.connect(alice).schedule(target, value, data, predecessor, salt, delay))
        .to.be.revertedWith(`AccessControl: account ${alice.address.toLowerCase()} is missing role 0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1`);
      // await expect(timelock.connect(alice).schedule2(target, data, predecessor, salt))
      //   .to.be.revertedWith(`AccessControl: account ${alice.address.toLowerCase()} is missing role 0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1`);

      // await timelock.connect(proposer).schedule2(target, data, predecessor, salt); // ok
      await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, delay); // ok

      await expect(timelock.connect(alice).execute(target, value, data, predecessor, salt))
        .to.be.revertedWith(`AccessControl: account ${alice.address.toLowerCase()} is missing role 0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63`);

      await expect(timelock.connect(executor).execute(target, value, data, predecessor, salt))
        .to.be.revertedWith("TimelockController: operation is not ready");

      // forward revert message
      await time.increase(4 * 3600);
      await expect(timelock.connect(executor).execute(target, value, data, predecessor, salt))
        .to.be.revertedWith("STBT: NO_RECEIVE_PERMISSION");
    });

    it("setPermission+issue: events", async function () {
      const { stbt, timelock, proposer, executor, alice } = await loadFixture(deployTimelockFixture);
      // await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);

      const target = stbt.address;
      const value = 0;
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      let data;
      let delay;

      data = stbt.interface.encodeFunctionData("setPermission", [alice.address, [true, true, 0]]);
      delay = 2 * 3600;
      await expect(timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0))
        .to.emit(timelock, "CallScheduled").withArgs(anyValue, 0, target, value, data, predecessor, delay);

      await time.increase(delay + 1);
      await expect(timelock.connect(executor).execute(target, value, data, predecessor, salt))
        .to.emit(timelock, "CallExecuted").withArgs(anyValue, 0, target, value, data)

      data = stbt.interface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      delay = 4 * 3600;
      await expect(timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0))
        .to.emit(timelock, "CallScheduled").withArgs(anyValue, 0, target, value, data, predecessor, delay);

      await time.increase(delay + 1);
      await expect(timelock.connect(executor).execute(target, value, data, predecessor, salt))
        .to.emit(timelock, "CallExecuted").withArgs(anyValue, 0, target, value, data)
        .to.emit(stbt, "Issued").withArgs(timelock.address, alice.address, 10000, '0x1234');
      expect(await stbt.balanceOf(alice.address)).to.equal(10000);
    });

    it("issue: cancel", async function () {
      const { stbt, timelock, proposer, executor, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const data = stbt.interface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 4 * 3600;

      const opId = await timelock.hashOperation(target, value, data, predecessor, salt);
      await expect(timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0))
        .to.emit(timelock, "CallScheduled").withArgs(opId, 0, target, value, data, predecessor, delay);

      await time.increase(delay / 2);
      await expect(timelock.connect(proposer).cancel(opId))
        .to.emit(timelock, "Cancelled").withArgs(opId);
    });

    it("distributeInterests", async function () {
      const { timelock, stbt, proposer, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 1 * 3600;

      // function distributeInterests(uint256 _distributedInterest) external
      let data = stbt.interface.encodeFunctionData("distributeInterests", [20000, 123456789, 123459999]);
      await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);

    });

    it("setPermission", async function () {
      const { timelock, stbt, proposer, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 2 * 3600;

      // function setPermission(address addr, tupple(bool, bool, uint64) permission) public
      let data = stbt.interface.encodeFunctionData("setPermission", [alice.address, [true, true, 0]]);
      await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);

    });

    it("switch TimelockController", async function () {
      const { timelock, stbt, proposer, executor } = await loadFixture(deployTimelockFixture);
      expect(await stbt.owner()).to.equal(timelock.address);
      expect(await stbt.issuer()).to.equal(timelock.address);
      expect(await stbt.controller()).to.equal(timelock.address);
      expect(await stbt.moderator()).to.equal(timelock.address);

      const TimelockController = await ethers.getContractFactory("StbtTimelockController");
      const timelock2 = await TimelockController.deploy(
        [zeroAddr], // proposers
        [zeroAddr], // executors
        zeroAddr,   // admin
        [],         // selectors
        [],         // delays
      );

      const target = stbt.address;
      const value = 0;
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');

      const dataArr = [
        stbt.interface.encodeFunctionData("setIssuer",         [timelock2.address]),
        stbt.interface.encodeFunctionData("setController",     [timelock2.address]),
        stbt.interface.encodeFunctionData("setModerator",      [timelock2.address]),
        stbt.interface.encodeFunctionData("transferOwnership", [timelock2.address]),
      ];
      for (const data of dataArr) {
        await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);
      }

      await time.increase(8 * 3600 + 1); 
      for (const data of dataArr) {
        await timelock.connect(executor).execute(target, value, data, predecessor, salt);
      }

      expect(await stbt.owner()).to.equal(timelock2.address);
      expect(await stbt.issuer()).to.equal(timelock2.address);
      expect(await stbt.controller()).to.equal(timelock2.address);
      expect(await stbt.moderator()).to.equal(timelock2.address);
    });

    describe("Minter", function () {

      async function deployMinterFixture() {
        const pool = await ethers.getSigners().then(s => s[6]);
        const f = await deployTimelockFixture();
        const Minter = await ethers.getContractFactory("Minter");
        const minter = await Minter.deploy(f.timelock.address, f.proxy.address, pool.address);

        const TestERC20 = await ethers.getContractFactory("TestERC20");
        const usdc = await TestERC20.deploy('USDC', ethers.utils.parseUnits('100000000'), 18);

        async function grantRoleByTL(role, toAddr) {
          const { timelock, proposer, executor } = f;
          const target = timelock.address;
          const value = 0;
          const data = timelock.interface.encodeFunctionData("grantRole", [role, toAddr]);
          const predecessor = ethers.utils.formatBytes32String('');
          const salt = ethers.utils.formatBytes32String('hello');
          await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);
          await time.increase(8 * 3600);
          await timelock.connect(executor).execute(target, value, data, predecessor, salt);
        }

        async function setPermisionByTL(addr, permission) {
          const { timelock, stbt, proposer, executor } = f;
          const value = 0;
          const target = stbt.address;
          const data = stbt.interface.encodeFunctionData("setPermission", [addr, permission]);
          const predecessor = ethers.utils.formatBytes32String('');
          const salt = ethers.utils.formatBytes32String('hello');
          await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);
          await time.increase(8 * 3600);
          await timelock.connect(executor).execute(target, value, data, predecessor, salt);
        }

        async function issueByTL(to, amt, eventData) {
          const { timelock, stbt, proposer, executor } = f;
          const value = 0;
          const target = stbt.address;
          const data = stbt.interface.encodeFunctionData("issue", [to, amt, eventData]);
          const predecessor = ethers.utils.formatBytes32String('');
          const salt = ethers.utils.formatBytes32String('hello');
          await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);
          await time.increase(8 * 3600);
          await timelock.connect(executor).execute(target, value, data, predecessor, salt);
        }

        return {...f, minter, pool, usdc, grantRoleByTL, setPermisionByTL, issueByTL};
      }

      it("init", async function () {
        const { timelock, stbt, minter, pool, owner } = await loadFixture(deployMinterFixture);

        expect(await minter.owner()).to.equal(owner.address);
        expect(await minter.timeLockContract()).to.equal(timelock.address);
        expect(await minter.targetContract()).to.equal(stbt.address);
        expect(await minter.poolAccount()).to.equal(pool.address);
        expect(await minter.nonceForMint()).to.equal(0);
        expect(await minter.nonceForRedeem()).to.equal(0);
      });

      it("ops: onlyOwner!", async function () {
        const { timelock, stbt, minter, pool, alice } = await loadFixture(deployMinterFixture);

        const badOps = [
          minter.connect(alice).setTimeLockContract(alice.address),
          minter.connect(alice).setTargetContract(alice.address),
          minter.connect(alice).setPoolAccount(alice.address),
          minter.connect(alice).setCoinInfo(alice.address, 111),
          minter.connect(alice).setDepositConfig(alice.address, {needDivAdjust:false, adjustUnit:0, minimumDepositAmount:222}),
          minter.connect(alice).setRedeemConfig(alice.address, {needDivAdjust:false, adjustUnit:0, minimumRedeemAmount:222}),
          minter.connect(alice).setRedeemFeeRate(alice.address, 333),
          minter.connect(alice).setDepositPeriod(444),
          minter.connect(alice).setRedeemPeriod(555),
          minter.connect(alice).redeemSettle(alice.address, 666, alice.address, ZERO_BYTES32, 666, 666),
          minter.connect(alice).rescue(alice.address, alice.address, 777),
        ];

        for (let badOp of badOps) {    
          await expect(badOp).to.be.revertedWith(`Ownable: caller is not the owner`);
        }
      });

      it("setters", async function () {
        const { minter, alice, bob, cindy } = await loadFixture(deployMinterFixture);

        await minter.setTimeLockContract(alice.address);
        await minter.setTargetContract(bob.address);
        await minter.setPoolAccount(cindy.address);
        await minter.setCoinInfo(alice.address, 111);
        await minter.setDepositConfig(bob.address, {needDivAdjust:true, adjustUnit:888, minimumDepositAmount:123}),
        await minter.setRedeemConfig(cindy.address, {needDivAdjust:true, adjustUnit:999, minimumRedeemAmount:456}),
        await minter.setRedeemFeeRate(alice.address, 333),
        await minter.setDepositPeriod(444);
        await minter.setRedeemPeriod(555);

        const getVals = (x => x.map(y => y));

        expect(await minter.timeLockContract()).to.equal(alice.address);
        expect(await minter.targetContract()).to.equal(bob.address);
        expect(await minter.poolAccount()).to.equal(cindy.address);
        expect(await minter.getCoinInfo(alice.address)).to.equal(111);
        expect(await minter.depositConfigMap(bob.address).then(getVals)).to.deep.equal([true, 888, 123]);
        expect(await minter.redeemConfigMap(cindy.address).then(getVals)).to.deep.equal([true, 999, 456]);
        expect(await minter.redeemFeeRateMap(alice.address)).to.equal(333);
        expect(await minter.depositPeriod()).to.equal(444);
        expect(await minter.redeemPeriod()).to.equal(555);
      });

      it("getCoinsInfo", async function () {
        const { minter, alice, bob, cindy } = await loadFixture(deployMinterFixture);

        await minter.setCoinInfo(alice.address, 123);
        await minter.setCoinInfo(bob.address, 456);
        await minter.setCoinInfo(cindy.address, 789);

        expect(await minter.getCoinsInfo()).to.deep.equal([
          [alice.address, bob.address, cindy.address],
          [123, 456, 789],
        ]);
      });

      it("mint: errors", async function () {
        const { timelock, minter, usdc, proposer, executor, alice, bob, cindy,
          setPermisionByTL } = await loadFixture(deployMinterFixture);
        const salt = ethers.utils.formatBytes32String('hello');

        await expect(minter.connect(alice).mint(usdc.address, 10000, 10000, salt, "0x"))
          .to.be.revertedWith(`MINTER: NO_RECEIVE_PERMISSION`);

        // await stbt.setPermission(alice.address, [true, true, 123]);
        await setPermisionByTL(alice.address, [true, true, 123]);
        await expect(minter.connect(alice).mint(usdc.address, 10000, 10000, salt, "0x"))
          .to.be.revertedWith(`MINTER: RECEIVE_PERMISSION_EXPIRED`);

        await setPermisionByTL(alice.address, [true, true, 0]);
        await expect(minter.connect(alice).mint(usdc.address, 10000, 10000, salt, "0x"))
          .to.be.revertedWith(`EnumerableMap: nonexistent key`);

        const receiverAndRate = BigInt(bob.address) << 96n | BigInt(ethers.utils.parseUnits('0.02'));
        await minter.setCoinInfo(usdc.address, receiverAndRate);
        await minter.setDepositConfig(usdc.address, {needDivAdjust:false, adjustUnit:1, minimumDepositAmount:99999});
        await expect(minter.connect(alice).mint(usdc.address, 10000, 8888, salt, "0x"))
          .to.be.revertedWith(`MINTER: DEPOSIT_AMOUNT_TOO_SMALL`);

        await minter.setDepositConfig(usdc.address, {needDivAdjust:false, adjustUnit:1, minimumDepositAmount:9999});
        await expect(minter.connect(alice).mint(usdc.address, 10000, 9999, salt, "0x"))
          .to.be.revertedWith(`MINTER: PROPOSE_AMOUNT_TOO_SMALL`);

        await expect(minter.connect(alice).mint(usdc.address, 10000, 8888, salt, "0x"))
          .to.be.revertedWith(`ERC20: insufficient allowance`);

        await usdc.connect(alice).approve(minter.address, 20000);
        await expect(minter.connect(alice).mint(usdc.address, 10000, 8888, salt, "0x"))
          .to.be.revertedWith(`ERC20: transfer amount exceeds balance`);

        const proposerRole = await timelock.PROPOSER_ROLE();
        await usdc.transfer(alice.address, 12345);
        await expect(minter.connect(alice).mint(usdc.address, 10000, 8888, salt, "0x"))
          .to.be.revertedWith(`AccessControl: account ${minter.address.toLowerCase()} is missing role ${proposerRole}`);
      });

      it("mint: ok", async function () {
        const { timelock, stbt, minter, usdc, executor, alice, bob, cindy,
          grantRoleByTL, setPermisionByTL } = await loadFixture(deployMinterFixture);

        const receiverAndRate = BigInt(bob.address) << 96n | BigInt(ethers.utils.parseUnits('0.02'));
        await minter.setCoinInfo(usdc.address, receiverAndRate);
        await minter.setDepositConfig(usdc.address, {needDivAdjust:false, adjustUnit:1, minimumDepositAmount:9999});
        await usdc.connect(alice).approve(minter.address, 20000);
        await usdc.transfer(alice.address, 12345);

        // await timelock.grantRole(proposerRole, minter.address);
        const proposerRole = await timelock.PROPOSER_ROLE();
        await grantRoleByTL(proposerRole, minter.address);

        // await stbt.setPermission(alice.address, [true, true, 0]);
        await setPermisionByTL(alice.address, [true, true, 0]);

        // schedule
        const salt = ethers.utils.formatBytes32String('hello');
        const tlSalt = ethers.utils.keccak256(ethers.utils.solidityPack(["bytes32", "uint"], [salt, 0]));
        const tlData = stbt.interface.encodeFunctionData("issue", [alice.address, 9800, "0xdddd"]);
        await expect(minter.connect(alice).mint(usdc.address, 10000, 8888, salt, "0xdddd"))
          .to.changeTokenBalance(usdc, alice.address, -10000)
          .to.changeTokenBalance(usdc, bob.address, 10000)
          .to.emit(minter, 'Mint').withArgs(alice.address, usdc.address, 1, 10000, 9800, tlSalt, tlData)
          ;
        expect(await minter.nonceForMint()).to.equal(1);

        // execute
        await time.increase(8 * 3600);
        await expect(timelock.connect(executor).execute(
          stbt.address, // target
          0, // value, 
          tlData, // data
          ethers.utils.formatBytes32String(''), // predecessor
          tlSalt, // salt
        )).to.changeTokenBalance(stbt, alice.address, 9800);
      });

      it("redeem: errors", async function () {
        const { timelock, stbt, minter, usdc, pool, alice,
          setPermisionByTL, grantRoleByTL } = await loadFixture(deployMinterFixture);
        const salt = ethers.utils.formatBytes32String('hello');
        const proposerRole = await timelock.PROPOSER_ROLE();

        await minter.setRedeemConfig(usdc.address, {needDivAdjust:false, adjustUnit:1, minimumRedeemAmount:10000});
        await expect(minter.connect(alice).redeem(123, usdc.address, salt, "0xdddd"))
          .to.be.revertedWith('MINTER: REDEEM_AMOUNT_TOO_SMALL');

        await expect(minter.connect(alice).redeem(10001, usdc.address, salt, "0xdddd"))
          .to.be.revertedWith('STBT: TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');

        await stbt.connect(alice).approve(minter.address, 20000);
        await expect(minter.connect(alice).redeem(10001, usdc.address, salt, "0xdddd"))
          .to.be.revertedWith('STBT: NO_SEND_PERMISSION');

        // await stbt.setPermission(alice.address, [true, true, 0]);        
        await setPermisionByTL(alice.address, [true, true, 0]);
        await expect(minter.connect(alice).redeem(10001, usdc.address, salt, "0xdddd"))
          .to.be.revertedWith('STBT: NO_RECEIVE_PERMISSION');

        // await stbt.setPermission(pool.address, [true, true, 0]);        
        await setPermisionByTL(pool.address, [true, true, 0]);
        await expect(minter.connect(alice).redeem(10001, usdc.address, salt, "0xdddd"))
          .to.be.revertedWith(`AccessControl: account ${minter.address.toLowerCase()} is missing role ${proposerRole}`);

        // await timelock.grantRole(proposerRole, minter.address);
        await grantRoleByTL(proposerRole, minter.address);
        await minter.connect(alice).redeem(10001, usdc.address, salt, "0xdddd"); // ok
      });

      it("redeem&settle: ok", async function () {
        const { timelock, stbt, minter, usdc, pool, executor, alice,
          setPermisionByTL, grantRoleByTL, issueByTL } = await loadFixture(deployMinterFixture);
        const salt = ethers.utils.formatBytes32String('hello');
        const proposerRole = await timelock.PROPOSER_ROLE();

        // prepare
        await grantRoleByTL(proposerRole, minter.address);
        await setPermisionByTL(pool.address, [true, true, 0]);
        await setPermisionByTL(alice.address, [true, true, 0]);
        await stbt.connect(alice).approve(minter.address, 20000);
        await stbt.connect(pool).approve(timelock.address, 20000);
        await issueByTL(alice.address, 20000, "0xffff");
        await minter.setRedeemConfig(usdc.address, {needDivAdjust:false, adjustUnit:1, minimumRedeemAmount:10000});

        // schedule redeem
        await expect(minter.connect(alice).redeem(12345, usdc.address, salt, "0xdddd"))
          .to.changeTokenBalance(stbt, alice.address, -12345)
          .to.changeTokenBalance(stbt, pool.address, 12345)
          .to.emit(minter, 'Redeem').withArgs(alice.address, usdc.address, 0, 12345, anyValue, anyValue);
        expect(await minter.nonceForRedeem()).to.equal(1);
        expect(await minter.redeemTargetMap(0)).to.equal(alice.address);

        // execute redeem
        await time.increase(8 * 3600);
        await timelock.connect(executor).execute(
          stbt.address, // target
          0, // value, 
          stbt.interface.encodeFunctionData("redeemFrom", [pool.address, 12345, "0xdddd"]), // data
          ethers.utils.formatBytes32String(''), // predecessor
          ethers.utils.keccak256(ethers.utils.solidityPack(["bytes32", "uint"], [salt, 0])), // salt
        );

        // redeemSettle
        const amt = 12345;
        const nonce = 0;
        const redeemTxId = ethers.utils.formatBytes32String("redeemTxId");
        const redeemServiceFeeRate = 50000;
        const executionPrice = 80000;
        await usdc.transfer(minter.address, 20000);
        await expect(minter.redeemSettle(usdc.address, amt, nonce, redeemTxId, redeemServiceFeeRate, executionPrice))
          .to.changeTokenBalance(usdc, minter.address, -amt)
          .to.changeTokenBalance(usdc, alice.address, amt)
          .to.emit(minter, 'Settle').withArgs(alice.address, amt, redeemTxId, redeemServiceFeeRate, executionPrice);
        expect(await minter.redeemTargetMap(0)).to.equal(zeroAddr);
      });

      it("redeemSettle: errors", async function () {
        const { timelock, stbt, minter, usdc, pool, alice } = await loadFixture(deployMinterFixture);

        const amt = 12345;
        const nonce = 100;
        const redeemTxId = ethers.utils.formatBytes32String("redeemTxId");
        const redeemServiceFeeRate = 50000;
        const executionPrice = 80000;

        await expect(minter.connect(alice).redeemSettle(usdc.address, amt, nonce, redeemTxId, redeemServiceFeeRate, executionPrice))
          .to.be.revertedWith('Ownable: caller is not the owner');
        await expect(minter.redeemSettle(usdc.address, amt, nonce, redeemTxId, redeemServiceFeeRate, executionPrice))
          .to.be.revertedWith('MINTER: NULL_TARGET');
      });

      it("rescue", async function () {
        const { timelock, stbt, minter, usdc, pool, executor, alice,
          setPermisionByTL, grantRoleByTL, issueByTL } = await loadFixture(deployMinterFixture);
        const salt = ethers.utils.formatBytes32String('hello');
        const proposerRole = await timelock.PROPOSER_ROLE();

        // redeem
        await grantRoleByTL(proposerRole, minter.address);
        await setPermisionByTL(pool.address, [true, true, 0]);
        await setPermisionByTL(alice.address, [true, true, 0]);
        await stbt.connect(alice).approve(minter.address, 20000);
        await stbt.connect(pool).approve(timelock.address, 20000);
        await issueByTL(alice.address, 20000, "0xffff");
        await minter.connect(alice).redeem(12345, usdc.address, salt, "0xdddd");

        await expect(minter.connect(alice).rescue(usdc.address, alice.address, 12345))
          .to.be.revertedWith('Ownable: caller is not the owner');
        await expect(minter.rescue(usdc.address, alice.address, 12345))
          .to.be.revertedWith('MINTER: PENDING_REDEEM');

        // redeemSettle
        const amt = 12345;
        const nonce = 0;
        const redeemTxId = ethers.utils.formatBytes32String("redeemTxId");
        const redeemServiceFeeRate = 50000;
        const executionPrice = 80000;
        await usdc.transfer(minter.address, 20000);
        await minter.redeemSettle(usdc.address, amt, nonce, redeemTxId, redeemServiceFeeRate, executionPrice);

        // rescue usdc
        await usdc.transfer(minter.address, 50000);
        await expect(minter.rescue(usdc.address, alice.address, 12345))
          .to.changeTokenBalance(usdc, alice.address, 12345)
          .to.changeTokenBalance(usdc, minter.address, -12345);

        // rescue ether
        // await alice.sendTransaction({to: minter.address, value: 50000});
        // await expect(minter.rescue(zeroAddr, alice.address, 12345))
        //   .to.changeEtherBalance(alice.address, 12345)
        //   .to.changeEtherBalance(minter.address, -12345);
      });

    });

  });

});

describe("WSTBT", function () {

  async function deployWstbtFixture() {
    const [owner, alice, bob, cindy] = await ethers.getSigners();

    const STBT = await ethers.getContractFactory("STBT");
    const stbt = await STBT.deploy();
    await stbt.setIssuer(owner.address);
    await stbt.setModerator(owner.address);
    await stbt.setController(owner.address);
    await stbt.setPermission(alice.address, [true, true, 0]);
    await stbt.issue(alice.address, 10000, "0x");
    await stbt.setMaxDistributeRatio(ethers.utils.parseUnits("0.1"))
    await stbt.distributeInterests(200, 123, 456);

    const WSTBT = await ethers.getContractFactory("WSTBT");
    let wstbt = await WSTBT.deploy("wSTBT", "WSTBT", stbt.address);

    // const UpgradeableWSTBT = await ethers.getContractFactory("UpgradeableWSTBT");
    // const proxy = await UpgradeableWSTBT.deploy(wstbt.address);
    // wstbt = wstbt.attach(proxy.address);
    await stbt.setPermission(wstbt.address, [true, true, 0]);

    return {stbt, wstbt, owner, alice, bob, cindy};
  }

  it("deploy", async function () {
    const {stbt, wstbt, owner, alice} = await loadFixture(deployWstbtFixture);
    expect(await wstbt.totalSupply()).to.equal(0);
    expect(await wstbt.name()).to.equal("wSTBT");
    expect(await wstbt.symbol()).to.equal("WSTBT");
    expect(await wstbt.stbtAddress()).to.equal(stbt.address);
  });

  it("wrap: errors", async function () {
    const {stbt, wstbt, owner, alice} = await loadFixture(deployWstbtFixture);

    await expect(wstbt.connect(alice).wrap(0))
      .to.be.revertedWith('WSTBT: ZERO_AMOUNT');

    await expect(wstbt.connect(alice).wrap(1234))
      .to.be.revertedWith('STBT: TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');

    await stbt.connect(alice).approve(wstbt.address, 20000);
    await expect(wstbt.connect(alice).wrap(12345))
      .to.be.revertedWith('STBT: TRANSFER_AMOUNT_EXCEEDS_BALANCE');
  });

  it("wrap: ok", async function () {
    const {stbt, wstbt, owner, alice} = await loadFixture(deployWstbtFixture);
    await stbt.connect(alice).approve(wstbt.address, 20000);

    await expect(wstbt.connect(alice).wrap(5000))
      .to.emit(wstbt, "Transfer").withArgs(zeroAddr, alice.address, 4901)
      .to.emit(wstbt, "Wrap").withArgs(alice.address, 5000, 4901)
      .to.changeTokenBalance(stbt, alice.address, -5000)
      .to.changeTokenBalance(stbt, wstbt.address, 4999)
      .to.changeTokenBalance(wstbt, alice.address, 4901)
      ;
  });

  it("unswap: errors", async function () {
    const {stbt, wstbt, owner, alice} = await loadFixture(deployWstbtFixture);

    await expect(wstbt.connect(alice).unwrap(0))
      .to.be.revertedWith('WSTBT: ZERO_AMOUNT');

    await expect(wstbt.connect(alice).unwrap(1234))
      .to.be.revertedWith('STBT: TRANSFER_AMOUNT_EXCEEDS_BALANCE');
  });

  it("unswap: ok", async function () {
    const {stbt, wstbt, owner, alice} = await loadFixture(deployWstbtFixture);

    await stbt.connect(alice).approve(wstbt.address, 20000);
    await wstbt.connect(alice).wrap(5000);
    await expect(wstbt.connect(alice).unwrap(2000))
      .to.emit(wstbt, "Transfer").withArgs(alice.address, zeroAddr, 2000)
      .to.emit(wstbt, "Unwrap").withArgs(alice.address, 2040, 2000)
      .to.changeTokenBalance(stbt, alice.address, 2040)
      .to.changeTokenBalance(stbt, wstbt.address, -2040)
      .to.changeTokenBalance(wstbt, alice.address, -2000)
      ;
  });

  it("getters", async function () {
    const {stbt, wstbt, owner, alice} = await loadFixture(deployWstbtFixture);

    expect(await wstbt.getWstbtByStbt(12345)).to.equal(await stbt.getSharesByAmount(12345));
    expect(await wstbt.getStbtByWstbt(12345)).to.equal(await stbt.getAmountByShares(12345));
    expect(await wstbt.stbtPerToken()).to.equal(await stbt.getAmountByShares(ethers.utils.parseUnits("1")));
    expect(await wstbt.tokensPerStbt()).to.equal(await stbt.getSharesByAmount(ethers.utils.parseUnits("1")));
  });

  it("transfer: errors", async function () {
    const {stbt, wstbt, owner, alice, bob, cindy} = await loadFixture(deployWstbtFixture);

    await expect(wstbt.connect(bob).transfer(cindy.address, 123))
      .to.be.revertedWith('WSTBT: NO_SEND_PERMISSION');

    await stbt.setPermission(bob.address, [true, true, 0]);
    await expect(wstbt.connect(bob).transfer(cindy.address, 123))
      .to.be.revertedWith('WSTBT: NO_RECEIVE_PERMISSION');

    await stbt.setPermission(cindy.address, [true, true, 0]);
    await expect(wstbt.connect(bob).transfer(cindy.address, 123))
      .to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it("transfer: ok", async function () {
    const {stbt, wstbt, owner, alice, bob} = await loadFixture(deployWstbtFixture);
    await stbt.setPermission(bob.address, [true, true, 0]);
    await stbt.connect(alice).approve(wstbt.address, 20000);
    await wstbt.connect(alice).wrap(5000);

    await expect(wstbt.connect(alice).transfer(bob.address, 123))
      .to.emit(wstbt, "Transfer").withArgs(alice.address, bob.address, 123)
      .to.changeTokenBalance(wstbt, alice.address, -123)
      .to.changeTokenBalance(wstbt, bob.address, 123)
      ;
  });

  it("transferFrom: errors", async function () {
    const {stbt, wstbt, owner, alice, bob, cindy} = await loadFixture(deployWstbtFixture);

    await expect(wstbt.connect(alice).transferFrom(bob.address, cindy.address, 234))
      .to.be.revertedWith('WSTBT: NO_SEND_PERMISSION');

    await stbt.setPermission(bob.address, [true, true, 0]);
    await expect(wstbt.connect(alice).transferFrom(bob.address, cindy.address, 234))
      .to.be.revertedWith('WSTBT: NO_RECEIVE_PERMISSION');

    await stbt.setPermission(cindy.address, [true, true, 0]);
    await expect(wstbt.connect(alice).transferFrom(bob.address, cindy.address, 234))
      .to.be.revertedWith('ERC20: insufficient allowance');

    await wstbt.connect(bob).approve(alice.address, 12345);
    await expect(wstbt.connect(alice).transferFrom(bob.address, cindy.address, 234))
      .to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it("transferFrom: ok", async function () {
    const {stbt, wstbt, owner, alice, bob, cindy} = await loadFixture(deployWstbtFixture);
    await stbt.setPermission(bob.address, [true, true, 0]);
    await stbt.setPermission(cindy.address, [true, true, 0]);
    await wstbt.connect(bob).approve(alice.address, 12345);
    await stbt.issue(bob.address, 10000, "0x");
    await stbt.connect(bob).approve(wstbt.address, 20000);
    await wstbt.connect(bob).wrap(5000);

    await expect(wstbt.connect(alice).transferFrom(bob.address, cindy.address, 234))
      .to.emit(wstbt, "Transfer").withArgs(bob.address, cindy.address, 234)
      .to.changeTokenBalance(wstbt, bob.address, -234)
      .to.changeTokenBalance(wstbt, cindy.address, 234)
      ;
  });

  it("controllerTransfer: errors", async function () {
    const {stbt, wstbt, owner, alice, bob, cindy} = await loadFixture(deployWstbtFixture);

    await expect(wstbt.connect(alice).controllerTransfer(bob.address, cindy.address, 345, "0x", "0x"))
      .to.be.revertedWith('WSTBT: NOT_CONTROLLER');

    await expect(wstbt.connect(owner).controllerTransfer(bob.address, cindy.address, 345, "0x", "0x"))
      .to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it("controllerTransfer: ok", async function () {
    const {stbt, wstbt, owner, alice, bob} = await loadFixture(deployWstbtFixture);
    await stbt.connect(alice).approve(wstbt.address, 20000);
    await wstbt.connect(alice).wrap(5000);

    await expect(wstbt.connect(owner).controllerTransfer(alice.address, bob.address, 345, "0xdddd", "0xeeee"))
      .to.changeTokenBalance(wstbt, alice.address, -345)
      .to.changeTokenBalance(wstbt, bob.address, 345)
      .to.emit(wstbt, "Transfer").withArgs(alice.address, bob.address, 345)
      .to.emit(wstbt, "ControllerTransfer").withArgs(owner.address, alice.address, bob.address, 345, "0xdddd", "0xeeee")
      ;
  });

});

async function lastBlockTS() {
  const h = await ethers.provider.getBlockNumber();
  const b = await ethers.provider.getBlock(h);
  return b.timestamp;
}
