import rateLimit from 'express-rate-limit';
import { logger, getClientIp } from '../utils.js';

// Store failed login attempts in memory (for production use Redis/database)
const failedAttempts = new Map();
const blockedIPs = new Map();

// Clean up old entries every hour
setInterval(
  () => {
    const now = Date.now();
    const CLEANUP_TIME = 60 * 60 * 1000; // 1 hour

    for (const [key, value] of failedAttempts.entries()) {
      if (now - value.lastAttempt > CLEANUP_TIME) {
        failedAttempts.delete(key);
      }
    }

    for (const [ip, value] of blockedIPs.entries()) {
      if (now > value.blockedUntil) {
        blockedIPs.delete(ip);
      }
    }
  },
  60 * 60 * 1000
);

// Rate limiting for admin login
export const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req) || req.ip,
  handler: (req, res) => {
    const ip = getClientIp(req) || req.ip;
    logger.warn(`[SECURITY] Admin login rate limit exceeded from IP: ${ip}`);
    res.status(429).json({
      error: 'Слишком много попыток входа. Попробуйте через 15 минут.',
      retryAfter: 15 * 60,
    });
  },
});

// Rate limiting for all admin routes
export const adminRouteRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req) || req.ip,
  handler: (req, res) => {
    const ip = getClientIp(req) || req.ip;
    logger.warn(`[SECURITY] Admin route rate limit exceeded from IP: ${ip}, Path: ${req.path}`);
    res.status(429).json({
      error: 'Слишком много запросов к админке. Попробуйте позже.',
      retryAfter: 60,
    });
  },
});

// Account lockout after failed attempts
export function trackFailedLogin(req, res, next) {
  const originalSend = res.send;

  res.send = function (data) {
    // Only track if this is an authentication failure
    if (res.statusCode === 401) {
      const ip = getClientIp(req) || req.ip;
      const email = req.body?.email;

      if (email) {
        // Track by email
        const emailKey = `email:${email}`;
        const emailAttempts = failedAttempts.get(emailKey) || { count: 0, lastAttempt: 0 };
        emailAttempts.count++;
        emailAttempts.lastAttempt = Date.now();
        failedAttempts.set(emailKey, emailAttempts);

        // Block email after 5 failed attempts for 30 minutes
        if (emailAttempts.count >= 5) {
          const blockedUntil = Date.now() + 30 * 60 * 1000; // 30 minutes
          blockedIPs.set(emailKey, { blockedUntil, reason: 'email_attempts' });
          logger.warn(
            `[SECURITY] Email ${email} blocked for 30 minutes after ${emailAttempts.count} failed attempts`
          );
        }
      }

      // Track by IP
      const ipKey = `ip:${ip}`;
      const ipAttempts = failedAttempts.get(ipKey) || { count: 0, lastAttempt: 0 };
      ipAttempts.count++;
      ipAttempts.lastAttempt = Date.now();
      failedAttempts.set(ipKey, ipAttempts);

      // Block IP after 10 failed attempts for 1 hour
      if (ipAttempts.count >= 10) {
        const blockedUntil = Date.now() + 60 * 60 * 1000; // 1 hour
        blockedIPs.set(ipKey, { blockedUntil, reason: 'ip_attempts' });
        logger.warn(
          `[SECURITY] IP ${ip} blocked for 1 hour after ${ipAttempts.count} failed attempts`
        );
      }

      logger.warn(
        `[SECURITY] Failed admin login attempt from IP: ${ip}, Email: ${email || 'unknown'}`
      );
    } else if (res.statusCode === 200 && req.body?.email) {
      // Clear failed attempts on successful login
      const email = req.body.email;
      const ip = getClientIp(req) || req.ip;
      failedAttempts.delete(`email:${email}`);
      failedAttempts.delete(`ip:${ip}`);
      logger.info(`[SECURITY] Successful admin login for ${email} from ${ip}`);
    }

    return originalSend.call(this, data);
  };

  next();
}

// Check if IP or email is blocked
export function checkBlocked(req, res, next) {
  const ip = getClientIp(req) || req.ip;
  const email = req.body?.email;

  // Check IP block
  const ipBlock = blockedIPs.get(`ip:${ip}`);
  if (ipBlock && Date.now() < ipBlock.blockedUntil) {
    const remainingTime = Math.ceil((ipBlock.blockedUntil - Date.now()) / 60000);
    logger.warn(`[SECURITY] Blocked IP ${ip} attempted access`);
    return res.status(429).json({
      error: `IP заблокирован за подозрительную активность. Попробуйте через ${remainingTime} минут.`,
      retryAfter: remainingTime * 60,
    });
  }

  // Check email block
  if (email) {
    const emailBlock = blockedIPs.get(`email:${email}`);
    if (emailBlock && Date.now() < emailBlock.blockedUntil) {
      const remainingTime = Math.ceil((emailBlock.blockedUntil - Date.now()) / 60000);
      logger.warn(`[SECURITY] Blocked email ${email} attempted access from ${ip}`);
      return res.status(429).json({
        error: `Аккаунт временно заблокирован за множественные неудачные попытки входа. Попробуйте через ${remainingTime} минут.`,
        retryAfter: remainingTime * 60,
      });
    }
  }

  next();
}

// Security headers middleware
export function securityHeaders(req, res, next) {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Only set HSTS in production with HTTPS
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // CSP for admin pages
  if (req.path.startsWith('/admin')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
        "font-src 'self' https://cdnjs.cloudflare.com; " +
        "img-src 'self' data:; " +
        "connect-src 'self';"
    );
  }

  next();
}

// Log suspicious activity
export function logSuspiciousActivity(req, res, next) {
  const suspiciousPatterns = [
    /\.\./, // Path traversal
    /script/i, // XSS attempts
    /union.*select/i, // SQL injection
    /exec|system|eval/i, // Code injection
    /<.*>/, // HTML injection
  ];

  const userAgent = req.headers['user-agent'] || '';
  const suspicious = suspiciousPatterns.some(
    (pattern) =>
      pattern.test(req.url) ||
      pattern.test(JSON.stringify(req.body || {})) ||
      pattern.test(JSON.stringify(req.query || {}))
  );

  // Log unusual user agents
  const unusualUserAgents = [/curl/i, /wget/i, /python/i, /go-http/i, /libwww/i];

  const unusualUA = unusualUserAgents.some((pattern) => pattern.test(userAgent));

  if (suspicious || unusualUA) {
    logger.warn(`[SECURITY] Suspicious activity detected:`, {
      ip: getClientIp(req) || req.ip,
      method: req.method,
      url: req.url,
      userAgent,
      body: suspicious ? 'REDACTED' : undefined,
      reason: suspicious ? 'suspicious_pattern' : 'unusual_user_agent',
    });
  }

  next();
}

// Get security statistics
export function getSecurityStats() {
  const now = Date.now();

  return {
    blockedIPs: Array.from(blockedIPs.entries()).map(([key, value]) => ({
      target: key,
      reason: value.reason,
      remainingTime: Math.max(0, Math.ceil((value.blockedUntil - now) / 60000)),
    })),
    failedAttempts: Array.from(failedAttempts.entries()).map(([key, value]) => ({
      target: key,
      count: value.count,
      lastAttempt: new Date(value.lastAttempt).toISOString(),
    })),
  };
}
