# KickBase — Complete Deployment Guide
## From your computer to a live website, step by step

---

## WHAT YOU HAVE

| File | Purpose |
|---|---|
| `auth.html` | Sign up / Log in page |
| `soccer-web3.html` | The game (lobby + match + settlement) |
| `KickBaseEscrow.sol` | Smart contract (handles ETH wagers on-chain) |
| `kickbase-backend/` | Node.js server (settlement, auth, lobby API) |

---

## PHASE 1 — TOOLS TO INSTALL FIRST
*(Do this once on your computer)*

### 1.1 Install Node.js
- Go to **https://nodejs.org** → download the **LTS** version → install it
- Open a terminal and confirm: `node --version` should print `v18` or higher

### 1.2 Install Git
- Go to **https://git-scm.com** → download for your OS → install it
- Confirm: `git --version`

### 1.3 Install MetaMask
- Go to **https://metamask.io** → Add to Chrome/Firefox → create a wallet
- Write down your seed phrase and store it safely

### 1.4 Create free accounts (all free tier is fine)
- **GitHub**: https://github.com/signup
- **Vercel**: https://vercel.com/signup (use your GitHub account)
- **Render**: https://render.com/register (use your GitHub account)

---

## PHASE 2 — DEPLOY THE SMART CONTRACT

### 2.1 Get test ETH (Base Sepolia)
1. Open MetaMask → click the network dropdown → select **Base Sepolia Testnet**
   - If it's not listed: go to https://chainlist.org, search "Base Sepolia", click "Add to MetaMask"
2. Go to **https://faucet.quicknode.com/base/sepolia**
3. Paste your MetaMask wallet address → click "Get ETH"
4. You'll receive 0.1 test ETH (enough for many deployments + test matches)

### 2.2 Deploy using Remix IDE (no coding needed)
1. Go to **https://remix.ethereum.org**
2. In the left sidebar, click the **Files** icon → click **New File**
3. Name it `KickBaseEscrow.sol`
4. Copy the entire contents of your `KickBaseEscrow.sol` file and paste it in
5. Click the **Solidity Compiler** icon (looks like an "S") in the left sidebar
   - Set compiler version to **0.8.20**
   - Click **Compile KickBaseEscrow.sol**
   - You should see a green checkmark — no errors
6. Click the **Deploy & Run** icon (looks like an Ethereum diamond) in the left sidebar
   - Under **Environment**, select **Injected Provider - MetaMask**
   - MetaMask will pop up — make sure it's on **Base Sepolia** network
   - Under **Contract**, make sure `KickBaseEscrow` is selected
   - Under **Deploy**, you'll see a field for `_owner` — paste your MetaMask wallet address
   - Click **Deploy** → MetaMask pops up → confirm the transaction
7. After ~10 seconds, under **Deployed Contracts** at the bottom, you'll see your contract
   - **Copy the contract address** (starts with 0x...) — you'll need this soon
   - You can verify it at https://sepolia.basescan.org by pasting the address

---

## PHASE 3 — SET UP THE BACKEND

### 3.1 Install backend dependencies
Open your terminal, navigate to the `kickbase-backend` folder:
```
cd kickbase-backend
npm install
```

### 3.2 Create your .env file
In the `kickbase-backend` folder, create a file named `.env` (copy from `.env.example`):
```
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

JWT_SECRET=<generate this: run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">

RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

OPERATOR_PRIVATE_KEY=<your MetaMask private key — see note below>
CONTRACT_ADDRESS=<the address you copied from Remix>

DB_PATH=./kickbase.db
EXPLORER_URL=https://sepolia.basescan.org
```

**How to get your MetaMask private key (KEEP THIS SECRET):**
1. Open MetaMask → click the 3 dots next to your account → Account Details
2. Click "Show private key" → enter your MetaMask password → copy the key
3. Paste it as `OPERATOR_PRIVATE_KEY` in your `.env` file
4. **Never share this key with anyone. Never commit it to GitHub.**

### 3.3 Test the connection
```
npm test
```
You should see:
```
✅ Connected to chain ID: 84532
✅ Operator wallet: 0xYour...Address
✅ Contract is readable
✅ All checks passed!
```

### 3.4 Run the backend locally
```
npm run dev
```
You should see:
```
KickBase Backend — Running
http://localhost:3001
✅ Chain: 84532 | Block: 12345678
✅ Contract: 0xYour...ContractAddress
```

---

## PHASE 4 — RUN THE FRONTEND LOCALLY

Since the frontend is plain HTML, just open the files in your browser:
1. Open `auth.html` in Chrome/Firefox to test sign up
2. Open `soccer-web3.html` to test the lobby and game

For both files, the line:
```javascript
const API_BASE = window.KICKBASE_API || 'http://localhost:3001';
```
...already points to your local backend. No changes needed for local testing.

---

## PHASE 5 — PUT IT ALL ONLINE

### 5.1 Deploy the backend to Render (free)

1. Push your backend code to GitHub:
   ```
   cd kickbase-backend
   git init
   git add .
   git commit -m "Initial KickBase backend"
   ```
   - Go to https://github.com/new → create a repo named `kickbase-backend`
   - Follow the instructions to push (GitHub will show you the exact commands)

