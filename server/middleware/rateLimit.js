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
