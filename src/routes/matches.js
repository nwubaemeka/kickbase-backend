const express = require('express');
const { ethers } = require('ethers');
const { getDb, matchQueries, userQueries } = require('../db/database');
const { settleMatch, cancelMatch, getMatchOnChain } = require('../services/blockchain');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await getDb(); next(); } catch(e) { res.status(500).json({ error: 'DB not ready' }); }
});

router.get('/lobby', optionalAuth, (req, res) => {
  try {
    res.json({ matches: matchQueries.getOpen() });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch lobby' });
  }
});

router.post('/create', requireAuth, (req, res) => {
  try {
    const { matchIdHex, wagerEth, txHash } = req.body;
    if (!matchIdHex || !wagerEth)
      return res.status(400).json({ error: 'matchIdHex and wagerEth required' });
    if (!/^0x[0-9a-fA-F]{64}$/.test(matchIdHex))
      return res.status(400).json({ error: 'Invalid matchIdHex format' });

    const wagerWei = ethers.utils.parseEther(wagerEth.toString()).toString();
    matchQueries.create({
      match_id_hex: matchIdHex, player_a_id: req.user.id,
      wager_amount: wagerEth.toString(), wager_wei: wagerWei, tx_create: txHash || null,
    });
    return res.status(201).json({ message: 'Match created', match: matchQueries.findByHex(matchIdHex) });
  } catch (err) {
    console.error('[create match]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/join', requireAuth, (req, res) => {
  try {
    const { matchIdHex, txHash } = req.body;
    if (!matchIdHex) return res.status(400).json({ error: 'matchIdHex required' });
    const match = matchQueries.findByHex(matchIdHex);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'open') return res.status(409).json({ error: `Match is ${match.status}` });
    if (match.player_a_id === req.user.id)
      return res.status(400).json({ error: 'Cannot play against yourself' });

    matchQueries.join(matchIdHex, req.user.id, txHash || null);
    return res.json({ message: 'Joined match', match: matchQueries.findByHex(matchIdHex) });
  } catch (err) {
    console.error('[join match]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/settle', requireAuth, async (req, res) => {
  try {
    const { matchIdHex, winner, scoreA, scoreB } = req.body;
    if (winner === undefined || ![0,1,2].includes(parseInt(winner)))
      return res.status(400).json({ error: 'winner must be 0, 1, or 2' });

    const match = matchQueries.findByHex(matchIdHex);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'active')
      return res.status(409).json({ error: `Match is already ${match.status}` });
    if (match.player_a_id !== req.user.id && match.player_b_id !== req.user.id)
      return res.status(403).json({ error: 'Not a player in this match' });

    let txResult;
    try {
      txResult = await settleMatch(matchIdHex, parseInt(winner));
    } catch (contractErr) {
      return res.status(502).json({ error: 'Contract error: ' + contractErr.message });
    }

    matchQueries.settle(matchIdHex, parseInt(winner), scoreA || 0, scoreB || 0, txResult.txHash);

    const w = parseInt(winner);
    if (w === 1) {
      userQueries.updateStats(match.player_a_id, 'win');
      userQueries.updateStats(match.player_b_id, 'loss');
    } else if (w === 2) {
      userQueries.updateStats(match.player_b_id, 'win');
      userQueries.updateStats(match.player_a_id, 'loss');
    } else {
      if (match.player_a_id) userQueries.updateStats(match.player_a_id, 'draw');
      if (match.player_b_id) userQueries.updateStats(match.player_b_id, 'draw');
    }

    return res.json({ message: 'Settled', txHash: txResult.txHash, explorerUrl: txResult.explorerUrl, winner: w });
  } catch (err) {
    console.error('[settle]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const { matchIdHex } = req.body;
    const match = matchQueries.findByHex(matchIdHex);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.player_a_id !== req.user.id)
      return res.status(403).json({ error: 'Only the creator can cancel' });
    if (match.status !== 'open')
      return res.status(409).json({ error: 'Can only cancel open matches' });

    await cancelMatch(matchIdHex);
    matchQueries.cancel(matchIdHex);
    return res.json({ message: 'Match cancelled and funds refunded' });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/history/:userId', requireAuth, (req, res) => {
  try {
    res.json({ matches: matchQueries.getPlayerHistory(req.params.userId) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:matchId', optionalAuth, async (req, res) => {
  try {
    const match = matchQueries.findByHex(req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    let onChain = null;
    try { onChain = await getMatchOnChain(req.params.matchId); } catch {}
    res.json({ match, onChain });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
