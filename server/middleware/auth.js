import { createClient } from '@supabase/supabase-js';
import database from '../database/connection.js';
import { logger, getClientIp } from '../utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Lazy client to avoid creating multiple instances
let supabase;
function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      // Defer strictness to requireAuth; attachUser will noop when env is missing
      return null;
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

/**
 * Attaches user information to the request object.
 * Validates JWT token via Supabase and logs authentication events.
 * @param {Request} req - Express request
 * @param {Response} _res - Express response (unused)
 * @param {Function} next - Next middleware
 */
export async function attachUser(req, _res, next) {
  const ip = getClientIp(req) || req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;

    if (!token) {
      req.user = null;
      // Don't log missing token - it's normal for public endpoints
      return next();
    }

    const supa = getClient();
    if (!supa) {
      req.user = null;
      logger.warn('[AUTH] Supabase client not configured - authentication disabled');
      return next();
    }

    const { data, error } = await supa.auth.getUser(token);

    if (error) {
      // Log authentication failure with details for monitoring
      logger.warn('[AUTH] Token validation failed:', {
        ip,
        path: req.path,
        error: error.message,
        userAgent: userAgent.substring(0, 100), // Truncate long user agents
      });
      req.user = null;
      return next();
    }

    if (!data?.user) {
      logger.warn('[AUTH] Token valid but no user data returned:', {
        ip,
        path: req.path,
      });
      req.user = null;
      return next();
    }

    // Successful authentication
    req.user = { id: data.user.id, email: data.user.email };
    logger.debug(`[AUTH] User authenticated: ${data.user.email} from ${ip}`);

    // Best-effort local user cache for admin filtering/stats
    if (data.user.id && data.user.email) {
      try {
        const emailLower = String(data.user.email).toLowerCase();
        await database.run(
          `INSERT INTO app_users (user_id, email, email_lower, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id) DO UPDATE SET
             email = EXCLUDED.email,
             email_lower = EXCLUDED.email_lower,
             last_seen_at = CURRENT_TIMESTAMP,
             first_seen_at = COALESCE(app_users.first_seen_at, EXCLUDED.first_seen_at)`,
          [data.user.id, data.user.email, emailLower]
        );
      } catch (dbErr) {
        logger.warn('[AUTH] Failed to upsert app_users cache:', dbErr.message);
      }
    }
    return next();
  } catch (e) {
    // Log unexpected errors
    logger.error('[AUTH] Unexpected error during authentication:', {
      ip,
      path: req.path,
      error: e.message,
    });
    req.user = null;
    return next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Необходима авторизация' });
  return next();
}

export function requireAuthExcept(publicPaths = []) {
  return function (req, res, next) {
    // Match by path prefix within /api router
    const isPublic = publicPaths.some((p) => req.path === p || req.path.startsWith(p));
    if (isPublic) return next();
    if (!req.user) return res.status(401).json({ error: 'Необходима авторизация' });
    return next();
  };
}
