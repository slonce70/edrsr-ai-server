import dbService from './dbService.js';
import { logger } from '../utils.js';

let cleanupTimer = null;

export function startCacheCleanupService() {
  if (cleanupTimer) return; // already started

  const intervalMs = parseInt(process.env.CACHE_CLEANUP_INTERVAL_MS || String(15 * 60 * 1000), 10); // 15m default
  const maxEntries = parseInt(process.env.CACHE_MAX_PARSED_CASES || '1000', 10);

  const runOnce = async () => {
    try {
      const deleted = await dbService.cleanupOldCacheEntriesOptimized(maxEntries);
      logger.debug(`[MAINTENANCE] Cache cleanup run completed. Deleted: ${deleted}`);
    } catch (e) {
      logger.warn('[MAINTENANCE] Cache cleanup error:', e.message);
    }
  };

  // initial delayed run to avoid hammering on startup
  setTimeout(runOnce, Math.min(intervalMs, 60_000));
  cleanupTimer = setInterval(runOnce, intervalMs);
  logger.info(`🧹 [MAINTENANCE] Cache cleanup service started. interval=${intervalMs}ms, keep=${maxEntries}`);
}

export function stopCacheCleanupService() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}

