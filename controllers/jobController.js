// controllers/jobController.js  (replace existing)
const { query, withTransaction } = require('../config/db');
const { sendPush, sendMulticast } = require('../config/firebase');
const { sendEmail }              = require('../config/email');
const logger                     = require('../config/logger');
const { getIO }                  = require('../socket');

const STATUS_TRANSITIONS = {
  booking_confirmed: ['driver_assigned'],
  driver_assigned:   ['vehicle_picked_up'],
  vehicle_picked_up: ['inspection_done'],
  inspection_done:   ['at_workshop'],
  at_workshop:       ['in_progress'],
  in_progress:       ['waiting_approval', 'service_completed'],
  waiting_approval:  ['in_progress', 'service_completed'],
  service_completed: ['ready_delivery'],
  ready_delivery:    ['out_delivery'],
  out_delivery:      ['delivered'],
  delivered:         [],
};

const PUSH_MESSAGES = {
  driver_assigned:   { title: 'Driver Assigned 🚗',      body: 'Your driver has been assigned and will contact you shortly.' },
  vehicle_picked_up: { title: 'Vehicle Picked Up ✓',     body: 'Your vehicle has been safely collected by our driver.' },
  inspection_done:   { title: 'Inspection Complete',      body: 'Initial inspection done. Vehicle is heading to the workshop.' },
  at_workshop:       { title: 'Vehicle at Workshop',      body: 'Your vehicle has arrived at Honda Service Center.' },
  in_progress:       { title: 'Service Started 🔧',       body: 'Work has begun on your vehicle.' },
  waiting_approval:  { title: '⚠️ Approval Required',    body: 'Your service quotation is ready. Tap to review and approve.' },
  service_completed: { title: 'Service Complete! ✅',     body: 'Your vehicle has been serviced and is ready for delivery.' },
  ready_delivery:    { title: 'Ready for Delivery 🚚',    body: 'Your vehicle will be delivered to you soon.' },
  out_delivery:      { title: 'On the Way! 🚗',           body: 'Your driver is heading to your location with your vehicle.' },
  delivered:         { title: 'Vehicle Delivered! 🎉',   body: 'Your Honda is back. Thank you for choosing our service!' },
};

const EMAIL_TRIGGERS = new Set(['booking_confirmed', 'driver_assigned', 'waiting_approval', 'delivered']);

// ─── Notify customer (push + email) ──────────────────────────────────────────
const notifyCustomer = async (job, status, quotation = null) => {
  const { rows: [customer] } = await query(
    `SELECT name, email, fcm_token FROM users WHERE id = $1`, [job.customer_id]
  );
  if (!customer) return;

  // Push
  if (customer.fcm_token && PUSH_MESSAGES[status]) {
    const { title, body } = PUSH_MESSAGES[status];
    await sendPush({
      token: customer.fcm_token, title, body,
      data: { jobId: job.id, status, type: 'status_update' },
    });
  }

  // Email
  if (EMAIL_TRIGGERS.has(status) && customer.email) {
    await sendEmail({
      to:          customer.email,
      templateKey: status,
      job:         { ...job, driver_name: job.driver_name, driver_phone: job.driver_phone },
      quotation,
    });
  }

  // In-app notification
  await query(
    `INSERT INTO notifications (user_id, job_id, title, body, type, sent_via)
     VALUES ($1, $2, $3, $4, 'status_update', ARRAY['push','email'])`,
    [job.customer_id, job.id,
     PUSH_MESSAGES[status]?.title || status,
     PUSH_MESSAGES[status]?.body  || '']
  );
};

