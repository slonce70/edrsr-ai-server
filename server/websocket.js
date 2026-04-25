import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { logger, getClientIp } from './utils.js';
import dbService from './services/dbService.js';
import collaborationService from './services/collaborationService.js';
import jobQueryService from './services/jobQueryService.js';
import { canSubscribeToJob } from './services/wsSubscriptionService.js';
import { createClient } from '@supabase/supabase-js';
import { parseDevAuthToken } from './auth/devAuth.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const IS_PROD_LIKE = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
let supabase;
function getSupabase() {
  if (!supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// --- WebSocket Security Configuration ---

const WS_AUTH_TIMEOUT_MS = Number.parseInt(process.env.WS_AUTH_TIMEOUT_MS || '10000', 10);
const ENABLE_WS_AUTH_TIMEOUT =
  typeof process.env.ENABLE_WS_AUTH_TIMEOUT === 'string'
    ? process.env.ENABLE_WS_AUTH_TIMEOUT === 'true'
    : IS_PROD_LIKE;
const ENABLE_WS_CONN_RATE_LIMIT = process.env.ENABLE_WS_CONN_RATE_LIMIT !== 'false';
const WS_CONN_RATE_WINDOW_MS = Number.parseInt(
  process.env.WS_CONN_RATE_WINDOW_MS || String(60 * 1000),
  10
);
const WS_CONN_RATE_LIMIT = Number.parseInt(process.env.WS_CONN_RATE_LIMIT || '60', 10);

const wsConnAttempts = new Map(); // ip -> { count: number, windowStart: number }

function isLikelyProxyIp(ip) {
  if (!ip) return true;
  if (ip === '::1') return true;
  if (ip.startsWith('127.')) return true;
  return false;
}

function allowWsConnectionByRateLimit(req) {
  if (!ENABLE_WS_CONN_RATE_LIMIT) return true;
  const ip = getClientIp(req);
  if (!ip || isLikelyProxyIp(ip)) return true;

  const now = Date.now();
  const existing = wsConnAttempts.get(ip);
  if (!existing || now - existing.windowStart > WS_CONN_RATE_WINDOW_MS) {
    wsConnAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  existing.count += 1;
  if (existing.count > WS_CONN_RATE_LIMIT) {
    logger.warn(
      `[WS-SECURITY] Rate limit exceeded for IP ${ip}: ${existing.count}/${WS_CONN_RATE_LIMIT} per ${Math.round(WS_CONN_RATE_WINDOW_MS / 1000)}s`
    );
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of wsConnAttempts.entries()) {
    if (now - data.windowStart > WS_CONN_RATE_WINDOW_MS) {
      wsConnAttempts.delete(ip);
    }
  }
}, WS_CONN_RATE_WINDOW_MS).unref?.();

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedChromeExtensionIds() {
  return parseCsvEnv(process.env.CHROME_EXTENSION_IDS || process.env.CHROME_EXTENSION_ID || '');
}

function isAllowedChromeExtensionOrigin(origin) {
  if (typeof origin !== 'string') return false;
  if (!origin.startsWith('chrome-extension://')) return false;

  const allowedIds = getAllowedChromeExtensionIds();
  if (allowedIds.length === 0) return !IS_PROD_LIKE;

  return allowedIds.some((id) => origin === `chrome-extension://${id}`);
}

/**
 * Get allowed WebSocket origins.
 * Configure via WS_ALLOWED_ORIGINS env var (comma-separated list).
 */
const getAllowedWsOrigins = () => {
  const configured = parseCsvEnv(process.env.WS_ALLOWED_ORIGINS);
  if (configured.length > 0) {
    return [...new Set(configured)];
  }

  if (IS_PROD_LIKE) {
    return [];
  }

  return [
    'http://localhost:3000',
    'http://localhost:4000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4000',
  ];
};

function assertWsOriginConfig() {
  if (!IS_PROD_LIKE) return;
  if (getAllowedWsOrigins().length === 0) {
    throw new Error('WS_ALLOWED_ORIGINS must be set in production/staging');
  }
  if (getAllowedChromeExtensionIds().length === 0) {
    throw new Error('CHROME_EXTENSION_IDS must be set in production/staging');
  }
}

/**
 * Verify WebSocket connection origin.
 * Allows chrome-extension:// origins for browser extensions.
 * @param {Object} info - Connection info with origin
 * @returns {boolean} Whether to allow the connection
 */
const verifyClient = (info) => {
  const origin = info.origin || info.req?.headers?.origin;

  // Basic connection rate limiting (best-effort; depends on X-Forwarded-For)
  if (!allowWsConnectionByRateLimit(info.req)) {
    return false;
  }

  if (!origin) {
    return !IS_PROD_LIKE;
  }

  // Allow chrome extensions
  if (isAllowedChromeExtensionOrigin(origin)) {
    return true;
  }

  // Check against allowed origins
  const allowedOrigins = getAllowedWsOrigins();
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Log rejected connections
  logger.warn(`[WS-SECURITY] Rejected WebSocket connection from origin: ${origin}`);
  return false;
};

let clientsInstance;
let wssInstance;

function initWebSocket(server) {
  if (wssInstance) return { wss: wssInstance, clients: clientsInstance };
  assertWsOriginConfig();

  const clients = new Map();
  const wss = new WebSocketServer({
    server,
    verifyClient,
    perMessageDeflate: {
      // Enable compression for large messages
      zlibDeflateOptions: { level: 6 },
      threshold: 1024, // Only compress messages > 1KB
    },
  });

  wss.on('connection', (ws) => {
    const clientId = uuid();
    ws.isAlive = true;

    clients.set(clientId, { ws, jobs: new Set(), userId: null });
    logger.debug(`[WS] Client ${clientId} connected`);
    ws.send(JSON.stringify({ type: 'clientId', payload: clientId }));

    // Close unauthenticated connections quickly to reduce abuse surface
    ws.authTimeout = null;
    if (ENABLE_WS_AUTH_TIMEOUT && WS_AUTH_TIMEOUT_MS > 0) {
      ws.authTimeout = setTimeout(() => {
        const clientData = clients.get(clientId);
        if (clientData && !clientData.userId) {
          logger.warn(
            `[WS-SECURITY] Closing unauthenticated client ${clientId} after ${WS_AUTH_TIMEOUT_MS}ms`
          );
          try {
            ws.close(4001, 'auth_required');
          } catch {
            ws.terminate();
          }
        }
      }, WS_AUTH_TIMEOUT_MS);
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        // Don't process heartbeats further, they are just for keep-alive
        if (data.type === 'heartbeat') {
          // logger.debug(`[WS] Received heartbeat from ${clientId}`);
          return;
        }

        if (data.type === 'auth') {
          const token = data.token;
          if (typeof token !== 'string' || token.length < 10) return;
          const devUser = parseDevAuthToken(token);
          if (devUser) {
            const clientData = clients.get(clientId);
            if (clientData) clientData.userId = devUser.id;
            if (ws.authTimeout) {
              clearTimeout(ws.authTimeout);
              ws.authTimeout = null;
            }
            logger.debug(`[WS] Client ${clientId} authenticated via dev auth as ${devUser.id}`);
            return;
          }
          const s = getSupabase();
          if (!s) return; // If Supabase not configured, skip
          const { data: userData, error } = await s.auth.getUser(token);
          if (!error && userData?.user) {
            const clientData = clients.get(clientId);
            if (clientData) clientData.userId = userData.user.id;
            if (ws.authTimeout) {
              clearTimeout(ws.authTimeout);
              ws.authTimeout = null;
            }
            logger.debug(`[WS] Client ${clientId} authenticated as ${userData.user.id}`);
          }
        } else if (data.type === 'subscribe') {
          const clientData = clients.get(clientId);
          if (!clientData?.userId) return; // require auth for subscriptions
          if (clientData && data.jobId) {
            const workspaceId =
              typeof data.workspaceId === 'string' && data.workspaceId.trim()
                ? data.workspaceId.trim()
                : null;
            try {
              const allowed = await canSubscribeToJob({
                jobId: data.jobId,
                userId: clientData.userId,
                workspaceId,
                deps: {
                  getJob: (jobId, userId) => dbService.getJob(jobId, userId),
                  getWorkspaceRole: (userId, workspaceId) =>
                    collaborationService.getWorkspaceRole(userId, workspaceId),
                  getJobLightForWorkspace: (jobId, workspaceId) =>
                    jobQueryService.getJobLightForWorkspace(jobId, workspaceId),
                },
              });
              if (allowed) {
                clientData.jobs.add(data.jobId);
                logger.debug(`[WS] Client ${clientId} subscribed to job ${data.jobId}`);
              } else {
                logger.warn(
                  `[WS] Client ${clientId} attempted to subscribe to unauthorized job ${data.jobId}`
                );
              }
            } catch (e) {
              logger.warn(`[WS] Error validating subscription for ${data.jobId}: ${e.message}`);
            }
          }
        }
      } catch {
        logger.warn(`[WS] Received non-JSON message from ${clientId}: ${message}`);
      }
    });

    ws.on('close', () => {
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = null;
      }
      clients.delete(clientId);
      logger.debug(`[WS] Client ${clientId} disconnected`);
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        // Find the clientId associated with this ws instance before terminating
        for (const [id, clientData] of clients.entries()) {
          if (clientData.ws === ws) {
            logger.warn(`[WS] Client ${id} timed out. Terminating.`);
            break;
          }
        }
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  clientsInstance = clients;
  wssInstance = wss;

  return { wss, clients };
}

function sendUpdateToJobOwner(jobId, jobData) {
  if (!clientsInstance) return;

  const message = JSON.stringify({ type: 'JOB_UPDATE', payload: jobData });
  clientsInstance.forEach((clientData) => {
    if (clientData.jobs.has(jobId) && clientData.ws.readyState === clientData.ws.OPEN) {
      clientData.ws.send(message);
    }
  });
}

export { initWebSocket, sendUpdateToJobOwner };
