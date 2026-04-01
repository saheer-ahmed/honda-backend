const { Pool } = require('pg');
const logger   = require('../config/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => logger.debug('PostgreSQL: new client connected'));
pool.on('error',   (err) => logger.error('PostgreSQL pool error', { err: err.message }));

// Helper: run query with auto-release
const query = (text, params) => pool.query(text, params);

// Helper: transaction wrapper
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, withTransaction };
