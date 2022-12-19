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
        .to.be.revertedWith("NOT_OWNER");
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
    });

    it("setPermission: NOT_MODERATOR", async function () {
      const { stbt, moderator, alice } = await loadFixture(deployStbtFixture);

      await expect(stbt.connect(alice).setPermission(alice.address, [true, true, 0]))
        .to.be.revertedWith("NOT_MODERATOR");
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
      expect(await stbt.name()).to.equal('Short-term Treasury Bond Token');
      expect(await stbt.symbol()).to.equal('STBT');
      expect(await stbt.decimals()).to.equal(18);
    });

    it("transfer: permissions checks", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('NO_SEND_PERMISSION');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 11111111]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('SEND_PERMISSION_EXPIRED');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 0]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('NO_RECEIVE_PERMISSION');

      const ts = await lastBlockTS();
      await stbt.connect(moderator).setPermission(alice.address, [true, false, ts + 100]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('NO_RECEIVE_PERMISSION');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 11111111]);
      await expect(stbt.connect(alice).transfer(bob.address, 123))
        .to.be.revertedWith('RECEIVE_PERMISSION_EXPIRED');

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
        .to.be.revertedWith('DECREASED_ALLOWANCE_BELOW_ZERO');

      expect(await stbt.allowance(bob.address, alice.address)).to.equal(1900);
      expect(await stbt.allowance(alice.address, bob.address)).to.equal(0);
    });

    it("transferFrom: allowance checks", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');

      await expect(stbt.connect(alice).transferFrom(bob.address, cindy.address, 123))
        .to.be.revertedWith('TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');

      stbt.connect(bob).approve(alice.address, 122);
      await expect(stbt.connect(alice).transferFrom(bob.address, cindy.address, 123))
        .to.be.revertedWith('TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');
    });

    it("transferFrom: permissions checks", async function () {
      const { stbt, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);
      await stbt.connect(alice).approve(cindy.address, 128);

      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('NO_SEND_PERMISSION');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 11111111]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('SEND_PERMISSION_EXPIRED');

      await stbt.connect(moderator).setPermission(alice.address, [true, false, 0]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('NO_RECEIVE_PERMISSION');

      const ts = await lastBlockTS();
      await stbt.connect(moderator).setPermission(alice.address, [true, false, ts + 100]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('NO_RECEIVE_PERMISSION');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 11111111]);
      await expect(stbt.connect(cindy).transferFrom(alice.address, bob.address, 123))
        .to.be.revertedWith('RECEIVE_PERMISSION_EXPIRED');

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
        .to.be.revertedWith('INVALID_DOC_NAME');

      const docName = ethers.utils.formatBytes32String("docA");
      await expect(stbt.connect(owner).setDocument(docName, '', docHash))
        .to.be.revertedWith('INVALID_URL');
    });

    it("removeDocument: errors", async function () {
      const { stbt, owner, alice } = await loadFixture(deployStbtFixture);

      const docName = ethers.utils.formatBytes32String("docA");
      await expect(stbt.connect(owner).removeDocument(docName))
        .to.be.revertedWith('DOC_NOT_EXIST');
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
        .to.be.revertedWith("NOT_ISSUER");

      await expect(stbt.connect(issuer).issue(zeroAddr, 123, '0x'))
        .to.be.revertedWith("MINT_TO_THE_ZERO_ADDRESS");

      await expect(stbt.connect(issuer).issue(alice.address, 123, '0x'))
        .to.be.revertedWith("NO_RECEIVE_PERMISSION");
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
        .to.emit(stbt, "Issued")
        .withArgs(issuer.address, alice.address, 123, '0x0a11ce');

      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await expect(stbt.connect(issuer).issue(bob.address, 456789, '0x0b0b'))
        .to.emit(stbt, "Issued")
        .withArgs(issuer.address, bob.address, 456789, '0x0b0b');
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

    it("redeem: errors", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(alice).redeem(123, '0x'))
        .to.be.revertedWith("NO_SEND_PERMISSION");

      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await expect(stbt.connect(alice).redeem(10001, '0x'))
        .to.be.revertedWith("BURN_AMOUNT_EXCEEDS_BALANCE");
    });

    it("redeem: zero_value", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await stbt.connect(alice).redeem(0, '0x');
    });

    it("redeem: events and balances", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [true, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');

      expect(await stbt.totalSupply()).to.equal(10000);
      expect(await stbt.balanceOf(alice.address)).to.equal(10000);
      expect(await stbt.sharesOf(alice.address)).to.equal(10000);

      await expect(stbt.connect(alice).redeem(2000, '0x1234'))
        .to.emit(stbt, "SharesBurnt").withArgs(alice.address, 2000, 2500, 2000)
        .to.emit(stbt, "Redeemed").withArgs(alice.address, alice.address, 2000, '0x1234');

      expect(await stbt.totalSupply()).to.equal(8000);
      expect(await stbt.balanceOf(alice.address)).to.equal(8000);
      expect(await stbt.sharesOf(alice.address)).to.equal(8000);
    });

    it("redeemFrom: errors", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await stbt.connect(issuer).issue(bob.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(bob.address, [false, false, 0]);

      await expect(stbt.connect(alice).redeemFrom(bob.address, 123, '0x'))
        .to.be.revertedWith("REDEEM_AMOUNT_EXCEEDS_ALLOWANCE");

      await stbt.connect(bob).approve(alice.address, 10000);
      await expect(stbt.connect(alice).redeemFrom(bob.address, 12345, '0x'))
        .to.be.revertedWith("REDEEM_AMOUNT_EXCEEDS_ALLOWANCE");

      await expect(stbt.connect(alice).redeemFrom(bob.address, 123, '0x'))
        .to.be.revertedWith("NO_SEND_PERMISSION");

      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await expect(stbt.connect(alice).redeemFrom(bob.address, 12345, '0x'))
        .to.be.revertedWith("REDEEM_AMOUNT_EXCEEDS_ALLOWANCE");
    });

    it("redeemFrom: events and balances", async function () {
      const { stbt, issuer, moderator, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(bob.address, [true, true, 0]);
      await stbt.connect(issuer).issue(bob.address, 10000, '0x');
      await stbt.connect(bob).approve(alice.address, 20000);

      await expect(stbt.connect(alice).redeemFrom(bob.address, 3000, '0x4321'))
        .to.emit(stbt, "SharesBurnt").withArgs(bob.address, 3000, 4285, 3000)
        .to.emit(stbt, "Redeemed").withArgs(alice.address, bob.address, 3000, '0x4321')
        .to.emit(stbt, "Approval").withArgs(bob.address, alice.address, 17000);

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
        .to.be.revertedWith("NOT_CONTROLLER");

      await expect(stbt.connect(controller).controllerTransfer(zeroAddr, bob.address, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("TRANSFER_FROM_THE_ZERO_ADDRESS");

      await expect(stbt.connect(controller).controllerTransfer(bob.address, zeroAddr, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("TRANSFER_TO_THE_ZERO_ADDRESS");

      await expect(stbt.connect(controller).controllerTransfer(alice.address, bob.address, 12345, '0x1234', '0x5678'))
        .to.be.revertedWith("TRANSFER_AMOUNT_EXCEEDS_BALANCE");
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
        .to.be.revertedWith("NOT_CONTROLLER");

      await expect(stbt.connect(controller).controllerRedeem(zeroAddr, 123, '0x1234', '0x5678'))
        .to.be.revertedWith("BURN_FROM_THE_ZERO_ADDRESS");

      await expect(stbt.connect(controller).controllerRedeem(alice.address, 12345, '0x1234', '0x5678'))
        .to.be.revertedWith("BURN_AMOUNT_EXCEEDS_BALANCE");
    });

    it("controllerRedeem: events and balances", async function () {
      const { stbt, issuer, moderator, controller, alice, bob } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(moderator).setPermission(alice.address, [false, false, 0]);

      await expect(stbt.connect(controller).controllerRedeem(alice.address, 4000, '0x1234', '0x5678'))
        .to.emit(stbt, "SharesBurnt").withArgs(alice.address, 4000, 6666, 4000)
        .to.emit(stbt, "ControllerRedemption").withArgs(controller.address, alice.address, 4000, '0x1234', '0x5678');

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

      await expect(stbt.connect(alice).distributeInterests(12345))
        .to.be.revertedWith("NOT_ISSUER");

      await expect(stbt.connect(issuer).distributeInterests(1001))
        .to.be.revertedWith("MAX_DISTRIBUTE_RATIO_EXCEEDED");

      stbt.connect(issuer).distributeInterests(1000); // ok
      await expect(stbt.connect(issuer).distributeInterests(1000))
        .to.be.revertedWith("MIN_DISTRIBUTE_INTERVAL_VIOLATED");

      await time.increase(23 * 3600);
      await expect(stbt.connect(issuer).distributeInterests(1000))
        .to.be.revertedWith("MIN_DISTRIBUTE_INTERVAL_VIOLATED");

      await time.increase(1 * 3600);
      stbt.connect(issuer).distributeInterests(1000); // ok
    });

    it("distributeInterests: events and balances", async function () {
      const { stbt, owner, issuer, moderator, alice, bob, cindy } = await loadFixture(deployStbtFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);
      await stbt.connect(moderator).setPermission(bob.address, [false, true, 0]);
      await stbt.connect(issuer).issue(alice.address, 10000, '0x');
      await stbt.connect(issuer).issue(bob.address, 20000, '0x');
      await stbt.connect(owner).setMaxDistributeRatio(ethers.utils.parseUnits('0.1')); // 10%
      await stbt.connect(owner).setMinDistributeInterval(24 * 3600); // 1 day

      await expect(stbt.connect(issuer).distributeInterests(2100))
        .to.emit(stbt, "InterestsDistributed").withArgs(2100, 32100, anyValue, anyValue);

      expect(await stbt.totalSupply()).to.be.equal(32100);
      expect(await stbt.totalShares()).to.be.equal(30000);
      expect(await stbt.balanceOf(alice.address)).to.equal(10700);
      expect(await stbt.sharesOf(alice.address)).to.equal(10000);
      expect(await stbt.balanceOf(bob.address)).to.equal(21400);
      expect(await stbt.sharesOf(bob.address)).to.equal(20000);
    });

  });

});

describe("STBT-TimelockController", function () {

  const stbtIface = new ethers.utils.Interface([
    "function issue(address _tokenHolder, uint256 _value, bytes calldata _data) external",
    "function setPermission(address addr, tupple(bool, bool, uint64) permission) public",
    "function distributeInterests(uint256 _distributedInterest) external",
  ]);

  const selectors = [
    stbtIface.getSighash("issue"),
    stbtIface.getSighash("setPermission"),
    stbtIface.getSighash("distributeInterests"),
  ];
  const delays = [
    4 * 3600,
    2 * 3600,
    1 * 3600,
  ];

  async function deployTimelockFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, issuer, controller, moderator, proposer, executor, alice, bob, cindy] = await ethers.getSigners();

    const TimelockController = await ethers.getContractFactory("StbtTimelockController");
    const timelock = await TimelockController.deploy(
      [proposer.address], // proposers
      [executor.address], // executors
      owner.address,      // admin
      selectors,          // selectors
      delays,             // delays
    );

    const STBT = await ethers.getContractFactory("STBT");
    const stbt = await STBT.deploy();
    await stbt.setIssuer(timelock.address);
    await stbt.setModerator(moderator.address);
    await stbt.setController(controller.address);

    return { stbt, owner, issuer, controller, moderator, alice, bob, cindy,
      timelock, proposer, executor };
  }

  describe("TimelockController", function () {

    it("delays", async function () {
      const { timelock } = await loadFixture(deployTimelockFixture);
      expect(await timelock.getMinDelay()).to.equal(0);
      expect(await timelock.delayMap(selectors[0])).to.equal(delays[0]);
      expect(await timelock.delayMap(selectors[1])).to.equal(delays[1]);
      expect(await timelock.delayMap(selectors[2])).to.equal(delays[2]);
      expect(await timelock.delayMap('0x12345678')).to.equal(0);
    });

    it("updateDelay: UNSUPPORTED", async function () {
      const { timelock } = await loadFixture(deployTimelockFixture);

      await expect(timelock.updateDelay(1000))
        .to.be.revertedWith("UNSUPPORTED");
    });

    it("scheduleBatch: UNSUPPORTED", async function () {
      const { timelock, stbt, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const data = stbtIface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 4 * 3600 + 1;

      await expect(timelock.connect(alice).scheduleBatch([target], [value], [data], predecessor, salt, delay))
        .to.be.revertedWith("UNSUPPORTED");
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
        .to.be.revertedWith("UNKNOWN_SELECTOR");
    });

  });

  describe("STBT", function () {

    it("issue: errors", async function () {
      const { stbt, timelock, proposer, executor, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const data = stbtIface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 0;

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
    });

    it("issue: events", async function () {
      const { stbt, timelock, proposer, executor, moderator, alice } = await loadFixture(deployTimelockFixture);
      await stbt.connect(moderator).setPermission(alice.address, [false, true, 0]);

      const target = stbt.address;
      const value = 0;
      const data = stbtIface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 4 * 3600;

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
      const data = stbtIface.encodeFunctionData("issue", [alice.address, 10000, '0x1234']);
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 4 * 3600;

      await expect(timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0))
        .to.emit(timelock, "CallScheduled").withArgs(anyValue, 0, target, value, data, predecessor, delay);

      await time.increase(delay / 2);
      await expect(timelock.connect(proposer).cancelOperation(target, value, data, predecessor, salt))
        .to.emit(timelock, "Cancelled").withArgs(anyValue);
    });

    it("distributeInterests", async function () {
      const { timelock, stbt, proposer, alice } = await loadFixture(deployTimelockFixture);

      const target = stbt.address;
      const value = 0;
      const predecessor = ethers.utils.formatBytes32String('');
      const salt = ethers.utils.formatBytes32String('hahah');
      const delay = 1 * 3600;

      // function distributeInterests(uint256 _distributedInterest) external
      let data = stbtIface.encodeFunctionData("distributeInterests", [20000]);
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
      let data = stbtIface.encodeFunctionData("setPermission", [alice.address, [true, true, 0]]);
      await timelock.connect(proposer).schedule(target, value, data, predecessor, salt, 0);

    });

  });

});

async function lastBlockTS() {
  const h = await ethers.provider.getBlockNumber();
  const b = await ethers.provider.getBlock(h);
  return b.timestamp;
}
