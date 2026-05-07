const express = require('express');
const { getDb, userQueries, matchQueries } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { getEarnings } = require('../services/blockchain');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await getDb(); next(); } catch(e) { res.status(500).json({ error: 'DB not ready' }); }
});

router.get('/leaderboard', (req, res) => {
  try { res.json({ leaderboard: userQueries.getLeaderboard(20) }); }
  catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/me/earnings', requireAuth, async (req, res) => {
  try {
    if (!req.user.wallet) return res.json({ earnings: '0', wallet: null });
    const earnings = await getEarnings(req.user.wallet);
    res.json({ earnings, wallet: req.user.wallet });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch earnings' });
  }
});

router.get('/:username', (req, res) => {
  try {
    const user = userQueries.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password_hash, email, ...publicProfile } = user;
    const history = matchQueries.getPlayerHistory(user.id, 10);
    res.json({ user: publicProfile, recentMatches: history });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
