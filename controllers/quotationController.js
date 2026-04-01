const { query, withTransaction } = require('../config/db');
const { sendPush }               = require('../config/firebase');
const { getIO }                  = require('../socket');
const logger                     = require('../config/logger');

// ─── POST /quotations ─────────────────────────────────────────────────────────
const createQuotation = async (req, res, next) => {
  try {
    const { job_id, items, notes } = req.body;
    // items: [{ name, description, quantity, unit_price }]

    if (!items?.length) return res.status(400).json({ error: 'At least one line item required' });
    const total = items.reduce((s, i) => s + (i.unit_price * (i.quantity || 1)), 0);

    const result = await withTransaction(async (client) => {
      const { rows: [quot] } = await client.query(`
        INSERT INTO quotations (job_id, total_amount, notes)
        VALUES ($1, $2, $3) RETURNING *
      `, [job_id, total, notes]);

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        await client.query(`
          INSERT INTO quotation_items (quotation_id, name, description, quantity, unit_price, sort_order)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [quot.id, item.name, item.description || null, item.quantity || 1, item.unit_price, idx]);
      }

      // Move job to waiting_approval
      await client.query(
        `UPDATE jobs SET status = 'waiting_approval', updated_at = NOW() WHERE id = $1`,
        [job_id]
      );
      await client.query(
        `INSERT INTO job_status_history (job_id, status, changed_by, note)
         VALUES ($1,'waiting_approval',$2,'Quotation created – awaiting customer approval')`,
        [job_id, req.user.id]
      );

      return quot;
    });

    // Notify customer
    const { rows: [{ customer_id, fcm }] } = await query(`
      SELECT j.customer_id, u.fcm_token AS fcm FROM jobs j
      JOIN users u ON u.id = j.customer_id WHERE j.id = $1
    `, [job_id]);

    if (fcm) {
      await sendPush({
        token: fcm,
        title: 'Quotation Ready',
        body:  `Your service estimate is AED ${total.toFixed(2)}. Tap to review.`,
        data:  { jobId: job_id, type: 'quotation' },
      });
    }

    getIO()?.to(`job:${job_id}`).emit('quotation:new', { jobId: job_id, total });
    getIO()?.to(`user:${customer_id}`).emit('quotation:new', { jobId: job_id, total });

    logger.info('Quotation created', { jobId: job_id, total });
    res.status(201).json(result);
  } catch (err) { next(err); }
};

// ─── POST /quotations/:id/approve ────────────────────────────────────────────
const approveQuotation = async (req, res, next) => {
  try {
    const { id }     = req.params;
    const { action } = req.body;  // 'approve' | 'decline'

    if (!['approve', 'decline'].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve' or 'decline'" });
    }

    const { rows: [quot] } = await query(
      `SELECT q.*, j.customer_id FROM quotations q JOIN jobs j ON j.id = q.job_id WHERE q.id = $1`,
      [id]
    );
    if (!quot) return res.status(404).json({ error: 'Quotation not found' });
    if (req.user.role === 'customer' && quot.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (quot.approval_status !== 'pending') {
      return res.status(409).json({ error: `Quotation already ${quot.approval_status}` });
    }

    const newStatus = action === 'approve' ? 'approved' : 'declined';
    const timeField = action === 'approve' ? 'approved_at' : 'declined_at';

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE quotations SET approval_status=$1, ${timeField}=NOW(), approved_by=$2, updated_at=NOW() WHERE id=$3`,
        [newStatus, req.user.id, id]
      );

      if (action === 'approve') {
        await client.query(
          `UPDATE jobs SET status='service_completed' WHERE id=$1 AND status='waiting_approval'`,
          // Note: 'in_progress' re-set by advisor; here we just allow proceed
          // Typically approve → status stays 'in_progress', advisor marks done
        );
        // Better: keep status, just record approval
        await client.query(
          `UPDATE jobs SET status='in_progress', updated_at=NOW() WHERE id=$1 AND status='waiting_approval'`,
          [quot.job_id]
        );
        await client.query(
          `INSERT INTO job_status_history (job_id, status, changed_by, note)
           VALUES ($1,'in_progress',$2,'Customer approved quotation – service resumed')`,
          [quot.job_id, req.user.id]
        );
      }
    });

    // Notify coordinator
    const { rows: coordinators } = await query(
      `SELECT fcm_token FROM users WHERE role IN ('coordinator','admin') AND fcm_token IS NOT NULL`
    );
    const tokens = coordinators.map(c => c.fcm_token).filter(Boolean);
    if (tokens.length) {
      const { sendMulticast } = require('../config/firebase');
      await sendMulticast({
        tokens,
        title: action === 'approve' ? 'Quotation Approved ✓' : 'Quotation Declined',
        body:  `Job ${quot.job_id}: customer ${action === 'approve' ? 'approved' : 'declined'} the estimate.`,
        data:  { jobId: quot.job_id, type: 'quotation_response' },
      });
    }

    getIO()?.to(`job:${quot.job_id}`).emit('quotation:response', {
      jobId: quot.job_id, quotationId: id, action: newStatus
    });

    res.json({ quotationId: id, status: newStatus });
  } catch (err) { next(err); }
};

// ─── GET /quotations/job/:jobId ───────────────────────────────────────────────
const getQuotationByJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { rows } = await query(`
      SELECT q.*, json_agg(qi ORDER BY qi.sort_order) AS items
      FROM quotations q LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
      WHERE q.job_id = $1 GROUP BY q.id ORDER BY q.created_at DESC LIMIT 1
    `, [jobId]);
    if (!rows.length) return res.status(404).json({ error: 'No quotation found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

module.exports = { createQuotation, approveQuotation, getQuotationByJob };
