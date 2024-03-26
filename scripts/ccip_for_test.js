const hre = require("hardhat");
const {ethers} = require("hardhat");

// NOTE: this file for test only!!!
async function main() {
    const DEPLOYERPrivateKey = ""

    // ------- prepare L1 env -------
    const l1RpcUrl = "https://sepolia.infura.io/v3/1630401474d6409cbac3568a1f764cc8"
    const l1Provider = new ethers.providers.JsonRpcProvider(l1RpcUrl)
    const owner = new ethers.Wallet(DEPLOYERPrivateKey, l1Provider)
    console.log('owner:', owner.address);

    // deploy stbt and wstbt, bridge, messager
    const STBT = await (await ethers.getContractFactory("STBT")).connect(owner);
    const stbt = await STBT.connect(owner).attach("0xCeecdD9C1BD107A002446CBDbB73497dcF6C14EE");
    console.log('STBT deployed to:', stbt.address);
    const WSTBT = await (await ethers.getContractFactory("WSTBT")).connect(owner);
    const wstbt = await WSTBT.attach("0x4Cc2fcd234C3D3Ef9fea7E56B17ee5AB1B974407");
    console.log('WSTBT deployed to:', wstbt.address);
    const WSTBTBridge = await (await ethers.getContractFactory("WSTBTBridge")).connect(owner);
    const l1Bridge = await WSTBTBridge.attach("0x833b0C93CaEd1B531E53943177d771d070f809dF");
    console.log('WSTBTBridge deployed to:', l1Bridge.address)
    const CCWSTBTMessager = await (await ethers.getContractFactory("CCWSTBTMessager")).connect(owner);
    let routerAddressL1 = "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59"
    const l1Messager = await CCWSTBTMessager.attach("0x80dCA92FD9ED8c169c9Af8281AcbbAE115652902")
    console.log('L1Messager deployed to:', l1Messager.address);

    // init
    // await stbt.connect(owner).setIssuer(owner.address,{gasLimit:200000});
    let issuer = await stbt.issuer();
    console.log("issuer:", issuer);
    console.log("set issuer success")
    //await stbt.setController(owner.address, {gasLimit:200000});
    console.log("set controller success")
    //await stbt.setModerator(owner.address, {gasLimit:200000});
    console.log("set moderator success")

    //await stbt.setPermission(owner.address, [true, true, 0], {gasLimit:200000});
    console.log("set permission of owner")
    //await stbt.setPermission(wstbt.address, [true, true, 0], {gasLimit:200000});
    console.log("set permission of wstbt")
    //await stbt.setPermission(l1Bridge.address, [true, true, 0], {gasLimit:200000});
    console.log("set permission of l1Bridge")

    //await stbt.issue(owner.address, 10000000000, '0x', {gasLimit:200000});
    let balance = await stbt.balanceOf(owner.address);
    console.log("stbt balance after issue:", balance);
    // await stbt.approve(wstbt.address, 1000000000, {gasLimit:200000});
    // await wstbt.wrap(1000000000, {gasLimit:200000});
    let wstbtBalance = await wstbt.balanceOf(owner.address);
    console.log("wstbt balance after wrap:", wstbtBalance);

    // await l1Bridge.setMessager(l1Messager.address, {gasLimit:200000});
    // await l1Bridge.setSendEnabled(true, {gasLimit:200000});

    // ------- prepare L2 env -------
    const l2RpcUrl = "https://arbitrum-sepolia.infura.io/v3/1630401474d6409cbac3568a1f764cc8"
    const l2Provider = new ethers.providers.JsonRpcProvider(l2RpcUrl);
    const ownerL2 = new ethers.Wallet(DEPLOYERPrivateKey, l2Provider);
    console.log('ownerL2:', ownerL2.address);

    // deploy contracts
    const CCWSTBT = await (await ethers.getContractFactory("CCWSTBT")).connect(ownerL2);
    //const ccwstbt = await CCWSTBT.deploy("CCWSTBT","CCWSTBT");
    const ccwstbt = await CCWSTBT.attach("0x27575A9e50cca9d3126400A87B93774788d39080");
    console.log('CCWSTBT deployed to:', ccwstbt.address);

    let routerAddressL2 = "0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165"
    const CCWSTBTMessagerL2 = await (await ethers.getContractFactory("CCWSTBTMessager")).connect(ownerL2);
    // const l2Messager = await CCWSTBTMessagerL2.deploy(routerAddressL2, ccwstbt.address);
    const l2Messager = await CCWSTBTMessagerL2.attach("0xCeecdD9C1BD107A002446CBDbB73497dcF6C14EE");
    console.log('L2Messager deployed to:', l2Messager.address); //0xCeecdD9C1BD107A002446CBDbB73497dcF6C14EE

    // await ccwstbt.setMessager(l2Messager.address);

    let l1ChainSelector = 16015286601757825753n
    let l2ChainSelector = 3478487238524512106n
    //await l1Messager.setAllowedPeer(l2ChainSelector,l2Messager.address, true, {gasLimit:200000})
    console.log("L1 setAllowedPeer success")
    //await l2Messager.setAllowedPeer(l1ChainSelector, l1Messager.address, true, {gasLimit:400000})
    console.log("L2 setAllowedPeer success")

    // cc-send: main=>side
    // await wstbt.approve(l1Bridge.address, 10000, {gasLimit:200000});
    // console.log("approve l1Bridge success")
    // let fees = await l1Messager.calculateFeeAndMessage(l2ChainSelector, l2Messager.address, owner.address, owner.address, 1000, "0x");
    // let fee = fees[0];
    // console.log("fee:", fee);
    // let res = await l1Messager.transferToChain(l2ChainSelector, l2Messager.address, owner.address, 1000, "0x",{value:fee, gasLimit:500000})
    // console.log(res);

    // cc-send: side=>main
    // let fees = await l2Messager.calculateFeeAndMessage(l1ChainSelector, l1Messager.address, owner.address, owner.address, 100, "0x");
    // let fee = fees[0];
    // console.log("fee:", fee);
    // let res = await l2Messager.transferToChain(l1ChainSelector, l1Messager.address, owner.address, 100, "0x",{value:fee, gasLimit:500000})
    // console.log(res);

    // check cc result
    let permission = await ccwstbt.permissions(owner.address);
    console.log(permission)
    let bridgeBalance = await wstbt.balanceOf(l1Bridge.address);
    console.log(bridgeBalance);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
