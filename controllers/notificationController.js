const { query }  = require('../config/db');
const { sendPush, sendMulticast } = require('../config/firebase');
const { getIO }  = require('../socket');
const logger     = require('../config/logger');

// ─── GET /notifications ───────────────────────────────────────────────────────
const listNotifications = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT * FROM notifications WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [req.user.id]);
    const unread = rows.filter(n => !n.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (err) { next(err); }
};

// ─── PATCH /notifications/read ────────────────────────────────────────────────
const markAllRead = async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ message: 'All notifications marked read' });
  } catch (err) { next(err); }
};

// ─── POST /notifications/broadcast (admin only) ───────────────────────────────
const broadcast = async (req, res, next) => {
  try {
    const { title, body, role, job_id } = req.body;

    const whereRole = role ? `AND role = '${role}'` : '';
    const { rows: users } = await query(
      `SELECT id, fcm_token FROM users WHERE is_active = TRUE ${whereRole}`
    );

    // Insert in-app notifications
    await Promise.all(users.map(u =>
      query(
        `INSERT INTO notifications (user_id, job_id, title, body, type, sent_via)
         VALUES ($1,$2,$3,$4,'broadcast',ARRAY['push'])`,
        [u.id, job_id || null, title, body]
      )
    ));

    // FCM multicast
    const tokens = users.map(u => u.fcm_token).filter(Boolean);
    if (tokens.length) {
      await sendMulticast({ tokens, title, body, data: { type: 'broadcast', jobId: job_id || '' } });
    }

    // Socket.io broadcast
    getIO()?.emit('notification:broadcast', { title, body, jobId: job_id });

    logger.info('Broadcast sent', { role, usersCount: users.length });
    res.json({ sent: users.length, pushTokens: tokens.length });
  } catch (err) { next(err); }
};

module.exports = { listNotifications, markAllRead, broadcast };
