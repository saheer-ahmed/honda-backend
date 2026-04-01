const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../config/db');
const logger = require('../config/logger');

const SALT_ROUNDS = 12;

const signAccess = (userId, role) =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

const signRefresh = (userId) =>
  jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

// ─── POST /auth/register ─────────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const { name, email, phone, password, role = 'customer' } = req.body;
    const allowedRoles = ['customer', 'driver', 'coordinator'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check duplicates
    const existing = await query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email.toLowerCase(), phone]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, role, created_at`,
      [name, email.toLowerCase(), phone, password_hash, role]
    );

    const user         = rows[0];
    const accessToken  = signAccess(user.id, user.role);
    const refreshToken = signRefresh(user.id);

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    logger.info('User registered', { userId: user.id, role: user.role });
    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) { next(err); }
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, phone, password, fcmToken } = req.body;
    const identifier = email || phone;

    const { rows } = await query(
      `SELECT id, name, email, phone, role, password_hash, is_active, fcm_token
       FROM users WHERE email = $1 OR phone = $1`,
      [identifier]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];

    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Update FCM token and last login
    await query(
      `UPDATE users SET fcm_token = $1, last_login_at = NOW() WHERE id = $2`,
      [fcmToken || user.fcm_token, user.id]
    );

    const accessToken  = signAccess(user.id, user.role);
    const refreshToken = signRefresh(user.id);

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    const { password_hash, ...safeUser } = user;
    logger.info('User logged in', { userId: user.id, role: user.role });

    res.json({ user: safeUser, accessToken, refreshToken });
  } catch (err) { next(err); }
};

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const { rows } = await query(
      `SELECT rt.id, u.id as user_id, u.role, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refreshToken]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Refresh token revoked or expired' });
    }

    const { user_id, role } = rows[0];

    // Rotate token
    const newRefresh = signRefresh(user_id);
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user_id, newRefresh]
    );

    res.json({ accessToken: signAccess(user_id, role), refreshToken: newRefresh });
  } catch (err) { next(err); }
};

// ─── POST /auth/logout ────────────────────────────────────────────────────────
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    // Clear FCM token on logout
    if (req.user?.id) {
      await query('UPDATE users SET fcm_token = NULL WHERE id = $1', [req.user.id]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
};

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
const me = async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, email, phone, role, avatar_url, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json(rows[0]);
};

// ─── PUT /auth/fcm-token ──────────────────────────────────────────────────────
const updateFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    await query('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcmToken, req.user.id]);
    res.json({ message: 'FCM token updated' });
  } catch (err) { next(err); }
};

module.exports = { register, login, refresh, logout, me, updateFcmToken };
