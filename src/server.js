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

// Trust Render's proxy
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '50kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message: { error: 'Too many requests, slow down' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  message: { error: 'Too many auth attempts' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// Health check (no auth needed)
app.get('/health', async (req, res) => {
  const chain = await checkConnection();
  res.json({ status: 'ok', timestamp: new Date().toISOString(), blockchain: chain });
});

const PORT = process.env.PORT || 3001;

// Init DB first, then register routes, then start server
getDb().then(db => {
  console.log('[db] Database ready');

  // Load and register routes AFTER db is ready
  const authRoutes  = require('./routes/auth');
  const matchRoutes = require('./routes/matches');
  const userRoutes  = require('./routes/users');
  const oauthRoutes = require('./routes/oauth');

  app.use('/api/auth',          authRoutes);
  app.use('/api/auth/oauth',    oauthRoutes);
  app.use('/api/matches',       matchRoutes);
  app.use('/api/users',         userRoutes);

  // 404 handler must come AFTER all routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  initSocket(io);

  server.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════╗
  ║   KickBase Backend — Running          ║
  ║   http://localhost:${PORT}              ║
  ╚═══════════════════════════════════════╝
    `);
    checkConnection().then(c => {
      if (c.ok) {
        console.log(`  ✅ Chain ID: ${c.chainId} | Block: ${c.blockNumber}`);
        console.log(`  ✅ Operator: ${c.operatorAddress} (${c.operatorBalance})`);
        console.log(`  ✅ Contract: ${c.contractAddress}\n`);
      } else {
        console.warn(`  ⚠️  Blockchain not connected: ${c.error}\n`);
      }
    });
  });

}).catch(err => {
  console.error('[startup] Failed to initialise database:', err);
  process.exit(1);
});

module.exports = { app };
