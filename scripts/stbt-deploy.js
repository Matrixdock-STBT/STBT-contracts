const hre = require("hardhat");

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


async function main() {
  const owner = await ethers.getSigner();
  console.log('owner:', owner.address);

  const proposerAddr = process.env.PROPOSER || owner.address;
  const executorAddr = process.env.EXECUTOR || owner.address;

  console.log('deploy TimelockController ...');
  const TimelockController = await ethers.getContractFactory("StbtTimelockController");
  const timelock = await TimelockController.deploy(
    [proposerAddr], // proposers
    [executorAddr], // executors
    owner.address,  // admin
    selectors,      // selectors
    delays,         // delays
  );
  console.log('TimelockController deployed to:', timelock.address);

  console.log('deploy STBT logic ...');
  const STBT = await ethers.getContractFactory("STBT");
  let stbt = await STBT.deploy();
  console.log('STBT logic deployed to:', stbt.address);

  console.log('deploy STBT proxy ...');
  const Proxy = await ethers.getContractFactory("UpgradeableSTBT");
  const proxy = await Proxy.deploy(owner.address, timelock.address, timelock.address, timelock.address, stbt.address);
  // stbt = stbt.attach(proxy.address);
  // await stbt.setIssuer(timelock.address);
  // await stbt.setModerator(timelock.address);
  // await stbt.setController(timelock.address);
  console.log('STBT proxy deployed to:', stbt.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
