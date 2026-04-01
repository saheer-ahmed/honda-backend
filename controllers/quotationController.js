// controllers/quotationController.js (replace existing)
const { query, withTransaction } = require('../config/db');
const { sendPush, sendMulticast } = require('../config/firebase');
const { sendEmail }              = require('../config/email');
const { getIO }                  = require('../socket');
const logger                     = require('../config/logger');

// Standard Honda service catalog for the quotation builder
const SERVICE_CATALOG = [
  { id: 'oil_synthetic',   name: 'Engine Oil Change (0W-20 Synthetic)',  price: 280, category: 'Engine' },
  { id: 'oil_standard',    name: 'Engine Oil Change (5W-30 Standard)',   price: 200, category: 'Engine' },
  { id: 'oil_filter',      name: 'Oil Filter Replacement',               price: 45,  category: 'Engine' },
  { id: 'air_filter',      name: 'Air Filter',                           price: 120, category: 'Engine' },
  { id: 'cabin_filter',    name: 'Cabin Air Filter',                     price: 95,  category: 'Interior' },
  { id: 'spark_plugs',     name: 'Spark Plugs (set of 4)',               price: 320, category: 'Engine' },
  { id: 'brake_fluid',     name: 'Brake Fluid Flush',                    price: 180, category: 'Brakes' },
  { id: 'brake_pads_f',    name: 'Front Brake Pads',                     price: 380, category: 'Brakes' },
  { id: 'brake_pads_r',    name: 'Rear Brake Pads',                      price: 320, category: 'Brakes' },
  { id: 'brake_discs_f',   name: 'Front Brake Discs',                    price: 580, category: 'Brakes' },
  { id: 'tire_rotation',   name: 'Tire Rotation',                        price: 100, category: 'Tires' },
  { id: 'tire_balancing',  name: 'Wheel Balancing (4 wheels)',           price: 160, category: 'Tires' },
  { id: 'wheel_alignment', name: 'Wheel Alignment',                      price: 220, category: 'Tires' },
  { id: 'coolant_topup',   name: 'Coolant Top-up',                       price: 60,  category: 'Cooling' },
  { id: 'coolant_flush',   name: 'Coolant Flush & Refill',               price: 220, category: 'Cooling' },
  { id: 'ac_gas',          name: 'AC Gas Refill (R134a)',                price: 350, category: 'AC' },
  { id: 'ac_service',      name: 'AC Full Service',                      price: 450, category: 'AC' },
  { id: 'ac_filter',       name: 'AC Condenser Cleaning',                price: 180, category: 'AC' },
  { id: 'battery_check',   name: 'Battery Test & Check',                 price: 0,   category: 'Electrical' },
  { id: 'battery_replace', name: 'Battery Replacement (55Ah)',           price: 420, category: 'Electrical' },
  { id: 'wiper_blades',    name: 'Wiper Blades (pair)',                  price: 120, category: 'Exterior' },
  { id: 'inspection',      name: 'Multi-Point Inspection',               price: 0,   category: 'General' },
  { id: 'labor_std',       name: 'Labor (Standard)',                     price: 315, category: 'Labor' },
  { id: 'labor_major',     name: 'Labor (Major Service)',                price: 450, category: 'Labor' },
];

// ─── GET /quotations/catalog ──────────────────────────────────────────────────
const getCatalog = async (req, res) => {
  const grouped = SERVICE_CATALOG.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  res.json({ items: SERVICE_CATALOG, grouped });
};

