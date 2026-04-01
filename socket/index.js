const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const { query }  = require('../config/db');
const logger     = require('../config/logger');

let io = null;

const getIO = () => io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ─── Auth middleware ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await query(
        `SELECT id, name, role FROM users WHERE id = $1 AND is_active = TRUE`,
        [payload.userId]
      );
      if (!rows.length) return next(new Error('User not found'));

      socket.user = rows[0];
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ─── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id: userId, role, name } = socket.user;
    logger.debug('Socket connected', { userId, role, socketId: socket.id });

    // Join personal room
    socket.join(`user:${userId}`);

    // Join role room
    if (role === 'coordinator' || role === 'admin') socket.join('coordinators');
    if (role === 'driver')                           socket.join('drivers');

    // ─── Client subscribes to a specific job ─────────────────────────────────
    socket.on('job:subscribe', async ({ jobId }) => {
      if (!jobId) return;
      // Verify access
      const { rows } = await query(
        `SELECT id FROM jobs WHERE id = $1 AND (customer_id = $2 OR driver_id = $2)`,
        [jobId, userId]
      );
      if (rows.length || ['coordinator','admin'].includes(role)) {
        socket.join(`job:${jobId}`);
        socket.emit('job:subscribed', { jobId });
        logger.debug('Socket subscribed to job', { userId, jobId });
      }
    });

    socket.on('job:unsubscribe', ({ jobId }) => socket.leave(`job:${jobId}`));

    // ─── Driver location broadcast ────────────────────────────────────────────
    socket.on('driver:location', ({ jobId, lat, lng }) => {
      if (role !== 'driver') return;
      // Broadcast to anyone watching this job
      io.to(`job:${jobId}`).emit('driver:location', { driverId: userId, lat, lng, ts: Date.now() });
      // Also to coordinators
      io.to('coordinators').emit('driver:location', { driverId: userId, name, lat, lng, jobId });
    });

    // ─── Driver status (online/offline) ──────────────────────────────────────
    socket.on('driver:status', ({ status }) => {
      if (role !== 'driver') return;
      io.to('coordinators').emit('driver:status', { driverId: userId, name, status });
    });

    // ─── Typing indicator for in-app chat (future) ────────────────────────────
    socket.on('chat:typing', ({ jobId }) => {
      socket.to(`job:${jobId}`).emit('chat:typing', { userId, name });
    });

    socket.on('disconnect', (reason) => {
      if (role === 'driver') {
        io.to('coordinators').emit('driver:status', { driverId: userId, name, status: 'offline' });
      }
      logger.debug('Socket disconnected', { userId, reason });
    });
  });

  logger.info('Socket.io initialized');
  return io;
};

module.exports = { initSocket, getIO };
