import express from 'express';
import compression from 'compression';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import initRoutes from './routes/index.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import portalRoutes from './routes/portal.js';
import { initWebSocket } from './websocket.js';
import errorHandler from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/security.js';
import { logger } from './utils.js';
import { startCacheCleanupService } from './services/maintenance.js';
import { APP_VERSION } from './version.js';

// --- Security Configuration ---
const IS_PROD_LIKE = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

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
 * Allowed CORS origins for the API.
 * Configure via CORS_ALLOWED_ORIGINS env var (comma-separated list).
 * Falls back to permissive mode in development only.
 */
const getAllowedOrigins = () => {
  const configuredOrigins = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS);
  if (configuredOrigins.length > 0) {
    return [...new Set(configuredOrigins)];
  }

  if (!IS_PROD_LIKE) {
    return [
      'http://localhost:3000',
      'http://localhost:4000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:4000',
    ];
  }

  return [];
};

function assertOriginConfig() {
  if (!IS_PROD_LIKE) return;
  if (getAllowedOrigins().length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must be set in production/staging');
  }
  if (getAllowedChromeExtensionIds().length === 0) {
    throw new Error('CHROME_EXTENSION_IDS must be set in production/staging');
  }
}

/**
 * CORS configuration with origin validation.
 * Chrome extensions are handled specially as they don't send standard origins.
 */
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();

    if (!origin) {
      if (!IS_PROD_LIKE) {
        return callback(null, true);
      }
      return callback(new Error('Origin required'));
    }

    // Allow configured chrome-extension:// origins (browser extensions)
    if (isAllowedChromeExtensionOrigin(origin)) {
      return callback(null, true);
    }

    // Check if origin matches allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400, // 24 hours - cache preflight requests
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  assertOriginConfig();
  const app = express();
  const server = http.createServer(app);

  // Middleware
  // If behind a reverse proxy (e.g., Nginx/Render/Heroku), trust proxy to get real client IPs
  app.set('trust proxy', true);
  // Hide Express signature
  app.disable('x-powered-by');
  app.use(securityHeaders); // Add security headers first
  app.use(
    compression({
      threshold: 1024, // compress payloads >1KB
    })
  );
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use((req, res, next) => {
    logger.debug(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Static files for admin panel
  app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

  // WebSocket
  const { clients } = initWebSocket(server);

  // Routes
  app.use('/auth', authRoutes);
  app.use('/api', initRoutes(clients));
  app.use('/api', portalRoutes);
  app.use('/api/admin', adminRoutes);

  // Start background maintenance services (e.g., cache cleanup)
  try {
    startCacheCleanupService();
  } catch (e) {
    logger.warn('[MAINTENANCE] Failed to start cache cleanup service:', e.message);
  }

  // Admin panel route
  app.get('/admin*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/index.html'));
  });

  // Default route
  app.get('/', (req, res) => {
    res.json({
      message: 'EDRSR-AI Server is running',
      version: APP_VERSION,
      admin_panel: '/admin',
    });
  });

  // Error Handler
  app.use(errorHandler);

  return server;
}
