import dotenv from 'dotenv';
import { createServer } from './server.js';
import database from './database/connection.js';
import promptService from './services/promptService.js';
import { logger } from './utils.js';
import got from 'got';
import { APP_VERSION } from './version.js';

// Respect runtime overrides from systemd/GitHub Actions and only backfill missing values from .env.
dotenv.config();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

async function start() {
  try {
    await database.initializeTables();
    logger.log('🗄️ База даних успішно ініціалізована.');
    await promptService.ensurePromptDefinitionsSeeded();

    const server = createServer();

    server.listen(PORT, HOST, () => {
      logger.log(`🚀 ЄДРСР AI Backend Server v${APP_VERSION}`);
      logger.log(`📡 HTTP та WebSocket сервер запущено на ${HOST}:${PORT}`);

      // Keep-alive mechanism for free Render tier
      const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
      if (RENDER_URL) {
        setInterval(
          () => {
            logger.debug('PINGING self to prevent sleep...');
            got(`${RENDER_URL}/api/health/light`).catch((err) => {
              logger.error('Ping failed:', err.message);
            });
          },
          14 * 60 * 1000
        ); // every 14 minutes
      }

      // Keep-alive for CLIProxyAPI (prevents spin-down on free tier)
      const CLI_PROXY_URL = process.env.CLI_PROXY_URL;
      if (CLI_PROXY_URL) {
        setInterval(
          () => {
            logger.debug('PINGING CLIProxyAPI to prevent sleep...');
            got(`${CLI_PROXY_URL}/`).catch((err) => {
              logger.warn('CLIProxy ping failed:', err.message);
            });
          },
          14 * 60 * 1000
        ); // every 14 minutes
        logger.log(`🔗 CLIProxyAPI keep-alive enabled: ${CLI_PROXY_URL}`);
      }
    });
  } catch (error) {
    logger.error('❌ Критична помилка ініціалізації:', error.message);
    process.exit(1);
  }
}

start();
