import { createClient } from '@supabase/supabase-js';

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

export async function attachUser(req, _res, next) {
  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;

    if (!token) {
      req.user = null;
      return next();
    }

    const supa = getClient();
    if (!supa) {
      req.user = null;
      return next();
    }
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) {
      req.user = null;
      return next();
    }
    req.user = { id: data.user.id, email: data.user.email };
    return next();
  } catch (e) {
    // Fail closed only if explicitly required later
    req.user = null;
    return next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

export function requireAuthExcept(publicPaths = []) {
  return function (req, res, next) {
    // Match by path prefix within /api router
    const isPublic = publicPaths.some((p) => req.path === p || req.path.startsWith(p));
    if (isPublic) return next();
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  };
}
