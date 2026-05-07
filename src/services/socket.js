// src/services/socket.js
// Real-time features:
//  - Live lobby updates (new wagers, accepted wagers)
//  - In-game state sync between 2 players (ball position, score, timer)
//  - Automatic settlement trigger when game ends

const { matchQueries } = require('../db/database');

// Track active game rooms: matchIdHex -> { playerA, playerB, gameState }
const activeGames = new Map();
// Track online users: socketId -> { userId, username }
const onlineUsers = new Map();

function initSocket(io) {

  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.id}`);

    // ── User identifies themselves ──────────────────────────────────────────
    socket.on('identify', ({ userId, username }) => {
      onlineUsers.set(socket.id, { userId, username });
      io.emit('online_count', onlineUsers.size);
      console.log(`[socket] ${username} (${userId}) identified`);
    });

    // ── Join lobby room (to receive wager updates) ──────────────────────────
    socket.on('join_lobby', () => {
      socket.join('lobby');
      // Send current open matches
      socket.emit('lobby_state', { matches: matchQueries.getOpen() });
    });

    // ── New wager posted (broadcast to lobby) ────────────────────────────────
    socket.on('wager_posted', (wagerData) => {
      io.to('lobby').emit('new_wager', wagerData);
    });

    // ── Wager accepted ───────────────────────────────────────────────────────
    socket.on('wager_accepted', ({ matchIdHex, playerB }) => {
      io.to('lobby').emit('wager_taken', { matchIdHex, playerB });
    });

    // ── Join a specific game room ────────────────────────────────────────────
    socket.on('join_game', ({ matchIdHex, userId, role }) => {
      socket.join(`game:${matchIdHex}`);

      if (!activeGames.has(matchIdHex)) {
        activeGames.set(matchIdHex, {
          playerA: null, playerB: null,
          scoreA: 0, scoreB: 0,
          timeLeft: 90 * 60,
          status: 'waiting',
          gameEvents: [],
        });
      }

      const game = activeGames.get(matchIdHex);
      if (role === 'playerA') game.playerA = { socketId: socket.id, userId };
      if (role === 'playerB') game.playerB = { socketId: socket.id, userId };

      // If both players joined, start the game
      if (game.playerA && game.playerB && game.status === 'waiting') {
        game.status = 'active';
        io.to(`game:${matchIdHex}`).emit('game_start', { matchIdHex });
        console.log(`[socket] Game started: ${matchIdHex.slice(0,12)}...`);
      }

      socket.emit('game_state', game);
    });

    // ── Ball/player position updates (sent ~60fps from each player) ──────────
    // We relay these to the other player in the room
    socket.on('game_update', ({ matchIdHex, update }) => {
      socket.to(`game:${matchIdHex}`).emit('game_update', update);
    });

    // ── Score update ─────────────────────────────────────────────────────────
    socket.on('score_update', ({ matchIdHex, scoreA, scoreB }) => {
      const game = activeGames.get(matchIdHex);
      if (game) {
        game.scoreA = scoreA;
        game.scoreB = scoreB;
        io.to(`game:${matchIdHex}`).emit('score_update', { scoreA, scoreB });
      }
    });

    // ── Game ended (triggered by timer expiry on either client) ──────────────
    socket.on('game_ended', async ({ matchIdHex, scoreA, scoreB }) => {
      const game = activeGames.get(matchIdHex);
      if (!game || game.status === 'settled') return;

      game.status = 'settled';
      const winner = scoreA > scoreB ? 1 : scoreB > scoreA ? 2 : 0;

      // Notify both players the game is over; they'll call /api/matches/settle
      io.to(`game:${matchIdHex}`).emit('game_over', {
        matchIdHex, scoreA, scoreB, winner,
        message: winner === 0 ? "It's a draw!" :
                 winner === 1 ? 'Player A wins!' : 'Player B wins!'
      });

      console.log(`[socket] Game ended: ${matchIdHex.slice(0,12)}... Score: ${scoreA}-${scoreB}`);
      activeGames.delete(matchIdHex);
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const user = onlineUsers.get(socket.id);
      onlineUsers.delete(socket.id);
      io.emit('online_count', onlineUsers.size);

      // If a player disconnects mid-game, notify opponent
      for (const [matchIdHex, game] of activeGames.entries()) {
        if (game.playerA?.socketId === socket.id || game.playerB?.socketId === socket.id) {
          io.to(`game:${matchIdHex}`).emit('opponent_disconnected', {
            message: `${user?.username || 'Opponent'} disconnected`,
          });
          // Auto-forfeit after 30 seconds if they don't reconnect
          setTimeout(() => {
            const g = activeGames.get(matchIdHex);
            if (g && g.status === 'active') {
              const winner = g.playerA?.socketId === socket.id ? 2 : 1;
              io.to(`game:${matchIdHex}`).emit('game_over', {
                matchIdHex,
                scoreA: g.scoreA, scoreB: g.scoreB,
                winner, message: 'Opponent forfeited (disconnected)',
              });
              activeGames.delete(matchIdHex);
            }
          }, 30000);
        }
      }
      console.log(`[socket] Disconnected: ${socket.id}`);
    });
  });

  // Broadcast online count every 10 seconds
  setInterval(() => {
    io.emit('online_count', onlineUsers.size);
  }, 10000);
}

module.exports = { initSocket };
