// src/db/database.js
// Uses sql.js — pure JavaScript SQLite, no compiling needed on Windows.
// Data is persisted to disk manually using fs.writeFileSync.

const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = path.resolve(process.env.DB_PATH || './kickbase.db');
let db;
let sqljs;

// Save DB to disk every 30 seconds and on every write
function persistDb() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch(e) {
    console.error('[db] Failed to persist:', e.message);
  }
}

async function getDb() {
  if (db) return db;

  // Load sql.js
  if (!sqljs) {
    const initSqlJs = require('sql.js');
    sqljs = await initSqlJs();
  }

  // Load existing DB from disk if it exists
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new sqljs.Database(fileBuffer);
  } else {
    db = new sqljs.Database();
  }

  setupSchema();
  persistDb();

  // Auto-save every 30 seconds
  setInterval(persistDb, 30000);

  return db;
}

function setupSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      email       TEXT    UNIQUE,
      password_hash TEXT,
      avatar      TEXT    DEFAULT '⚽',
      wallet      TEXT    UNIQUE,
      twitter     TEXT,
      discord     TEXT,
      wins        INTEGER DEFAULT 0,
      losses      INTEGER DEFAULT 0,
      draws       INTEGER DEFAULT 0,
      total_wagered TEXT  DEFAULT '0',
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      last_seen   INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id_hex  TEXT    UNIQUE NOT NULL,
      player_a_id   INTEGER,
      player_b_id   INTEGER,
      player_a_team TEXT,
      player_b_team TEXT,
      wager_amount  TEXT    NOT NULL,
      wager_wei     TEXT    NOT NULL,
      status        TEXT    DEFAULT 'open',
      winner        INTEGER DEFAULT 0,
      score_a       INTEGER DEFAULT 0,
      score_b       INTEGER DEFAULT 0,
      tx_create     TEXT,
      tx_join       TEXT,
      tx_settle     TEXT,
      created_at    INTEGER DEFAULT (strftime('%s','now')),
      started_at    INTEGER,
      ended_at      INTEGER
    );

    CREATE TABLE IF NOT EXISTS lobby (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id_hex TEXT,
      player_id   INTEGER,
      amount_eth  REAL    NOT NULL,
      message     TEXT,
      is_open     INTEGER DEFAULT 1,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
}

// Helper: run a query that returns rows
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const results = [];
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run a query that modifies data
function run(sql, params = []) {
  db.run(sql, params);
  persistDb();
  // Return last inserted rowid
  const result = query('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: result[0]?.id };
}

// Helper: get a single row
function get(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

// ── User helpers ──────────────────────────────────────────────────────────────
const userQueries = {
  findByUsername: (username) =>
    get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]),

  findByEmail: (email) =>
    get('SELECT * FROM users WHERE email = ?', [email]),

  findByWallet: (wallet) =>
    get('SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)', [wallet]),

  findById: (id) =>
    get('SELECT * FROM users WHERE id = ?', [id]),

  create: (data) =>
    run(
      `INSERT INTO users (username, email, password_hash, avatar, wallet, twitter, discord)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.username, data.email, data.password_hash, data.avatar,
       data.wallet, data.twitter, data.discord]
    ),

  updateLastSeen: (id) =>
    run(`UPDATE users SET last_seen = strftime('%s','now') WHERE id = ?`, [id]),

  updateStats: (id, result) => {
    const col = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
    run(`UPDATE users SET ${col} = ${col} + 1 WHERE id = ?`, [id]);
  },

  isUsernameTaken: (username) =>
    !!get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [username]),

  getLeaderboard: (limit = 20) =>
    query(
      `SELECT username, avatar, wins, losses, draws, total_wagered
       FROM users ORDER BY wins DESC LIMIT ?`,
      [limit]
    ),
};

// ── Match helpers ─────────────────────────────────────────────────────────────
const matchQueries = {
  create: (data) =>
    run(
      `INSERT INTO matches (match_id_hex, player_a_id, wager_amount, wager_wei, tx_create)
       VALUES (?, ?, ?, ?, ?)`,
      [data.match_id_hex, data.player_a_id, data.wager_amount, data.wager_wei, data.tx_create]
    ),

  findByHex: (hexId) =>
    get('SELECT * FROM matches WHERE match_id_hex = ?', [hexId]),

  join: (hexId, playerBId, txJoin) =>
    run(
      `UPDATE matches SET player_b_id = ?, tx_join = ?, status = 'active',
       started_at = strftime('%s','now') WHERE match_id_hex = ? AND status = 'open'`,
      [playerBId, txJoin, hexId]
    ),

  setTeams: (hexId, teamA, teamB) =>
    run(
      `UPDATE matches SET player_a_team = ?, player_b_team = ? WHERE match_id_hex = ?`,
      [teamA, teamB, hexId]
    ),

  settle: (hexId, winner, scoreA, scoreB, txSettle) =>
    run(
      `UPDATE matches SET status = 'settled', winner = ?, score_a = ?, score_b = ?,
       tx_settle = ?, ended_at = strftime('%s','now') WHERE match_id_hex = ?`,
      [winner, scoreA, scoreB, txSettle, hexId]
    ),

  cancel: (hexId) =>
    run(`UPDATE matches SET status = 'cancelled' WHERE match_id_hex = ?`, [hexId]),

  getOpen: () =>
    query(
      `SELECT m.*, u.username as player_a_name, u.avatar as player_a_avatar
       FROM matches m LEFT JOIN users u ON u.id = m.player_a_id
       WHERE m.status = 'open' ORDER BY m.created_at DESC LIMIT 50`
    ),

  getPlayerHistory: (userId, limit = 20) =>
    query(
      `SELECT m.*, ua.username as player_a_name, ub.username as player_b_name
       FROM matches m
       LEFT JOIN users ua ON ua.id = m.player_a_id
       LEFT JOIN users ub ON ub.id = m.player_b_id
       WHERE m.player_a_id = ? OR m.player_b_id = ?
       ORDER BY m.created_at DESC LIMIT ?`,
      [userId, userId, limit]
    ),
};

module.exports = { getDb, userQueries, matchQueries };
