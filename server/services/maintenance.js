import dbService from './dbService.js';
import { logger } from '../utils.js';

let cleanupTimer = null;
let promptAuditLastRun = 0;

export function startCacheCleanupService() {
  if (cleanupTimer) return; // already started
  if (process.env.ENABLE_CACHE_CLEANUP === 'false') {
    logger.info('[MAINTENANCE] Cache cleanup disabled by config');
    return;
  }

  const intervalMs = parseInt(process.env.CACHE_CLEANUP_INTERVAL_MS || String(15 * 60 * 1000), 10); // 15m default
  const maxEntries = parseInt(process.env.CACHE_MAX_PARSED_CASES || '1000', 10);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    logger.info('[MAINTENANCE] Cache cleanup disabled (interval <= 0)');
    return;
  }

  const runOnce = async () => {
    try {
      const deleted = await dbService.cleanupOldCacheEntriesOptimized(maxEntries);
      logger.debug(`[MAINTENANCE] Cache cleanup run completed. Deleted: ${deleted}`);
    } catch (e) {
      logger.warn('[MAINTENANCE] Cache cleanup error:', e.message);
    }

    try {
      const retentionDays = parseInt(process.env.PROMPT_AUDIT_RETENTION_DAYS || '90', 10);
      const intervalMs = parseInt(
        process.env.PROMPT_AUDIT_CLEANUP_INTERVAL_MS || String(6 * 60 * 60 * 1000),
        10
      );
      const now = Date.now();
      if (intervalMs > 0 && now - promptAuditLastRun >= intervalMs) {
        const removed = await dbService.cleanupPromptAuditLogs(retentionDays);
        promptAuditLastRun = now;
        if (removed > 0) {
          logger.debug(`[MAINTENANCE] Prompt audit cleanup deleted: ${removed}`);
        }
      }
    } catch (e) {
      logger.warn('[MAINTENANCE] Prompt audit cleanup error:', e.message);
    }
  };

  // initial delayed run to avoid hammering on startup
  setTimeout(runOnce, Math.min(intervalMs, 60_000));
  cleanupTimer = setInterval(runOnce, intervalMs);
  logger.info(
    `🧹 [MAINTENANCE] Cache cleanup service started. interval=${intervalMs}ms, keep=${maxEntries}`
  );
}

export function stopCacheCleanupService() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}
