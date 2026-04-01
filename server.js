require('dotenv').config();

const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const rateLimit = require('express-rate-limit');
const fs      = require('fs');

const logger  = require('./config/logger');
const { initSocket } = require('./socket');
const routes  = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { pool } = require('./config/db');

// ─── Create upload dir ────────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const LOGS_DIR   = './logs';
[UPLOAD_DIR, LOGS_DIR].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow image serving
}));

// CORS
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
}));

// Rate limiting
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many auth requests, please try again later' },
}));
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Rate limit exceeded' },
}));

// Logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip:   (req) => req.url === '/api/health',
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads
app.use('/uploads', express.static(path.resolve(UPLOAD_DIR)));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000');
const httpServer = http.createServer(app);

// Init Socket.io
initSocket(httpServer);

// Test DB then listen
pool.query('SELECT NOW()')
  .then(() => {
    logger.info('PostgreSQL connected ✓');
    httpServer.listen(PORT, () => {
      logger.info(`🚗 Honda Service API running on http://localhost:${PORT}`);
      logger.info(`🔌 WebSocket ready`);
      logger.info(`📚 Routes: /api/auth | /api/jobs | /api/inspections | /api/quotations`);
    });
  })
  .catch((err) => {
    logger.error('DB connection failed', { err: err.message });
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  httpServer.close(() => {
    pool.end(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

module.exports = app;
