const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack:   err.stack,
    url:     req.originalUrl,
    method:  req.method,
    userId:  req.user?.id,
  });

  if (err.code === '23505') {             // Postgres unique violation
    return res.status(409).json({ error: 'Record already exists', detail: err.detail });
  }
  if (err.code === '23503') {             // Postgres foreign key
    return res.status(400).json({ error: 'Referenced record not found' });
  }
  if (err.name === 'ValidationError') {
    return res.status(422).json({ error: err.message });
  }

  const status  = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(status).json({ error: message });
};

const notFound = (req, res) =>
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });

module.exports = { errorHandler, notFound };
