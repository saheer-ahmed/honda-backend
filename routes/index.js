const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');
const validate = require('../middleware/validate');

const authCtrl  = require('../controllers/authController');
const jobCtrl   = require('../controllers/jobController');
const inspCtrl  = require('../controllers/inspectionController');
const quotCtrl  = require('../controllers/quotationController');
const notiCtrl  = require('../controllers/notificationController');

const { authenticate, requireRole, isCoordinator, isDriver } = require('../middleware/auth');

// ─── AUTH ─────────────────────────────────────────────────────────────────────
router.post('/auth/register', [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('phone').trim().notEmpty(),
  body('password').isLength({ min: 8 }),
], validate, authCtrl.register);

router.post('/auth/login', [
  body('password').notEmpty(),
], validate, authCtrl.login);

router.post('/auth/refresh', [body('refreshToken').notEmpty()], validate, authCtrl.refresh);
router.post('/auth/logout',  authenticate, authCtrl.logout);
router.get('/auth/me',       authenticate, authCtrl.me);
router.put('/auth/fcm-token', authenticate, [body('fcmToken').notEmpty()], validate, authCtrl.updateFcmToken);

// ─── JOBS ─────────────────────────────────────────────────────────────────────
router.get('/jobs/stats',        authenticate, isCoordinator, jobCtrl.getStats);
router.get('/jobs',              authenticate, jobCtrl.listJobs);
router.get('/jobs/:id',          authenticate, jobCtrl.getJob);
router.post('/jobs', authenticate, [
  body('vehicle_id').isUUID(),
  body('service_type').notEmpty(),
  body('pickup_address').notEmpty(),
], validate, jobCtrl.createJob);

router.patch('/jobs/:id/status', authenticate, isDriver, [
  body('status').notEmpty(),
], validate, jobCtrl.updateStatus);

router.patch('/jobs/:id/assign-driver', authenticate, isCoordinator, [
  body('driver_id').isUUID(),
], validate, jobCtrl.assignDriver);

router.post('/jobs/:id/rating', authenticate, requireRole('customer'), [
  body('rating').isInt({ min: 1, max: 5 }),
], validate, jobCtrl.submitRating);

// ─── INSPECTIONS ──────────────────────────────────────────────────────────────
router.post('/inspections',              authenticate, isDriver, inspCtrl.upsertInspection);
router.post('/inspections/:jobId/photos', authenticate, isDriver, inspCtrl.uploadPhotos);
router.post('/inspections/:jobId/sign',  authenticate, inspCtrl.customerSign);
router.get('/inspections/:jobId',        authenticate, inspCtrl.getInspection);

// ─── QUOTATIONS ───────────────────────────────────────────────────────────────
router.post('/quotations', authenticate, isCoordinator, [
  body('job_id').notEmpty(),
  body('items').isArray({ min: 1 }),
], validate, quotCtrl.createQuotation);

router.post('/quotations/:id/respond', authenticate, [
  body('action').isIn(['approve', 'decline']),
], validate, quotCtrl.approveQuotation);

router.get('/quotations/job/:jobId', authenticate, quotCtrl.getQuotationByJob);

// ─── VEHICLES ─────────────────────────────────────────────────────────────────
const { query: dbQuery } = require('../config/db');

router.get('/vehicles', authenticate, async (req, res, next) => {
  try {
    const customerId = req.user.role === 'customer' ? req.user.id : req.query.customer_id;
    const { rows } = await dbQuery(
      `SELECT * FROM vehicles WHERE customer_id = $1 ORDER BY created_at DESC`, [customerId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/vehicles', authenticate, requireRole('customer', 'coordinator', 'admin'), [
  body('model').notEmpty(), body('year').isInt(), body('plate').notEmpty(),
], validate, async (req, res, next) => {
  try {
    const { model, year, plate, color, vin, make = 'Honda' } = req.body;
    const customerId = req.user.role === 'customer' ? req.user.id : req.body.customer_id;
    const { rows } = await dbQuery(
      `INSERT INTO vehicles (customer_id, make, model, year, plate, color, vin)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [customerId, make, model, year, plate, color, vin]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DRIVERS ──────────────────────────────────────────────────────────────────
router.get('/drivers', authenticate, isCoordinator, async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT id, name, phone, email, is_active,
              (SELECT COUNT(*) FROM jobs WHERE driver_id = u.id AND status NOT IN ('delivered')) AS active_jobs
       FROM users u WHERE role = 'driver' ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/drivers/:id/tasks', authenticate, async (req, res, next) => {
  try {
    const driverId = req.user.role === 'driver' ? req.user.id : req.params.id;
    const { rows } = await dbQuery(`
      SELECT dt.*, j.id AS job_id, j.status AS job_status, j.service_type,
             v.model, v.plate, v.color, c.name AS customer_name, c.phone AS customer_phone
      FROM driver_tasks dt
      JOIN jobs j ON j.id = dt.job_id
      JOIN vehicles v ON v.id = j.vehicle_id
      JOIN users c ON c.id = j.customer_id
      WHERE dt.driver_id = $1 AND dt.completed_at IS NULL
      ORDER BY dt.scheduled_at ASC
    `, [driverId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
router.get('/notifications',         authenticate, notiCtrl.listNotifications);
router.patch('/notifications/read',  authenticate, notiCtrl.markAllRead);
router.post('/notifications/broadcast', authenticate, requireRole('admin', 'coordinator'), notiCtrl.broadcast);

// ─── HEALTH ───────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
  status: 'ok', service: 'Honda Door-to-Door API', ts: new Date().toISOString()
}));

// ─── REPORTS ──────────────────────────────────────────────────────────────────
const reportsCtrl = require('../controllers/reportsController');
router.get('/reports/overview',      authenticate, isCoordinator, reportsCtrl.getOverview);
router.get('/reports/monthly',       authenticate, isCoordinator, reportsCtrl.getMonthly);
router.get('/reports/service-types', authenticate, isCoordinator, reportsCtrl.getServiceTypes);
router.get('/quotations/catalog',    authenticate, quotCtrl.getCatalog);

module.exports = router;