// ─── GET /jobs ────────────────────────────────────────────────────────────────
const listJobs = async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;
    const { status, driver_id, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;
    let where = [], params = [], p = 1;

    if (role === 'customer') { where.push(`j.customer_id = $${p++}`); params.push(userId); }
    else if (role === 'driver') { where.push(`j.driver_id = $${p++}`); params.push(userId); }
    if (status)    { where.push(`j.status = $${p++}`);    params.push(status); }
    if (driver_id && role !== 'driver') { where.push(`j.driver_id = $${p++}`); params.push(driver_id); }
    if (search) {
      where.push(`(j.id ILIKE $${p} OR c.name ILIKE $${p} OR v.plate ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countParams = [...params];
    params.push(limit, offset);

    const { rows: jobs } = await query(`
      SELECT j.id, j.status, j.service_type, j.pickup_address,
             j.scheduled_pickup_at, j.actual_pickup_at, j.delivered_at, j.created_at,
             j.customer_rating,
             c.name AS customer_name, c.phone AS customer_phone,
             v.make, v.model, v.year, v.plate, v.color,
             d.name AS driver_name, d.phone AS driver_phone,
             a.name AS advisor_name,
             sc.name AS service_center_name,
             q.total_amount, q.approval_status AS quotation_status
      FROM jobs j
      JOIN users c ON c.id = j.customer_id
      JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN users d ON d.id = j.driver_id
      LEFT JOIN users a ON a.id = j.advisor_id
      LEFT JOIN service_centers sc ON sc.id = j.service_center_id
      LEFT JOIN quotations q ON q.job_id = j.id
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
    `, params);

    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM jobs j JOIN users c ON c.id = j.customer_id JOIN vehicles v ON v.id = j.vehicle_id ${whereClause}`,
      countParams
    );

    res.json({ jobs, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

// ─── GET /jobs/:id ─────────────────────────────────────────────────────────────
const getJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    const { rows } = await query(`
      SELECT j.*,
             c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
             v.make, v.model, v.year, v.plate, v.color, v.vin,
             d.name AS driver_name, d.phone AS driver_phone,
             a.name AS advisor_name,
             sc.name AS service_center_name, sc.address AS service_center_address
      FROM jobs j
      JOIN users c ON c.id = j.customer_id
      JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN users d ON d.id = j.driver_id
      LEFT JOIN users a ON a.id = j.advisor_id
      LEFT JOIN service_centers sc ON sc.id = j.service_center_id
      WHERE j.id = $1
    `, [id]);

    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = rows[0];

    if (role === 'customer' && job.customer_id !== userId) return res.status(403).json({ error: 'Access denied' });
    if (role === 'driver'   && job.driver_id   !== userId) return res.status(403).json({ error: 'Access denied' });

    const [{ rows: history }, { rows: inspRows }, { rows: quotRows }, { rows: tasks }] = await Promise.all([
      query(`SELECT jsh.*, u.name AS changed_by_name FROM job_status_history jsh
             LEFT JOIN users u ON u.id = jsh.changed_by WHERE jsh.job_id = $1 ORDER BY jsh.created_at ASC`, [id]),
      query(`SELECT i.*, array_agg(ip.url) FILTER (WHERE ip.url IS NOT NULL) AS photos
             FROM inspections i LEFT JOIN inspection_photos ip ON ip.inspection_id = i.id
             WHERE i.job_id = $1 GROUP BY i.id`, [id]),
      query(`SELECT q.*, json_agg(qi ORDER BY qi.sort_order) AS items
             FROM quotations q LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
             WHERE q.job_id = $1 GROUP BY q.id`, [id]),
      query(`SELECT dt.*, u.name AS driver_name FROM driver_tasks dt
             JOIN users u ON u.id = dt.driver_id WHERE dt.job_id = $1`, [id]),
    ]);

    res.json({ ...job, timeline: history, inspection: inspRows[0] || null, quotation: quotRows[0] || null, tasks });
  } catch (err) { next(err); }
};

// ─── POST /jobs ────────────────────────────────────────────────────────────────
const createJob = async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;
    const { customer_id, vehicle_id, service_type, pickup_address,
            pickup_lat, pickup_lng, scheduled_pickup_at, service_center_id, notes } = req.body;
    const cid = role === 'customer' ? userId : customer_id;

    const { rows } = await query(`
      INSERT INTO jobs (customer_id, vehicle_id, service_type, pickup_address,
                        pickup_lat, pickup_lng, scheduled_pickup_at, service_center_id,
                        coordinator_id, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [cid, vehicle_id, service_type, pickup_address, pickup_lat, pickup_lng,
        scheduled_pickup_at, service_center_id, role !== 'customer' ? userId : null, notes]);

    const job = rows[0];
    await query(`INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,'booking_confirmed',$2,'Job created')`, [job.id, userId]);

    // Notify customer
    const { rows: [customer] } = await query(`SELECT name, email, fcm_token FROM users WHERE id = $1`, [cid]);
    const { rows: [vehicle] }  = await query(`SELECT make, model, year, plate FROM vehicles WHERE id = $1`, [vehicle_id]);
    await sendEmail({ to: customer.email, templateKey: 'booking_confirmed', job: { ...job, ...vehicle } });
    if (customer.fcm_token) {
      await sendPush({ token: customer.fcm_token, title: 'Booking Confirmed ✓', body: `Your ${vehicle.model} service has been booked. Ref: ${job.id}`, data: { jobId: job.id, type: 'booking' } });
    }

    // Notify coordinators
    getIO()?.to('coordinators').emit('job:new', { jobId: job.id, serviceType: service_type });
    logger.info('Job created', { jobId: job.id });
    res.status(201).json(job);
  } catch (err) { next(err); }
};

// ─── PATCH /jobs/:id/status ────────────────────────────────────────────────────
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    const { id: userId } = req.user;

    const { rows } = await query(`
      SELECT j.*, c.name AS customer_name, c.email AS customer_email, c.fcm_token,
             v.model, v.year, v.plate,
             d.name AS driver_name, d.phone AS driver_phone
      FROM jobs j
      JOIN users c ON c.id = j.customer_id
      JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN users d ON d.id = j.driver_id
      WHERE j.id = $1
    `, [id]);

    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = rows[0];

    const allowed = STATUS_TRANSITIONS[job.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from '${job.status}' to '${status}'`, allowed });
    }

    await withTransaction(async (client) => {
      await client.query(`UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
      await client.query(`INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,$2,$3,$4)`, [id, status, userId, note || null]);
      if (status === 'vehicle_picked_up') await client.query(`UPDATE jobs SET actual_pickup_at = NOW() WHERE id = $1`, [id]);
      if (status === 'delivered')         await client.query(`UPDATE jobs SET delivered_at = NOW() WHERE id = $1`, [id]);
    });

    // Fetch latest quotation for email
    let quotation = null;
    if (status === 'waiting_approval') {
      const { rows: [q] } = await query(`SELECT q.*, json_agg(qi ORDER BY qi.sort_order) AS items FROM quotations q LEFT JOIN quotation_items qi ON qi.quotation_id = q.id WHERE q.job_id = $1 GROUP BY q.id`, [id]);
      quotation = q;
    }

    await notifyCustomer(job, status, quotation);

    const io = getIO();
    if (io) {
      io.to(`job:${id}`).emit('job:status_update', { jobId: id, status, note, changedBy: userId });
      io.to('coordinators').emit('job:status_update', { jobId: id, status });
    }

    logger.info('Status updated', { jobId: id, from: job.status, to: status });
    res.json({ jobId: id, status });
  } catch (err) { next(err); }
};

// ─── PATCH /jobs/:id/assign-driver ────────────────────────────────────────────
const assignDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { driver_id, scheduled_at } = req.body;
    const { rows: [driver] } = await query(`SELECT id, name, phone, fcm_token FROM users WHERE id = $1 AND role = 'driver' AND is_active = TRUE`, [driver_id]);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    await withTransaction(async (client) => {
      await client.query(`UPDATE jobs SET driver_id = $1, status = 'driver_assigned', updated_at = NOW() WHERE id = $2`, [driver_id, id]);
      await client.query(`INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,'driver_assigned',$2,$3)`, [id, req.user.id, `Driver ${driver.name} assigned`]);
      if (scheduled_at) {
        await client.query(`INSERT INTO driver_tasks (job_id, driver_id, task_type, address, scheduled_at) SELECT $1,$2,'pickup',pickup_address,$3 FROM jobs WHERE id = $1`, [id, driver_id, scheduled_at]);
      }
    });

    // Notify driver
    if (driver.fcm_token) {
      await sendPush({ token: driver.fcm_token, title: 'New Pickup Task 🚗', body: `You have been assigned to job ${id}.`, data: { jobId: id, type: 'driver_assigned' } });
    }

    // Notify customer
    const { rows: [job] } = await query(`SELECT j.*, v.model, v.year, v.plate FROM jobs j JOIN vehicles v ON v.id = j.vehicle_id WHERE j.id = $1`, [id]);
    await notifyCustomer({ ...job, driver_name: driver.name, driver_phone: driver.phone }, 'driver_assigned');

    getIO()?.to(`user:${driver_id}`).emit('task:new', { jobId: id });
    getIO()?.to(`job:${id}`).emit('job:status_update', { jobId: id, status: 'driver_assigned' });

    res.json({ message: 'Driver assigned', driverName: driver.name });
  } catch (err) { next(err); }
};

// ─── GET /jobs/stats ───────────────────────────────────────────────────────────
const getStats = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*)                                                      AS total,
        COUNT(*) FILTER (WHERE status = 'delivered')                  AS completed,
        COUNT(*) FILTER (WHERE status = 'waiting_approval')           AS awaiting_approval,
        COUNT(*) FILTER (WHERE status NOT IN ('delivered','booking_confirmed')) AS active,
        COUNT(*) FILTER (WHERE status = 'ready_delivery')             AS ready_delivery,
        COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE)       AS today,
        ROUND(AVG(customer_rating) FILTER (WHERE customer_rating IS NOT NULL), 1) AS avg_rating
      FROM jobs
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ─── POST /jobs/:id/rating ─────────────────────────────────────────────────────
const submitRating = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating, feedback } = req.body;
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
    const { rows } = await query(`UPDATE jobs SET customer_rating = $1, customer_feedback = $2, updated_at = NOW() WHERE id = $3 AND customer_id = $4 AND status = 'delivered' RETURNING id`, [rating, feedback, id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found or not delivered' });
    res.json({ message: 'Thank you for your feedback!' });
  } catch (err) { next(err); }
};

module.exports = { listJobs, getJob, createJob, updateStatus, assignDriver, getStats, submitRating };
