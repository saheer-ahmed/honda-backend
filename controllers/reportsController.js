// controllers/reportsController.js
const { query } = require('../config/db');

// ─── GET /reports/overview ────────────────────────────────────────────────────
const getOverview = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
    const toDate   = to   || new Date().toISOString().slice(0,10);

    const [summary, byStatus, daily, topDrivers, ratings, revenue] = await Promise.all([
      // Summary KPIs
      query(`
        SELECT
          COUNT(*)                                              AS total_jobs,
          COUNT(*) FILTER (WHERE status = 'delivered')         AS completed,
          COUNT(*) FILTER (WHERE status NOT IN ('delivered','booking_confirmed')) AS active,
          COUNT(*) FILTER (WHERE status = 'waiting_approval')  AS pending_approval,
          ROUND(AVG(customer_rating) FILTER (WHERE customer_rating IS NOT NULL), 2) AS avg_rating,
          COUNT(*) FILTER (WHERE customer_rating IS NOT NULL)  AS rated_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))/3600) FILTER (WHERE delivered_at IS NOT NULL), 1) AS avg_turnaround_hours
        FROM jobs
        WHERE DATE(created_at) BETWEEN $1 AND $2
      `, [fromDate, toDate]),

      // Jobs by status
      query(`
        SELECT status, COUNT(*) AS count
        FROM jobs WHERE DATE(created_at) BETWEEN $1 AND $2
        GROUP BY status ORDER BY count DESC
      `, [fromDate, toDate]),

      // Daily job trend
      query(`
        SELECT
          DATE(created_at) AS date,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'delivered') AS completed
        FROM jobs
        WHERE DATE(created_at) BETWEEN $1 AND $2
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `, [fromDate, toDate]),

      // Top drivers
      query(`
        SELECT u.name AS driver_name, u.id AS driver_id,
               COUNT(j.id) AS total_jobs,
               COUNT(j.id) FILTER (WHERE j.status = 'delivered') AS completed,
               ROUND(AVG(j.customer_rating) FILTER (WHERE j.customer_rating IS NOT NULL), 1) AS avg_rating
        FROM users u
        LEFT JOIN jobs j ON j.driver_id = u.id AND DATE(j.created_at) BETWEEN $1 AND $2
        WHERE u.role = 'driver' AND u.is_active = TRUE
        GROUP BY u.id, u.name
        ORDER BY total_jobs DESC
        LIMIT 10
      `, [fromDate, toDate]),

      // Rating distribution
      query(`
        SELECT customer_rating AS rating, COUNT(*) AS count
        FROM jobs
        WHERE customer_rating IS NOT NULL AND DATE(created_at) BETWEEN $1 AND $2
        GROUP BY customer_rating ORDER BY customer_rating DESC
      `, [fromDate, toDate]),

      // Revenue
      query(`
        SELECT
          COALESCE(SUM(q.total_amount) FILTER (WHERE q.approval_status = 'approved'), 0) AS approved_revenue,
          COALESCE(SUM(q.total_amount), 0) AS total_quoted,
          COUNT(q.id) FILTER (WHERE q.approval_status = 'approved') AS approved_quotes,
          COUNT(q.id) FILTER (WHERE q.approval_status = 'declined') AS declined_quotes,
          COUNT(q.id) FILTER (WHERE q.approval_status = 'pending')  AS pending_quotes
        FROM quotations q
        JOIN jobs j ON j.id = q.job_id
        WHERE DATE(j.created_at) BETWEEN $1 AND $2
      `, [fromDate, toDate]),
    ]);

    res.json({
      period:     { from: fromDate, to: toDate },
      summary:    summary.rows[0],
      byStatus:   byStatus.rows,
      daily:      daily.rows,
      topDrivers: topDrivers.rows,
      ratings:    ratings.rows,
      revenue:    revenue.rows[0],
    });
  } catch (err) { next(err); }
};

// ─── GET /reports/service-types ───────────────────────────────────────────────
const getServiceTypes = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT service_type, COUNT(*) AS count,
             ROUND(AVG(customer_rating) FILTER (WHERE customer_rating IS NOT NULL), 1) AS avg_rating,
             COALESCE(SUM(q.total_amount) FILTER (WHERE q.approval_status = 'approved'), 0) AS revenue
      FROM jobs j LEFT JOIN quotations q ON q.job_id = j.id
      GROUP BY service_type ORDER BY count DESC LIMIT 10
    `);
    res.json(rows);
  } catch (err) { next(err); }
};

// ─── GET /reports/monthly ─────────────────────────────────────────────────────
const getMonthly = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', j.created_at), 'Mon YYYY') AS month,
        DATE_TRUNC('month', j.created_at) AS month_date,
        COUNT(j.id) AS total_jobs,
        COUNT(j.id) FILTER (WHERE j.status = 'delivered') AS completed,
        COALESCE(SUM(q.total_amount) FILTER (WHERE q.approval_status = 'approved'), 0) AS revenue,
        ROUND(AVG(j.customer_rating) FILTER (WHERE j.customer_rating IS NOT NULL), 1) AS avg_rating
      FROM jobs j LEFT JOIN quotations q ON q.job_id = j.id
      WHERE j.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', j.created_at)
      ORDER BY month_date ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
};

module.exports = { getOverview, getServiceTypes, getMonthly };
