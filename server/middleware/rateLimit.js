import rateLimit from 'express-rate-limit';

export const limitCollect = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Занадто багато запитів. Повторіть спробу пізніше.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

export const limitRetry = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Занадто багато запитів. Повторіть спробу пізніше.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Public endpoint limiter (prompt definitions are public and cached, but still worth protecting)
export const limitPromptDefinitions = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60, // per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Занадто багато запитів. Повторіть спробу пізніше.' },
  keyGenerator: (req) => req.ip,
});

// Lightweight limiter for public health check
export const limitHealthLight = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30, // per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Занадто багато перевірок здоров’я. Спробуйте пізніше.' },
  keyGenerator: (req) => req.ip,
});
