import rateLimit from 'express-rate-limit';
import { logger, getClientIp } from '../utils.js';

// --- Security Configuration Constants ---

/** Maximum entries in failed attempts map (prevents memory exhaustion) */
const MAX_FAILED_ATTEMPTS_ENTRIES = 10000;

/** Maximum entries in blocked IPs map (prevents memory exhaustion) */
const MAX_BLOCKED_ENTRIES = 5000;

/** Time in ms to keep failed attempt records (1 hour) */
const FAILED_ATTEMPT_TTL_MS = 60 * 60 * 1000;

/** Cleanup interval in ms (1 hour) */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Rate limit window for admin login (15 minutes) */
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Max admin login attempts per window */
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;

/** Rate limit window for admin routes (1 minute) */
const ADMIN_ROUTE_WINDOW_MS = 60 * 1000;

/** Max admin route requests per window */
const ADMIN_ROUTE_MAX_REQUESTS = 100;

/** Max failed login attempts before email block */
const EMAIL_BLOCK_THRESHOLD = 5;

/** Email block duration (30 minutes) */
const EMAIL_BLOCK_DURATION_MS = 30 * 60 * 1000;

/** Max failed login attempts before IP block */
const IP_BLOCK_THRESHOLD = 10;

/** IP block duration (1 hour) */
const IP_BLOCK_DURATION_MS = 60 * 60 * 1000;

// --- Security State Storage ---

/**
 * In-memory storage for failed login attempts.
 * NOTE: For production with multiple servers, use Redis instead.
 * @type {Map<string, {count: number, lastAttempt: number}>}
 */
const failedAttempts = new Map();

/**
 * In-memory storage for blocked IPs/emails.
 * NOTE: For production with multiple servers, use Redis instead.
 * @type {Map<string, {blockedUntil: number, reason: string}>}
 */
const blockedIPs = new Map();

/**
 * Evicts oldest entries if map exceeds max size.
 * Uses simple LRU-like eviction based on lastAttempt time.
 * @param {Map} map - The map to trim
 * @param {number} maxSize - Maximum allowed entries
 * @param {string} timeField - Field name containing timestamp
 */
function trimMapIfNeeded(map, maxSize, timeField = 'lastAttempt') {
  if (map.size <= maxSize) return;

  // Convert to array, sort by timestamp, keep newest entries
  const entries = Array.from(map.entries()).sort((a, b) => {
    const timeA = a[1][timeField] || a[1].blockedUntil || 0;
    const timeB = b[1][timeField] || b[1].blockedUntil || 0;
    return timeA - timeB;
  });

  // Remove oldest entries to get back under limit
  const toRemove = entries.slice(0, map.size - maxSize);
  for (const [key] of toRemove) {
    map.delete(key);
  }

  logger.info(`[SECURITY] Trimmed security map from ${entries.length} to ${map.size} entries`);
}

// Clean up old entries every hour with size limits
setInterval(() => {
  const now = Date.now();

  // Clean expired failed attempts
  for (const [key, value] of failedAttempts.entries()) {
    if (now - value.lastAttempt > FAILED_ATTEMPT_TTL_MS) {
      failedAttempts.delete(key);
    }
  }

  // Clean expired blocks
  for (const [ip, value] of blockedIPs.entries()) {
    if (now > value.blockedUntil) {
      blockedIPs.delete(ip);
    }
  }

  // Enforce size limits
  trimMapIfNeeded(failedAttempts, MAX_FAILED_ATTEMPTS_ENTRIES, 'lastAttempt');
  trimMapIfNeeded(blockedIPs, MAX_BLOCKED_ENTRIES, 'blockedUntil');

  logger.debug(
    `[SECURITY] Cleanup complete: ${failedAttempts.size} failed attempts, ${blockedIPs.size} blocked entries`
  );
}, CLEANUP_INTERVAL_MS);

// Rate limiting for admin login
export const adminLoginRateLimit = rateLimit({
  windowMs: ADMIN_LOGIN_WINDOW_MS,
  limit: ADMIN_LOGIN_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req) || req.ip,
  handler: (req, res) => {
    const ip = getClientIp(req) || req.ip;
    logger.warn(`[SECURITY] Admin login rate limit exceeded from IP: ${ip}`);
    res.status(429).json({
      error: 'Слишком много попыток входа. Попробуйте через 15 минут.',
      retryAfter: ADMIN_LOGIN_WINDOW_MS / 1000,
    });
  },
});

