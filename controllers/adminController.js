// controllers/adminController.js
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../config/db');
const { sendEmail } = require('../config/email');
const logger = require('../config/logger');

const SALT_ROUNDS = 12;

// ─── GET /admin/users ─────────────────────────────────────────────────────────
const listUsers = async (req, res, next) => {
  try {
    const { role, search, is_active, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;
    let where = [], params = [], p = 1;

    if (role)      { where.push(`u.role = $${p++}`);              params.push(role); }
    if (is_active !== undefined) { where.push(`u.is_active = $${p++}`); params.push(is_active === 'true'); }
    if (search)    {
      where.push(`(u.name ILIKE $${p} OR u.email ILIKE $${p} OR u.phone ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countParams = [...params];
    params.push(limit, offset);

    const { rows: users } = await query(`
      SELECT
        u.id, u.name, u.email, u.phone, u.role,
        u.is_active, u.last_login_at, u.created_at, u.avatar_url,
        COUNT(j.id) FILTER (WHERE j.status != 'delivered') AS active_jobs,
        COUNT(j.id)                                         AS total_jobs,
        ROUND(AVG(j.customer_rating) FILTER (WHERE j.customer_rating IS NOT NULL), 1) AS avg_rating
      FROM users u
      LEFT JOIN jobs j ON (
        (u.role = 'customer' AND j.customer_id = u.id) OR
        (u.role = 'driver'   AND j.driver_id   = u.id)
      )
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
    `, params);

    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM users u ${whereClause}`, countParams
    );

    // Role summary counts
    const { rows: roleCounts } = await query(`
      SELECT role, COUNT(*) AS count,
             COUNT(*) FILTER (WHERE is_active = TRUE) AS active
      FROM users GROUP BY role
    `);

    res.json({ users, total: parseInt(count), page: parseInt(page), limit: parseInt(limit), roleCounts });
  } catch (err) { next(err); }
};

// ─── GET /admin/users/:id ─────────────────────────────────────────────────────
const getUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(`
      SELECT u.id, u.name, u.email, u.phone, u.role,
             u.is_active, u.last_login_at, u.created_at
      FROM users u WHERE u.id = $1
    `, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    // Recent activity
    const { rows: recentJobs } = await query(`
      SELECT j.id, j.status, j.service_type, j.created_at,
             v.model, v.plate,
             c.name AS customer_name
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id
      JOIN users c ON c.id = j.customer_id
      WHERE j.customer_id = $1 OR j.driver_id = $1
      ORDER BY j.created_at DESC LIMIT 10
    `, [id]);

    res.json({ ...rows[0], recentJobs });
  } catch (err) { next(err); }
};

// ─── POST /admin/users ────────────────────────────────────────────────────────
const createUser = async (req, res, next) => {
  try {
    const { name, email, phone, role, password } = req.body;
    const allowed = ['admin', 'coordinator', 'driver', 'customer'];
    if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const existing = await query(
      `SELECT id FROM users WHERE email = $1 OR phone = $2`,
      [email.toLowerCase(), phone]
    );
    if (existing.rows.length) return res.status(409).json({ error: 'Email or phone already exists' });

    const tempPassword = password || Math.random().toString(36).slice(-10) + 'A1!';
    const password_hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const { rows } = await query(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, email, phone, role, is_active, created_at
    `, [name, email.toLowerCase(), phone, password_hash, role]);

    const user = rows[0];

    // Send welcome email with temp password
    await sendEmail({
      to: user.email,
      templateKey: null,
      job: null,
      _raw: {
        subject: 'Welcome to Honda Service Platform',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#E40521;padding:24px 32px">
              <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:2px">HONDA</h1>
            </div>
            <div style="padding:32px">
              <h2 style="color:#111">Welcome, ${name}!</h2>
              <p style="color:#6B7280">Your account has been created on the Honda Door-to-Door Service Platform.</p>
              <div style="background:#F9FAFB;border-radius:8px;padding:20px;margin:20px 0">
                <p style="margin:0 0 8px;font-size:13px;color:#6B7280">Your login credentials:</p>
                <p style="margin:0 0 4px;font-size:14px"><strong>Email:</strong> ${user.email}</p>
                <p style="margin:0 0 4px;font-size:14px"><strong>Role:</strong> ${role}</p>
                <p style="margin:0;font-size:14px"><strong>Temp Password:</strong> <code style="background:#E5E7EB;padding:2px 6px;border-radius:4px">${tempPassword}</code></p>
              </div>
              <p style="color:#EF4444;font-size:13px">Please change your password after first login.</p>
              <a href="${process.env.FRONTEND_URL}" style="display:inline-block;padding:12px 24px;background:#E40521;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Login Now →</a>
            </div>
          </div>
        `,
      },
    });

    logger.info('User created by admin', { userId: user.id, role, createdBy: req.user.id });
    res.status(201).json({ ...user, tempPassword });
  } catch (err) { next(err); }
};

