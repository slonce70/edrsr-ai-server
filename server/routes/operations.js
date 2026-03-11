import express from 'express';

import dbService from '../services/dbService.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { limitHealthLight } from '../middleware/rateLimit.js';
import { testGeminiConnection } from '../gemini.js';
import jobQueue from '../queue.js';
import { logger } from '../utils.js';
import { APP_VERSION } from '../version.js';

export default function createOperationsRouter({
  chatMeta,
  chatSessions,
  chatSettings,
  forceTerminateWorker,
  getActiveWorkersInfo,
  processQueue,
}) {
  const router = express.Router();
  const HEALTH_TTL = parseInt(process.env.HEALTH_FULL_TTL_MS || '60000', 10);
  let healthCache = { data: null, ts: 0 };

  router.get('/workers/active', requireAdmin, (req, res) => {
    try {
      const workersInfo = getActiveWorkersInfo();
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        ...workersInfo,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Ошибка получения информации о воркерах',
        message: error.message,
      });
    }
  });

  router.post('/workers/:jobId/terminate', requireAdmin, (req, res) => {
    try {
      const { jobId } = req.params;
      const { reason } = req.body;

      const success = forceTerminateWorker(jobId, reason || 'Принудительное завершение через API');

      if (success) {
        return res.json({
          success: true,
          message: `Воркер для задачи ${jobId} завершается...`,
          jobId,
        });
      }

      return res.status(404).json({
        success: false,
        error: `Активный воркер для задачи ${jobId} не найден`,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Ошибка завершения воркера',
        message: error.message,
      });
    }
  });

  router.post('/workers/terminate-all', requireAdmin, (req, res) => {
    try {
      const { reason } = req.body;
      const workersInfo = getActiveWorkersInfo();

      if (workersInfo.count === 0) {
        return res.json({
          success: true,
          message: 'Нет активных воркеров для завершения',
          terminated: 0,
        });
      }

      let terminatedCount = 0;
      const terminationReason = reason || 'Массовое завершение через API';

      for (const worker of workersInfo.workers) {
        if (forceTerminateWorker(worker.jobId, terminationReason)) {
          terminatedCount++;
        }
      }

      return res.json({
        success: true,
        message: `Завершается ${terminatedCount} из ${workersInfo.count} воркеров`,
        terminated: terminatedCount,
        total: workersInfo.count,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Ошибка массового завершения воркеров',
        message: error.message,
      });
    }
  });

  router.get('/system/stats', requireAdmin, async (req, res) => {
    try {
      const workersInfo = getActiveWorkersInfo();
      const memoryUsage = process.memoryUsage();

      let queuedJobsCount = 0;
      try {
        const result = await dbService.pool.query(
          `SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'retrying')`
        );
        queuedJobsCount = parseInt(result.rows[0]?.count || 0, 10);
      } catch (dbErr) {
        logger.warn('[STATS] Не вдалося отримати кількість jobs з БД:', dbErr.message);
      }

      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        workers: {
          active: workersInfo.count,
          details: workersInfo.workers,
        },
        queue: {
          length: queuedJobsCount,
          isProcessing: !jobQueue.isIdle(),
          cachedCookies: jobQueue.getCachedJobsCount(),
        },
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
        },
        uptime: process.uptime(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Помилка отримання статистики системи',
        message: error.message,
      });
    }
  });

  router.get('/system/chat-sessions', requireAdmin, (req, res) => {
    try {
      const now = Date.now();
      const items = Array.from(chatMeta.entries()).map(([jobId, meta]) => ({
        jobId,
        createdAt: meta?.createdAt || 0,
        lastUsed: meta?.lastUsed || 0,
        ageMs: meta?.lastUsed ? now - meta.lastUsed : now - (meta?.createdAt || 0),
      }));
      items.sort((a, b) => a.lastUsed - b.lastUsed);

      const oldest = items[0] || null;
      const newest = items[items.length - 1] || null;

      return res.json({
        success: true,
        config: chatSettings,
        counts: {
          sessions: chatSessions.size,
          metas: chatMeta.size,
        },
        oldest,
        newest,
        sample: items.slice(0, 10),
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/queue/clear', requireAdmin, async (req, res) => {
    try {
      const cachedCount = jobQueue.getCachedJobsCount();
      jobQueue.clearAllCookies();

      let cancelledCount = 0;
      try {
        const result = await dbService.pool.query(
          `UPDATE jobs SET status = 'error', error_message = 'Скасовано адміністратором'
           WHERE status IN ('queued', 'retrying')
           RETURNING id`
        );
        cancelledCount = result.rowCount || 0;
      } catch (dbErr) {
        logger.warn('[QUEUE/CLEAR] Не вдалося скасувати jobs в БД:', dbErr.message);
      }

      return res.json({
        success: true,
        message: `Чергу очищено. Скасовано ${cancelledCount} завдань, очищено ${cachedCount} cookies`,
        cancelledJobs: cancelledCount,
        clearedCookies: cachedCount,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Помилка очищення черги',
        message: error.message,
      });
    }
  });

  router.get('/health/light', limitHealthLight, (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/health/full', requireAdmin, async (req, res, next) => {
    try {
      const now = Date.now();
      if (healthCache.data && now - healthCache.ts < HEALTH_TTL) {
        return res.json(healthCache.data);
      }

      const [geminiStatus, activeJobs] = await Promise.all([
        testGeminiConnection(),
        dbService.getActiveJobsCount(),
      ]);
      const payload = {
        status: 'healthy',
        services: { gemini: geminiStatus ? 'online' : 'offline' },
        activeJobs,
        version: APP_VERSION,
        cachedAt: new Date().toISOString(),
        ttlMs: HEALTH_TTL,
      };
      healthCache = { data: payload, ts: now };
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/internal/process-queue', requireAdmin, async (req, res) => {
    try {
      logger.info('[INTERNAL] Запуск обработки очереди по внутреннему запросу');
      processQueue();
      return res.json({ success: true, message: 'Queue processing triggered' });
    } catch (error) {
      logger.error('[INTERNAL] Ошибка запуска очереди:', error.message);
      return res.status(500).json({ error: 'Failed to process queue' });
    }
  });

  return router;
}
