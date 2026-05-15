require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { getDb } = require('./db/database');
const { initSocket } = require('./services/socket');
const { checkConnection } = require('./services/blockchain');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '50kb' }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { error: 'Too many auth attempts' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

app.get('/health', async (req, res) => {
  const chain = await checkConnection();
  res.json({ status: 'ok', timestamp: new Date().toISOString(), blockchain: chain });
});

const PORT = process.env.PORT || 3001;

getDb().then(db => {
  console.log('[db] Database ready');

  const authRoutes  = require('./routes/auth');
  const matchRoutes = require('./routes/matches');
  const userRoutes  = require('./routes/users');

  app.use('/api/auth',    authRoutes);
  app.use('/api/matches', matchRoutes);
  app.use('/api/users',   userRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  initSocket(io);

  server.listen(PORT, () => {
    console.log('KickBase running on port ' + PORT);
    checkConnection().then(c => {
      if (c.ok) console.log('Chain OK:', c.chainId, '| Block:', c.blockNumber);
      else console.warn('Blockchain not connected:', c.error);
    });
  });

}).catch(err => {
  console.error('[startup] DB failed:', err);
  process.exit(1);
});

module.exports = { app };
