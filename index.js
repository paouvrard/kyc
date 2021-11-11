const nearAPI = require("near-api-js");
const { keyStores, KeyPair } = nearAPI;
const { connect } = nearAPI;
const { PrismaClient } = require("@prisma/client");
const BN = require('bn.js');

const KYC_ACCOUNT_ID = 'aurora-kyc.near'
const OWNER_ACCOUNT_ID = 'kyc-owner.near'

async function main() {
  console.log('Starting...')

  let keyStore
  if (process.env.PRIVATE_KEY) {
    keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(process.env.PRIVATE_KEY);
    await keyStore.setKey('mainnet', OWNER_ACCOUNT_ID, keyPair);
  } else {
    const { join } = require('path');
    const { homedir } = require('os');
    const KEY_PATH = join(homedir(), ".near-credentials");
    keyStore = new keyStores.UnencryptedFileSystemKeyStore(KEY_PATH);
  }

  const config = {
    networkId: "mainnet",
    keyStore,
    nodeUrl: "https://rpc.mainnet.near.org",
    explorerUrl: "https://explorer.mainnet.near.org",
  };

  const near = await connect(config);
  const owner = await near.account(OWNER_ACCOUNT_ID);

  const prisma = new PrismaClient()

  while (true) {
    const pendingUsers = await prisma.kycRecords.findMany({
      where: { result: 'clear', status: 'complete', provider: 'near', transactionHash: null },
      take: 50
    }) || []
    console.log('Pending users: ', pendingUsers.length)
    if (pendingUsers.length === 0) {
      await new Promise(resolve => setTimeout(resolve, Number(process.env.LOOP_INTERVAL)))
      continue
    }
    const accounts = pendingUsers.map(user => user.account)
    console.log(accounts)
    try {
      const tx = await owner.functionCall({
        contractId: KYC_ACCOUNT_ID,
        methodName: 'approve_multiple',
        args: {
          accounts_id: accounts
        },
        gas: new BN('300' + '0'.repeat(12)),
        // attachedDeposit: new BN('1')
      })
      console.log('approve_multiple: ', tx.transaction.hash)
      await Promise.all(accounts.map(async account => {
        await prisma.kycRecords.update({
          where: { account },
          data: {
            transactionHash: tx.transaction.hash,
          },
        })
      }))
    } catch (error) {
      console.error(`Failed to approve user accounts: ${error}`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
      console.error(error);
      process.exit(1);
  });