// ─── PATCH /admin/users/:id ───────────────────────────────────────────────────
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, role } = req.body;

    // Prevent self-role-change
    if (id === req.user.id && role && role !== req.user.role) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const fields = [], params = [], p = { v: 1 };
    if (name)  { fields.push(`name = $${p.v++}`);              params.push(name); }
    if (email) { fields.push(`email = $${p.v++}`);             params.push(email.toLowerCase()); }
    if (phone) { fields.push(`phone = $${p.v++}`);             params.push(phone); }
    if (role)  { fields.push(`role = $${p.v++}`);              params.push(role); }
    fields.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${p.v} RETURNING id, name, email, phone, role, is_active`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    logger.info('User updated', { userId: id, updatedBy: req.user.id });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ─── PATCH /admin/users/:id/status ───────────────────────────────────────────
const toggleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });

    const { rows } = await query(
      `UPDATE users SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 RETURNING id, name, is_active, role`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    // Revoke all refresh tokens if deactivating
    if (!rows[0].is_active) {
      await query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
    }

    logger.info('User status toggled', { userId: id, isActive: rows[0].is_active, by: req.user.id });
    res.json({ id: rows[0].id, name: rows[0].name, is_active: rows[0].is_active });
  } catch (err) { next(err); }
};

// ─── POST /admin/users/:id/reset-password ────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    const { rows: [user] } = await query(
      `SELECT name, email FROM users WHERE id = $1`, [id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tempPassword = newPassword || Math.random().toString(36).slice(-10) + 'A1!';
    const password_hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [password_hash, id]);
      await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
    });

    // Email new password
    await sendEmail({
      to: user.email,
      _raw: {
        subject: 'Honda Service — Password Reset',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#E40521;padding:24px 32px">
              <h1 style="color:#fff;margin:0;font-size:24px">HONDA</h1>
            </div>
            <div style="padding:32px">
              <h2 style="color:#111">Password Reset</h2>
              <p style="color:#6B7280">Hi ${user.name}, your password has been reset by an administrator.</p>
              <div style="background:#F9FAFB;border-radius:8px;padding:20px;margin:20px 0">
                <p style="margin:0;font-size:14px"><strong>New Password:</strong> <code style="background:#E5E7EB;padding:2px 8px;border-radius:4px;font-size:15px">${tempPassword}</code></p>
              </div>
              <p style="color:#EF4444;font-size:13px">Please change this password immediately after login.</p>
              <a href="${process.env.FRONTEND_URL}" style="display:inline-block;padding:12px 24px;background:#E40521;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Login →</a>
            </div>
          </div>
        `,
      },
    });

    logger.info('Password reset by admin', { userId: id, resetBy: req.user.id });
    res.json({ message: 'Password reset successfully', tempPassword });
  } catch (err) { next(err); }
};

// ─── DELETE /admin/users/:id ──────────────────────────────────────────────────
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

    // Check for active jobs
    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM jobs WHERE (customer_id = $1 OR driver_id = $1) AND status != 'delivered'`, [id]
    );
    if (parseInt(count) > 0) {
      return res.status(409).json({ error: `User has ${count} active job(s). Deactivate instead.` });
    }

    await query(`DELETE FROM users WHERE id = $1`, [id]);
    logger.info('User deleted', { userId: id, deletedBy: req.user.id });
    res.json({ message: 'User deleted successfully' });
  } catch (err) { next(err); }
};

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
const getAdminStats = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE role = 'customer')    AS customers,
        COUNT(*) FILTER (WHERE role = 'driver')      AS drivers,
        COUNT(*) FILTER (WHERE role = 'coordinator') AS coordinators,
        COUNT(*) FILTER (WHERE role = 'admin')       AS admins,
        COUNT(*) FILTER (WHERE is_active = FALSE)    AS deactivated,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS new_this_week
      FROM users
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
};

module.exports = { listUsers, getUser, createUser, updateUser, toggleStatus, resetPassword, deleteUser, getAdminStats };
