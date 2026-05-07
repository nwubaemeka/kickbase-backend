// src/test-contract.js
// Run this to verify your contract is deployed and working:
//   node src/test-contract.js

require('dotenv').config();
const { checkConnection, getMatchOnChain } = require('./services/blockchain');
const { ethers } = require('ethers');

async function main() {
  console.log('\n🔍 KickBase — Contract Connection Test\n');

  // 1. Check RPC connection
  console.log('1. Checking blockchain connection...');
  const status = await checkConnection();
  if (!status.ok) {
    console.error('❌ Failed:', status.error);
    console.error('\nMake sure your .env has:\n  RPC_URL\n  OPERATOR_PRIVATE_KEY\n  CONTRACT_ADDRESS\n');
    process.exit(1);
  }

  console.log('✅ Connected to chain ID:', status.chainId);
  console.log('✅ Latest block:', status.blockNumber);
  console.log('✅ Operator wallet:', status.operatorAddress);
  console.log('✅ Operator balance:', status.operatorBalance);
  console.log('✅ Contract address:', status.contractAddress);

  // 2. Validate contract address
  if (process.env.CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.warn('\n⚠️  CONTRACT_ADDRESS is still the placeholder.');
    console.warn('   Deploy KickBaseEscrow.sol to Base Sepolia and update .env\n');
    process.exit(0);
  }

  // 3. Test reading from contract
  console.log('\n2. Testing contract read (non-existent match)...');
  try {
    const fakeId = ethers.utils.id('test-match-' + Date.now());
    const m = await getMatchOnChain(fakeId);
    console.log('✅ Contract is readable. State:', m.state);
  } catch (err) {
    console.error('❌ Contract read failed:', err.message);
    console.error('   Is the contract deployed at', process.env.CONTRACT_ADDRESS, '?');
    process.exit(1);
  }

  console.log('\n✅ All checks passed! Your backend is ready.\n');
  process.exit(0);
}

main().catch(console.error);
