// src/routes/oauth.js
// Real Twitter (X) and Discord OAuth2 integration
// 
// SETUP REQUIRED:
//  Twitter: https://developer.twitter.com → create app → get Client ID + Secret
//  Discord: https://discord.com/developers → create app → OAuth2 → get Client ID + Secret
//
// Add these to your Render environment variables:
//  TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
//  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
//  FRONTEND_URL (your Vercel URL)

const express = require('express');
const router = express.Router();

const BACKEND_URL = process.env.BACKEND_URL || 'https://kickbase-backend.onrender.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://kickbase.vercel.app';

// ── TWITTER OAuth2 ────────────────────────────────────────────────────────────
router.get('/twitter', (req, res) => {
  if (!process.env.TWITTER_CLIENT_ID) {
    return res.send(popupResponse('twitter', null, 'Twitter OAuth not configured. Add TWITTER_CLIENT_ID to Render.'));
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/oauth/twitter/callback`,
    scope: 'tweet.read users.read offline.access',
    state: 'kickbase_twitter',
    code_challenge: 'challenge',
    code_challenge_method: 'plain',
  });
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

router.get('/twitter/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(popupResponse('twitter', null, error || 'Auth cancelled'));

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${BACKEND_URL}/api/auth/oauth/twitter/callback`,
        code_verifier: 'challenge',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    // Get user info
    const userRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    const username = userData.data?.username;

    res.send(popupResponse('twitter', username));
  } catch (e) {
    res.send(popupResponse('twitter', null, e.message));
  }
});

// ── DISCORD OAuth2 ────────────────────────────────────────────────────────────
router.get('/discord', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID) {
    return res.send(popupResponse('discord', null, 'Discord OAuth not configured. Add DISCORD_CLIENT_ID to Render.'));
  }
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/oauth/discord/callback`,
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(popupResponse('discord', null, error || 'Auth cancelled'));

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${BACKEND_URL}/api/auth/oauth/discord/callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    const username = userData.username + (userData.discriminator && userData.discriminator !== '0' ? '#' + userData.discriminator : '');

    res.send(popupResponse('discord', username));
  } catch (e) {
    res.send(popupResponse('discord', null, e.message));
  }
});

// Sends a message to the parent window (the auth page) and closes the popup
function popupResponse(provider, username, error = null) {
  return `<!DOCTYPE html><html><body><script>
    window.opener.postMessage(
      ${JSON.stringify({ provider, username, error })},
      '${FRONTEND_URL}'
    );
    window.close();
  </script></body></html>`;
}

module.exports = router;
