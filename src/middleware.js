const { AppError, unauthorized } = require('./errors');

/** Puts the verified user on req.user. The user id only ever comes from the token. */
const requireAuth = (auth) => (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  req.user = auth.verify(token); // throws 401 if invalid; Express passes it to the error handler
  next();
};

const notFoundHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

// Express treats a middleware with 4 parameters as the error handler.
const errorHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body is not valid JSON' } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};

module.exports = { requireAuth, notFoundHandler, errorHandler };
