const { Pool } = require('pg');
const logger   = require('../config/logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'honda_service',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max:                20,
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 2000,
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
