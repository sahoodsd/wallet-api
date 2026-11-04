class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (m, details) => new AppError(400, 'VALIDATION_ERROR', m, details);
const unauthorized = (m = 'Invalid or missing token') => new AppError(401, 'UNAUTHORIZED', m);
const notFound = (m) => new AppError(404, 'NOT_FOUND', m);
const conflict = (m) => new AppError(409, 'CONFLICT', m);
const unprocessable = (code, m) => new AppError(422, code, m);

module.exports = { AppError, badRequest, unauthorized, notFound, conflict, unprocessable };
