import express from 'express';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  const app = express();
  const server = http.createServer(app);

  // Middleware
  // If behind a reverse proxy (e.g., Nginx/Render/Heroku), trust proxy to get real client IPs
  app.set('trust proxy', true);
  app.use(securityHeaders); // Add security headers first
  app.use(cors());
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
