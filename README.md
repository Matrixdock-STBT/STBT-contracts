# STBT-contracts
The smart contracts of STBT.

Try running some of the following tasks:

```shell
# compile smart contracts
npx hardhat compile

# run unit tests
npx hardhat test

# see test coverage
npx hardhat coverage

# deploy
PROPOSER=0x... \
EXECUTOR=0x... \
npx hardhat run scripts/stbt-deploy.js
```
