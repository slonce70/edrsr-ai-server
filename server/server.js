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
import { initWebSocket } from './websocket.js';
import errorHandler from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/security.js';
import { logger } from './utils.js';
import { startCacheCleanupService } from './services/maintenance.js';

// --- Security Configuration ---

/**
 * Allowed CORS origins for the API.
 * Configure via CORS_ALLOWED_ORIGINS env var (comma-separated list).
 * Falls back to permissive mode in development only.
 */
const getAllowedOrigins = () => {
  // Check for explicit configuration
  if (process.env.CORS_ALLOWED_ORIGINS) {
    return process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim());
  }

  // Production/staging: require explicit configuration or use restrictive defaults
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    logger.warn(
      '[SECURITY] CORS_ALLOWED_ORIGINS not set in production/staging. Using restrictive defaults.'
    );
    // Return only the expected production domains
    return [
      'https://reyestr.court.gov.ua', // EDRSR website
    ];
  }

  // Development: allow localhost variations
  return [
    'http://localhost:3000',
    'http://localhost:4000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4000',
  ];
};

/**
 * CORS configuration with origin validation.
 * Chrome extensions are handled specially as they don't send standard origins.
 */
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();

    // Allow requests with no origin (e.g., mobile apps, Postman, server-to-server)
    // Chrome extensions also may not send origin headers
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin matches allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow chrome-extension:// origins (browser extensions)
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    // Log rejected origins for debugging
    logger.warn(`[SECURITY] CORS rejected origin: ${origin}`);
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
      version: '2.0.0',
      admin_panel: '/admin',
    });
  });

  // Error Handler
  app.use(errorHandler);

  return server;
}