2. Go to **https://render.com** → click **New +** → **Web Service**
3. Connect your GitHub account → select `kickbase-backend`
4. Fill in:
   - **Name**: kickbase-backend
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Scroll down to **Environment Variables** → click "Add from .env" or add each one manually:
   - `JWT_SECRET` → your generated secret
   - `RPC_URL` → `https://sepolia.base.org`
   - `CHAIN_ID` → `84532`
   - `OPERATOR_PRIVATE_KEY` → your private key *(Render encrypts this)*
   - `CONTRACT_ADDRESS` → your deployed contract address
   - `EXPLORER_URL` → `https://sepolia.basescan.org`
   - `FRONTEND_URL` → your Vercel URL (you'll get this in the next step — come back and update it)
6. Click **Create Web Service**
7. Render will build and deploy. After ~2 minutes, you'll get a URL like:
   `https://kickbase-backend.onrender.com`
   → **Copy this URL**

### 5.2 Update the frontend with your backend URL

In both `auth.html` and `soccer-web3.html`, find this line near the top of the `<script>`:
```javascript
const API_BASE = window.KICKBASE_API || 'http://localhost:3001';
```
Change `'http://localhost:3001'` to your Render URL:
```javascript
const API_BASE = window.KICKBASE_API || 'https://kickbase-backend.onrender.com';
```
Do this in both files and save.

### 5.3 Deploy the frontend to Vercel (free)

1. Create a folder on your computer called `kickbase-frontend`
2. Put these 3 files inside it:
   - `auth.html` → rename to `index.html` (this is the first page people see)
   - `soccer-web3.html` (keep this name)
   - `KickBaseEscrow.sol` (optional, can leave out)
3. Go to **https://vercel.com** → click **Add New Project**
4. Click **Browse** (or drag and drop the `kickbase-frontend` folder)
5. Click **Deploy** — Vercel deploys in ~30 seconds
6. You'll get a URL like: `https://kickbase.vercel.app`

### 5.4 Link everything together

1. Go back to **Render** → your `kickbase-backend` service → **Environment**
2. Update `FRONTEND_URL` to your Vercel URL (e.g. `https://kickbase.vercel.app`)
3. Click **Save Changes** — Render will restart the server automatically

---

## PHASE 6 — TEST END-TO-END

1. Open your Vercel URL (e.g. `https://kickbase.vercel.app`)
2. Sign up for an account — use any email, connect your MetaMask on Base Sepolia
3. Open the URL in a **second browser** (or incognito window) for Player B
4. Sign up as a second player
5. Player A: click **Enter Lobby** → set a wager (e.g. 0.001 ETH) → Post Wager
6. Player B: see the wager in the lobby → click Accept → MetaMask will ask to confirm sending 0.001 ETH
7. Both players select teams → game starts
8. Play the match — use WASD and arrow keys
9. When the timer hits 0, the backend automatically calls `settleMatch()` on the contract
10. Winner's wallet receives both wager amounts (minus 1% fee)
11. Check the transaction on https://sepolia.basescan.org

---

## PHASE 7 — SWITCH TO MAINNET (when ready)

When you're confident everything works on testnet, make these 4 changes:

**In `.env` (Render environment variables):**
```
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453
EXPLORER_URL=https://basescan.org
```

**In `soccer-web3.html`:**
```javascript
chainId: 8453,
chainHex: '0x2105',
explorerBase: 'https://basescan.org',
```
And update the `wallet_addEthereumChain` block:
```javascript
chainName: 'Base',
rpcUrls: ['https://mainnet.base.org'],
blockExplorerUrls: ['https://basescan.org'],
```

**Re-deploy the contract** to mainnet (same Remix steps, but with real ETH for gas — ~$0.05 on Base).
Update `CONTRACT_ADDRESS` in Render environment variables.

---

## TROUBLESHOOTING

| Problem | Fix |
|---|---|
| MetaMask says "wrong network" | Click the network name in MetaMask and switch to Base Sepolia |
| Wager fails with "insufficient funds" | Get more test ETH at faucet.quicknode.com/base/sepolia |
| Backend says "Contract not found" | Double-check CONTRACT_ADDRESS in your .env — must match exactly |
| Render server keeps sleeping (free tier) | Free tier sleeps after 15min. Upgrade to $7/mo Starter to keep it awake |
| CORS error in browser console | Make sure FRONTEND_URL in Render matches your exact Vercel URL |
| "JWT_SECRET not set" error | Generate one: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |

---

## SUMMARY CHECKLIST

- [ ] Installed Node.js, Git, MetaMask
- [ ] Created GitHub, Vercel, and Render accounts
- [ ] Got test ETH from Base Sepolia faucet
- [ ] Deployed KickBaseEscrow.sol via Remix
- [ ] Copied contract address
- [ ] Created .env file with all values filled in
- [ ] Ran `npm test` — all checks passed
- [ ] Pushed backend to GitHub
- [ ] Deployed backend on Render
- [ ] Updated API_BASE in both HTML files with Render URL
- [ ] Deployed frontend on Vercel
- [ ] Updated FRONTEND_URL in Render with Vercel URL
- [ ] Tested a full match end-to-end on testnet
- [ ] (Later) Re-deployed to mainnet when ready
