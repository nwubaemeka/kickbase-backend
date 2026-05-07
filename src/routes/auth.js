const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, userQueries } = require('../db/database');
const { verifyWalletSignature } = require('../services/blockchain');
const { signToken, requireAuth } = require('../middleware/auth');
const { ethers } = require('ethers');

const router = express.Router();

// Ensure DB is ready before any route runs
router.use(async (req, res, next) => {
  try { await getDb(); next(); } catch(e) { res.status(500).json({ error: 'DB not ready' }); }
});

router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, avatar, wallet, twitter, discord } = req.body;
    if (!username || username.length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
      return res.status(400).json({ error: 'Username: letters, numbers and _ only (3-20 chars)' });
    if (!email && !wallet)
      return res.status(400).json({ error: 'Email or wallet address required' });
    if (userQueries.isUsernameTaken(username))
      return res.status(409).json({ error: 'Username already taken' });
    if (email && userQueries.findByEmail(email))
      return res.status(409).json({ error: 'Email already registered' });
    if (wallet && userQueries.findByWallet(wallet))
      return res.status(409).json({ error: 'Wallet already registered' });

    let checksummedWallet = null;
    if (wallet) {
      try { checksummedWallet = ethers.utils.getAddress(wallet); }
      catch { return res.status(400).json({ error: 'Invalid wallet address' }); }
    }

    let passwordHash = null;
    if (password) {
      if (password.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      passwordHash = await bcrypt.hash(password, 12);
    }

    const result = userQueries.create({
      username, email: email || null, password_hash: passwordHash,
      avatar: avatar || '⚽', wallet: checksummedWallet,
      twitter: twitter || null, discord: discord || null,
    });

    const user = userQueries.findById(result.lastInsertRowid);
    const token = signToken(user.id);
    return res.status(201).json({ message: 'Account created!', token, user: safeUser(user) });
  } catch (err) {
    console.error('[signup]', err);
    return res.status(500).json({ error: 'Server error during signup' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      return res.status(400).json({ error: 'Email/username and password required' });

    const user = userQueries.findByEmail(identifier) ||
                 userQueries.findByUsername(identifier.replace('@', ''));
    if (!user || !user.password_hash)
      return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/wallet-login', async (req, res) => {
  try {
    const { wallet, message, signature } = req.body;
    if (!wallet || !message || !signature)
      return res.status(400).json({ error: 'wallet, message and signature required' });

    const valid = verifyWalletSignature(message, signature, wallet);
    if (!valid) return res.status(401).json({ error: 'Signature verification failed' });

    const tsMatch = message.match(/Timestamp:\s*(\d+)/);
    if (!tsMatch || Date.now() - parseInt(tsMatch[1]) > 5 * 60 * 1000)
      return res.status(401).json({ error: 'Signature expired. Please sign again.' });

    let user = userQueries.findByWallet(wallet);
    if (!user) {
      const shortWallet = wallet.slice(0, 6) + '_' + wallet.slice(-4);
      userQueries.create({
        username: shortWallet, email: null, password_hash: null,
        avatar: '⚽', wallet: ethers.utils.getAddress(wallet),
        twitter: null, discord: null,
      });
      user = userQueries.findByWallet(wallet);
    }

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('[wallet-login]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

router.get('/check-username', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username required' });
  res.json({ available: !userQueries.isUsernameTaken(username) });
});

function safeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

module.exports = router;