// ─── POST /quotations ─────────────────────────────────────────────────────────
const createQuotation = async (req, res, next) => {
  try {
    const { job_id, items, notes, discount = 0 } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'At least one item required' });

    const subtotal = items.reduce((s, i) => s + (parseFloat(i.unit_price) * (i.quantity || 1)), 0);
    const total    = Math.max(0, subtotal - parseFloat(discount));

    const result = await withTransaction(async (client) => {
      // Delete previous pending quotation if exists
      await client.query(`DELETE FROM quotations WHERE job_id = $1 AND approval_status = 'pending'`, [job_id]);

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

      await client.query(`UPDATE jobs SET status = 'waiting_approval', updated_at = NOW() WHERE id = $1`, [job_id]);
      await client.query(`INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,'waiting_approval',$2,'Quotation created')`, [job_id, req.user.id]);

      return { ...quot, items };
    });

    // Notify customer push + email
    const { rows: [row] } = await query(`
      SELECT j.customer_id, u.fcm_token, u.email, u.name,
             v.model, v.year, v.plate, j.service_type, j.id
      FROM jobs j JOIN users u ON u.id = j.customer_id JOIN vehicles v ON v.id = j.vehicle_id
      WHERE j.id = $1
    `, [job_id]);

    if (row?.fcm_token) {
      await sendPush({
        token: row.fcm_token,
        title: '⚠️ Approval Required',
        body:  `Your service estimate is AED ${total.toFixed(0)}. Tap to review.`,
        data:  { jobId: job_id, type: 'quotation' },
      });
    }
    if (row?.email) {
      await sendEmail({
        to: row.email, templateKey: 'waiting_approval',
        job: { id: row.id, year: row.year, model: row.model, plate: row.plate, service_type: row.service_type },
        quotation: { total_amount: total, items },
      });
    }

    // In-app notification
    await query(`INSERT INTO notifications (user_id, job_id, title, body, type, sent_via) VALUES ($1,$2,'Quotation Ready','Your service estimate is AED ${total.toFixed(0)}. Please review.','quotation',ARRAY['push','email'])`, [row.customer_id, job_id]);

    getIO()?.to(`job:${job_id}`).emit('quotation:new', { jobId: job_id, total });
    getIO()?.to(`user:${row.customer_id}`).emit('quotation:new', { jobId: job_id, total });

    logger.info('Quotation created', { jobId: job_id, total });
    res.status(201).json(result);
  } catch (err) { next(err); }
};

// ─── POST /quotations/:id/respond ─────────────────────────────────────────────
const approveQuotation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    if (!['approve','decline'].includes(action)) return res.status(400).json({ error: "action must be 'approve' or 'decline'" });

    const { rows: [quot] } = await query(`SELECT q.*, j.customer_id FROM quotations q JOIN jobs j ON j.id = q.job_id WHERE q.id = $1`, [id]);
    if (!quot) return res.status(404).json({ error: 'Quotation not found' });
    if (req.user.role === 'customer' && quot.customer_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (quot.approval_status !== 'pending') return res.status(409).json({ error: `Already ${quot.approval_status}` });

    const newStatus = action === 'approve' ? 'approved' : 'declined';
    const timeField = action === 'approve' ? 'approved_at' : 'declined_at';

    await withTransaction(async (client) => {
      await client.query(`UPDATE quotations SET approval_status=$1, ${timeField}=NOW(), approved_by=$2, updated_at=NOW() WHERE id=$3`, [newStatus, req.user.id, id]);
      if (action === 'approve') {
        await client.query(`UPDATE jobs SET status='in_progress', updated_at=NOW() WHERE id=$1`, [quot.job_id]);
        await client.query(`INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,'in_progress',$2,'Customer approved quotation')`, [quot.job_id, req.user.id]);
      }
    });

    // Notify coordinators
    const { rows: coordinators } = await query(`SELECT fcm_token FROM users WHERE role IN ('coordinator','admin') AND fcm_token IS NOT NULL`);
    const tokens = coordinators.map(c => c.fcm_token).filter(Boolean);
    if (tokens.length) {
      await sendMulticast({
        tokens, title: action === 'approve' ? 'Quotation Approved ✓' : 'Quotation Declined',
        body: `Job ${quot.job_id}: customer ${action === 'approve' ? 'approved' : 'declined'} the estimate.`,
        data: { jobId: quot.job_id, type: 'quotation_response' },
      });
    }

    getIO()?.to(`job:${quot.job_id}`).emit('quotation:response', { jobId: quot.job_id, quotationId: id, action: newStatus });
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

module.exports = { createQuotation, approveQuotation, getQuotationByJob, getCatalog };
