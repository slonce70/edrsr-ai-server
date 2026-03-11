import database from '../database/connection.js';
import { logger } from '../utils.js';

class CacheService {
  async getCachedCaseByUrl(url, userId = null) {
    const sql = userId
      ? `SELECT case_data, updated_at FROM parsed_cases WHERE url = $1 AND user_id = $2`
      : `SELECT case_data, updated_at FROM parsed_cases WHERE url = $1`;
    try {
      const row = await database.get(sql, userId ? [url, userId] : [url]);
      if (row) {
        const cached = row.case_data;
        const isTemporary = cached?.isTemporary === true;
        if (isTemporary) {
          const ttlMs = parseInt(
            process.env.TEMP_CACHE_TTL_MS || process.env.CACHE_TEMP_ERROR_TTL_MS || '3600000',
            10
          );
          const updatedAtMs = row.updated_at
            ? typeof row.updated_at === 'string'
              ? Date.parse(row.updated_at)
              : row.updated_at.getTime()
            : cached?.cachedAt || null;
          if (
            Number.isFinite(ttlMs) &&
            ttlMs > 0 &&
            Number.isFinite(updatedAtMs) &&
            Date.now() - updatedAtMs > ttlMs
          ) {
            logger.info(`[CACHE] TEMP EXPIRED for URL: ${url}`);
            try {
              const deleteSql = userId
                ? 'DELETE FROM parsed_cases WHERE url = $1 AND user_id = $2'
                : 'DELETE FROM parsed_cases WHERE url = $1';
              await database.run(deleteSql, userId ? [url, userId] : [url]);
            } catch (deleteError) {
              logger.warn(`[CACHE] Failed to purge expired temp cache for ${url}:`, deleteError);
            }
            return null;
          }
        }

        logger.info(`[CACHE] HIT for URL: ${url}`);
        return cached;
      }
      logger.info(`[CACHE] MISS for URL: ${url}`);
      return null;
    } catch (error) {
      logger.error(`[CACHE] Error getting cached case for URL ${url}:`, error);
      return null;
    }
  }

  async saveCaseToCache(caseData, userId = null) {
    const sql = `
      INSERT INTO parsed_cases (url, case_data, created_at, updated_at, user_id)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)
      ON CONFLICT(url)
      DO UPDATE SET
        case_data = EXCLUDED.case_data,
        updated_at = CURRENT_TIMESTAMP;
    `;
    const timeoutMs = parseInt(process.env.CACHE_STATEMENT_TIMEOUT_MS || '5000', 10);
    const tStart = Date.now();
    const spans = {};

    const tStringifyStart = Date.now();
    const caseDataJson = JSON.stringify(caseData);
    spans.stringifyMs = Date.now() - tStringifyStart;

    let client;
    try {
      const tAcquireStart = Date.now();
      client = await database.pool.connect();
      spans.acquireMs = Date.now() - tAcquireStart;

      await client.query('BEGIN');
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      }

      const tExecStart = Date.now();
      await client.query(sql, [caseData.url, caseDataJson, userId]);
      spans.execMs = Date.now() - tExecStart;

      await client.query('COMMIT');
      spans.totalMs = Date.now() - tStart;
      logger.info(`[CACHE] SAVED case for URL: ${caseData.url} timings=${JSON.stringify(spans)}`);
    } catch (error) {
      try {
        if (client) await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.warn('[CACHE] ROLLBACK failed during saveCaseToCache:', rollbackErr);
      }
      logger.error(
        `[CACHE] Error saving case to cache for URL ${caseData.url}: ${error.message || error}`,
        { code: error.code, spans }
      );
    } finally {
      if (client) client.release();
    }
  }

  async cleanupOldCacheEntriesOptimized(maxEntries = null) {
    try {
      const limit = parseInt(maxEntries || process.env.CACHE_MAX_PARSED_CASES || '1000', 10);
      if (!Number.isFinite(limit) || limit <= 0) return 0;

      const sql = `
        WITH cutoff AS (
          SELECT updated_at
          FROM parsed_cases
          ORDER BY updated_at DESC
          OFFSET $1 LIMIT 1
        )
        DELETE FROM parsed_cases
        WHERE (SELECT updated_at FROM cutoff) IS NOT NULL
          AND updated_at < (SELECT updated_at FROM cutoff)
      `;
      const res = await database.run(sql, [limit - 1]);
      const deleted = res.changes || 0;
      if (deleted > 0) {
        logger.info(`[CACHE] Cleaned up ${deleted} old cache entries (kept latest ${limit})`);
      }
      return deleted;
    } catch (error) {
      logger.error(`[CACHE] Error cleaning up old cache entries (optimized):`, error);
      return 0;
    }
  }
}

export default new CacheService();
