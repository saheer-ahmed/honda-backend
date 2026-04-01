const jwt    = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../config/logger');

// Verify access token and attach user to req
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
      return res.status(401).json({ error: msg });
    }

    // Load fresh user from DB (catches deactivated accounts)
    const { rows } = await query(
      'SELECT id, name, email, phone, role, fcm_token, is_active FROM users WHERE id = $1',
      [payload.userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Account not found or deactivated' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    logger.error('Auth middleware error', { err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Role-based access guard
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: `Access denied. Required: ${roles.join(' or ')}` });
  }
  next();
};

// Convenience guards
const isAdmin       = requireRole('admin');
const isCoordinator = requireRole('admin', 'coordinator');
const isDriver      = requireRole('admin', 'coordinator', 'driver');
const isCustomer    = requireRole('customer');
const isStaff       = requireRole('admin', 'coordinator', 'driver');

module.exports = { authenticate, requireRole, isAdmin, isCoordinator, isDriver, isCustomer, isStaff };
