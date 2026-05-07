// src/services/blockchain.js
// This service is the ONLY thing that talks to the smart contract.
// It runs server-side with the operator private key, so players
// cannot manipulate settlement results from the frontend.

const { ethers } = require('ethers');
require('dotenv').config();

const CONTRACT_ABI = [
  "function createMatch(bytes32 matchId) payable",
  "function joinMatch(bytes32 matchId) payable",
  "function cancelMatch(bytes32 matchId)",
  "function settleMatch(bytes32 matchId, uint8 winner)",
  "function withdraw()",
  "function getMatch(bytes32 matchId) view returns (tuple(address playerA, address playerB, uint256 wager, uint8 state, uint8 winner))",
  "function getEarnings(address player) view returns (uint256)",
  "event MatchCreated(bytes32 indexed matchId, address indexed playerA, uint256 wager)",
  "event MatchJoined(bytes32 indexed matchId, address indexed playerB)",
  "event MatchSettled(bytes32 indexed matchId, uint8 winner, uint256 pot)",
];

// Lazy-init so the app starts even if .env isn't configured yet
let _provider, _wallet, _contract;

function getProvider() {
  if (!_provider) {
    _provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  }
  return _provider;
}

function getOperatorWallet() {
  if (!_wallet) {
    if (!process.env.OPERATOR_PRIVATE_KEY) {
      throw new Error('OPERATOR_PRIVATE_KEY not set in .env');
    }
    _wallet = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, getProvider());
  }
  return _wallet;
}

function getContract() {
  if (!_contract) {
    if (!process.env.CONTRACT_ADDRESS) {
      throw new Error('CONTRACT_ADDRESS not set in .env');
    }
    _contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      CONTRACT_ABI,
      getOperatorWallet()
    );
  }
  return _contract;
}

// ── Settle a finished match ──────────────────────────────────────────────────
// winner: 1 = playerA, 2 = playerB, 0 = draw
// This is the critical function — only the server calls this.
async function settleMatch(matchIdHex, winner) {
  console.log(`[blockchain] Settling match ${matchIdHex.slice(0, 12)}... winner=${winner}`);

  const contract = getContract();

  // Estimate gas first so we catch errors before sending
  let gasEstimate;
  try {
    gasEstimate = await contract.estimateGas.settleMatch(matchIdHex, winner);
  } catch (err) {
    throw new Error(`Gas estimation failed: ${err.reason || err.message}`);
  }

  const tx = await contract.settleMatch(matchIdHex, winner, {
    gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
  });

  console.log(`[blockchain] Settle tx sent: ${tx.hash}`);
  const receipt = await tx.wait(1); // wait for 1 confirmation
  console.log(`[blockchain] Confirmed in block ${receipt.blockNumber}`);

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    explorerUrl: `${process.env.EXPLORER_URL}/tx/${tx.hash}`,
  };
}

// ── Cancel an open match ──────────────────────────────────────────────────────
async function cancelMatch(matchIdHex) {
  const contract = getContract();
  const tx = await contract.cancelMatch(matchIdHex);
  const receipt = await tx.wait(1);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

// ── Read on-chain match state ─────────────────────────────────────────────────
async function getMatchOnChain(matchIdHex) {
  const contract = getContract();
  const m = await contract.getMatch(matchIdHex);
  return {
    playerA: m.playerA,
    playerB: m.playerB,
    wager: ethers.utils.formatEther(m.wager),
    state: ['Open', 'Active', 'Settled', 'Cancelled'][m.state] || 'Unknown',
    winner: m.winner,
  };
}

// ── Get player's pending earnings ─────────────────────────────────────────────
async function getEarnings(walletAddress) {
  const contract = getContract();
  const wei = await contract.getEarnings(walletAddress);
  return ethers.utils.formatEther(wei);
}

// ── Verify wallet owns an address (for login) ─────────────────────────────────
// Recovers the signer from a signed message and checks it matches the claimed address
function verifyWalletSignature(message, signature, expectedAddress) {
  try {
    const recovered = ethers.utils.verifyMessage(message, signature);
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
async function checkConnection() {
  try {
    const provider = getProvider();
    const network = await provider.getNetwork();
    const block = await provider.getBlockNumber();
    const operatorAddress = getOperatorWallet().address;
    const balance = await provider.getBalance(operatorAddress);
    return {
      ok: true,
      chainId: network.chainId,
      blockNumber: block,
      operatorAddress,
      operatorBalance: ethers.utils.formatEther(balance) + ' ETH',
      contractAddress: process.env.CONTRACT_ADDRESS,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  settleMatch,
  cancelMatch,
  getMatchOnChain,
  getEarnings,
  verifyWalletSignature,
  checkConnection,
  getProvider,
  getOperatorWallet,
};
