// src/services/socket.js
const activeGames = new Map();
const onlineUsers = new Map();

function initSocket(io) {
  io.on('connection', (socket) => {
    socket.on('identify', ({ userId, username }) => {
      onlineUsers.set(socket.id, { userId, username, socketId: socket.id });
      io.emit('online_count', onlineUsers.size);
    });

    socket.on('join_lobby', () => { socket.join('lobby'); });

    socket.on('wager_posted', (wagerData) => {
      socket.to('lobby').emit('new_wager', wagerData);
    });

    socket.on('wager_accepted', ({ matchIdHex, playerBName }) => {
      io.to('lobby').emit('wager_taken', { matchIdHex });
      io.to(`game:${matchIdHex}`).emit('opponent_accepted', { matchIdHex, playerBName });
    });

    socket.on('join_game', ({ matchIdHex, userId, role }) => {
      socket.join(`game:${matchIdHex}`);
      if (!activeGames.has(matchIdHex)) {
        activeGames.set(matchIdHex, { playerA: null, playerB: null, scoreA: 0, scoreB: 0, teamsReady: { playerA: false, playerB: false }, status: 'waiting' });
      }
      const game = activeGames.get(matchIdHex);
      const user = onlineUsers.get(socket.id);
      if (role === 'playerA') game.playerA = { socketId: socket.id, userId };
      if (role === 'playerB') {
        game.playerB = { socketId: socket.id, userId };
        if (game.playerA) {
          io.to(game.playerA.socketId).emit('opponent_accepted', { matchIdHex, playerBName: user?.username || 'Opponent' });
        }
      }
    });

    socket.on('team_selected', ({ matchIdHex, role, teamIdx }) => {
      const game = activeGames.get(matchIdHex);
      if (!game) return;
      if (role === 'playerA') game.teamsReady.playerA = true;
      if (role === 'playerB') game.teamsReady.playerB = true;
      socket.to(`game:${matchIdHex}`).emit('opponent_team', { role, teamIdx });
      if (game.teamsReady.playerA && game.teamsReady.playerB) {
        io.to(`game:${matchIdHex}`).emit('both_ready');
        game.status = 'active';
      }
    });

    socket.on('match_started', ({ matchIdHex }) => {
      const game = activeGames.get(matchIdHex);
      if (game) game.status = 'active';
    });

    socket.on('game_update', ({ matchIdHex, update }) => {
      socket.to(`game:${matchIdHex}`).emit('game_update', update);
    });

    socket.on('score_update', ({ matchIdHex, scoreA, scoreB }) => {
      const game = activeGames.get(matchIdHex);
      if (game) { game.scoreA = scoreA; game.scoreB = scoreB; }
    });

    socket.on('game_ended', ({ matchIdHex, scoreA, scoreB }) => {
      const game = activeGames.get(matchIdHex);
      if (!game || game.status === 'settled') return;
      game.status = 'settled';
      const winner = scoreA > scoreB ? 1 : scoreB > scoreA ? 2 : 0;
      io.to(`game:${matchIdHex}`).emit('game_over', { matchIdHex, scoreA, scoreB, winner });
      setTimeout(() => activeGames.delete(matchIdHex), 60000);
    });

    socket.on('disconnect', () => {
      const user = onlineUsers.get(socket.id);
      onlineUsers.delete(socket.id);
      io.emit('online_count', onlineUsers.size);
      for (const [matchIdHex, game] of activeGames.entries()) {
        if ((game.playerA?.socketId === socket.id || game.playerB?.socketId === socket.id) && game.status === 'active') {
          socket.to(`game:${matchIdHex}`).emit('opponent_disconnected', { message: `${user?.username || 'Opponent'} disconnected. 30s to reconnect.` });
          setTimeout(() => {
            const g = activeGames.get(matchIdHex);
            if (g && g.status === 'active') {
              const winner = g.playerA?.socketId === socket.id ? 2 : 1;
              io.to(`game:${matchIdHex}`).emit('game_over', { matchIdHex, scoreA: g.scoreA, scoreB: g.scoreB, winner });
              activeGames.delete(matchIdHex);
            }
          }, 30000);
        }
      }
    });
  });

  setInterval(() => io.emit('online_count', onlineUsers.size), 10000);
}

module.exports = { initSocket };
