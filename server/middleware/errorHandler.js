// server/middleware/errorHandler.js

import { logger } from '../utils.js';

/**
 * Determines if the current environment should expose error details.
 * Only development environment shows full error details.
 * Staging and production environments hide error details for security.
 * @returns {boolean} Whether to expose error details
 */
function shouldExposeErrorDetails() {
  const env = process.env.NODE_ENV || 'development';
  // Only expose details in development
  // Staging should be treated like production for security
  return env === 'development';
}

/**
 * Global error handler middleware.
 * Logs errors server-side and returns sanitized error responses to clients.
 * Prevents information leakage in staging/production environments.
 *
 * @param {Error} err - The error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
function errorHandler(err, req, res, next) {
  // Generate a unique error ID for correlation
  const errorId = `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

  // Always log full error details server-side
  logger.error(`[${errorId}] Global error: ${err.message}`, {
    errorId,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    stack: err.stack,
  });

  // If headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  // Determine HTTP status code
  const statusCode = err.statusCode || err.status || 500;

  // Build response payload
  const payload = {
    success: false,
    error: 'Внутренняя ошибка сервера',
    errorId, // Always include errorId for support/debugging
  };

  // Only expose error details in development
  if (shouldExposeErrorDetails()) {
    payload.details = err.message;
    payload.stack = err.stack;
  }

  // For 4xx errors, we can be slightly more specific
  if (statusCode >= 400 && statusCode < 500) {
    payload.error = err.message || 'Ошибка запроса';
  }

  res.status(statusCode).json(payload);
}

export default errorHandler;