// Rate limiting for all admin routes
export const adminRouteRateLimit = rateLimit({
  windowMs: ADMIN_ROUTE_WINDOW_MS,
  limit: ADMIN_ROUTE_MAX_REQUESTS,
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

        // Block email after threshold failed attempts
        if (emailAttempts.count >= EMAIL_BLOCK_THRESHOLD) {
          const blockedUntil = Date.now() + EMAIL_BLOCK_DURATION_MS;
          blockedIPs.set(emailKey, { blockedUntil, reason: 'email_attempts' });
          trimMapIfNeeded(blockedIPs, MAX_BLOCKED_ENTRIES, 'blockedUntil');
          logger.warn(
            `[SECURITY] Email ${email} blocked for ${EMAIL_BLOCK_DURATION_MS / 60000} minutes after ${emailAttempts.count} failed attempts`
          );
        }
      }

      // Track by IP
      const ipKey = `ip:${ip}`;
      const ipAttempts = failedAttempts.get(ipKey) || { count: 0, lastAttempt: 0 };
      ipAttempts.count++;
      ipAttempts.lastAttempt = Date.now();
      failedAttempts.set(ipKey, ipAttempts);
      trimMapIfNeeded(failedAttempts, MAX_FAILED_ATTEMPTS_ENTRIES, 'lastAttempt');

      // Block IP after threshold failed attempts
      if (ipAttempts.count >= IP_BLOCK_THRESHOLD) {
        const blockedUntil = Date.now() + IP_BLOCK_DURATION_MS;
        blockedIPs.set(ipKey, { blockedUntil, reason: 'ip_attempts' });
        trimMapIfNeeded(blockedIPs, MAX_BLOCKED_ENTRIES, 'blockedUntil');
        logger.warn(
          `[SECURITY] IP ${ip} blocked for ${IP_BLOCK_DURATION_MS / 60000} minutes after ${ipAttempts.count} failed attempts`
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

// --- Suspicious Activity Detection ---

/**
 * Patterns indicating potential attack attempts.
 * Each pattern targets a specific vulnerability class.
 */
const SUSPICIOUS_PATTERNS = [
  // Path traversal attacks
  /\.\.[\\/]/, // Directory traversal
  /%2e%2e/i, // URL-encoded traversal

  // XSS attempts
  /<script/i, // Script tags
  /javascript:/i, // JavaScript protocol
  /on\w+\s*=/i, // Event handlers (onclick=, onerror=, etc.)
  /data:\s*text\/html/i, // Data URLs with HTML

  // SQL injection
  /union\s+(all\s+)?select/i, // UNION SELECT
  /;\s*(drop|delete|truncate|alter)\s/i, // Destructive statements
  /'\s*(or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i, // Tautology attacks
  /\/\*.*\*\//i, // SQL comments

  // Code injection
  /\b(exec|system|eval|passthru|shell_exec)\s*\(/i, // Function calls
  /\$\{.*\}/i, // Template injection
  /`[^`]*`/, // Backtick command execution

  // LDAP injection
  /[()&|!*]/i, // LDAP special characters in odd places

  // XML/XXE attacks
  /<!ENTITY/i, // Entity declarations
  /<!DOCTYPE.*SYSTEM/i, // External DTD
];

/**
 * User agents commonly associated with automated scanning/attacks.
 */
const SUSPICIOUS_USER_AGENTS = [
  /curl/i,
  /wget/i,
  /python-requests/i,
  /go-http-client/i,
  /libwww/i,
  /nikto/i, // Web scanner
  /sqlmap/i, // SQL injection tool
  /nmap/i, // Network scanner
  /masscan/i, // Port scanner
  /dirbuster/i, // Directory brute-forcer
  /gobuster/i, // Directory brute-forcer
  /burpsuite/i, // Security testing proxy
];

/**
 * Logs suspicious activity detected in requests.
 * Checks URL, body, query params, and user agent for attack patterns.
 */
export function logSuspiciousActivity(req, res, next) {
  const suspiciousPatterns = SUSPICIOUS_PATTERNS;

  const userAgent = req.headers['user-agent'] || '';
  const suspicious = suspiciousPatterns.some(
    (pattern) =>
      pattern.test(req.url) ||
      pattern.test(JSON.stringify(req.body || {})) ||
      pattern.test(JSON.stringify(req.query || {}))
  );

  // Check for suspicious/scanner user agents
  const unusualUA = SUSPICIOUS_USER_AGENTS.some((pattern) => pattern.test(userAgent));

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
