const multer             = require('multer');
const path               = require('path');
const { v4: uuidv4 }     = require('uuid');
const { query, withTransaction } = require('../config/db');
const { getIO }          = require('../socket');
const logger             = require('../config/logger');

// ─── Multer storage (local → swap for S3 in production) ──────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|mp4|mov/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(ext && mime ? null : new Error('Only images and videos allowed'), ext && mime);
  },
}).array('photos', 10);

// ─── POST /inspections (create or update) ────────────────────────────────────
const upsertInspection = async (req, res, next) => {
  try {
    const { job_id, fuel_level, mileage, exterior_note, interior_note,
            tire_condition, windshield_ok, lights_ok, additional_notes } = req.body;

    const { rows: [job] } = await query(
      `SELECT id, driver_id FROM jobs WHERE id = $1`, [job_id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (req.user.role === 'driver' && job.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { rows } = await query(`
      INSERT INTO inspections
        (job_id, driver_id, fuel_level, mileage, exterior_note, interior_note,
         tire_condition, windshield_ok, lights_ok, additional_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (job_id) DO UPDATE SET
        fuel_level = EXCLUDED.fuel_level, mileage = EXCLUDED.mileage,
        exterior_note = EXCLUDED.exterior_note, interior_note = EXCLUDED.interior_note,
        tire_condition = EXCLUDED.tire_condition, windshield_ok = EXCLUDED.windshield_ok,
        lights_ok = EXCLUDED.lights_ok, additional_notes = EXCLUDED.additional_notes,
        updated_at = NOW()
      RETURNING *
    `, [job_id, req.user.id, fuel_level, mileage, exterior_note, interior_note,
        tire_condition, windshield_ok, lights_ok, additional_notes]);

    logger.info('Inspection upserted', { jobId: job_id });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ─── POST /inspections/:jobId/photos ─────────────────────────────────────────
const uploadPhotos = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const { jobId } = req.params;
      const { rows: [insp] } = await query(
        `SELECT id FROM inspections WHERE job_id = $1`, [jobId]
      );
      if (!insp) return res.status(404).json({ error: 'Inspection not found for job' });

      const BASE_URL = `${req.protocol}://${req.get('host')}`;
      const photos   = req.files.map(f => ({
        inspection_id: insp.id,
        url:           `${BASE_URL}/uploads/${f.filename}`,
      }));

      const inserted = await Promise.all(photos.map(p =>
        query(
          `INSERT INTO inspection_photos (inspection_id, url) VALUES ($1,$2) RETURNING *`,
          [p.inspection_id, p.url]
        )
      ));

      res.json({ photos: inserted.map(r => r.rows[0]) });
    } catch (err) { next(err); }
  });
};

// ─── POST /inspections/:jobId/sign ───────────────────────────────────────────
const customerSign = async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const { rows } = await query(`
      UPDATE inspections SET customer_signed = TRUE, customer_signed_at = NOW()
      WHERE job_id = $1 RETURNING *
    `, [jobId]);

    if (!rows.length) return res.status(404).json({ error: 'Inspection not found' });

    // Update job status to inspection_done
    await query(
      `UPDATE jobs SET status = 'inspection_done', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );
    await query(
      `INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,'inspection_done',$2,$3)`,
      [jobId, req.user.id, 'Customer signed inspection report']
    );

    getIO()?.to(`job:${jobId}`).emit('job:status_update', { jobId, status: 'inspection_done' });

    res.json({ signed: true, signedAt: rows[0].customer_signed_at });
  } catch (err) { next(err); }
};

// ─── GET /inspections/:jobId ──────────────────────────────────────────────────
const getInspection = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { rows } = await query(`
      SELECT i.*, array_agg(ip.url ORDER BY ip.uploaded_at) FILTER (WHERE ip.url IS NOT NULL) AS photos
      FROM inspections i LEFT JOIN inspection_photos ip ON ip.inspection_id = i.id
      WHERE i.job_id = $1 GROUP BY i.id
    `, [jobId]);
    if (!rows.length) return res.status(404).json({ error: 'Inspection not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

module.exports = { upsertInspection, uploadPhotos, customerSign, getInspection };
