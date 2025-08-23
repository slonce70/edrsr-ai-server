import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { logger } from './utils.js';
import dbService from './services/dbService.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
let supabase;
function getSupabase() {
  if (!supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

let clientsInstance;
let wssInstance;

function initWebSocket(server) {
  if (wssInstance) return { wss: wssInstance, clients: clientsInstance };

  const clients = new Map();
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const clientId = uuid();
    ws.isAlive = true;

    clients.set(clientId, { ws, jobs: new Set(), userId: null });
    logger.debug(`[WS] Client ${clientId} connected`);
    ws.send(JSON.stringify({ type: 'clientId', payload: clientId }));

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
          const s = getSupabase();
          if (!s) return; // If Supabase not configured, skip
          const token = data.token;
          if (typeof token !== 'string' || token.length < 10) return;
          const { data: userData, error } = await s.auth.getUser(token);
          if (!error && userData?.user) {
            const clientData = clients.get(clientId);
            if (clientData) clientData.userId = userData.user.id;
            logger.debug(`[WS] Client ${clientId} authenticated as ${userData.user.id}`);
          }
        } else if (data.type === 'subscribe') {
          const clientData = clients.get(clientId);
          if (!clientData?.userId) return; // require auth for subscriptions
          if (clientData && data.jobId) {
            // Verify this job belongs to the authenticated user before subscribing
            try {
              const job = await dbService.getJob(data.jobId, clientData.userId);
              if (job) {
                clientData.jobs.add(data.jobId);
                logger.debug(`[WS] Client ${clientId} subscribed to job ${data.jobId}`);
              } else {
                logger.warn(
                  `[WS] Client ${clientId} attempted to subscribe to foreign job ${data.jobId}`
                );
              }
            } catch (e) {
              logger.warn(`[WS] Error validating subscription for ${data.jobId}: ${e.message}`);
            }
          }
        }
      } catch (e) {
        logger.warn(`[WS] Received non-JSON message from ${clientId}: ${message}`);
      }
    });

    ws.on('close', () => {
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
