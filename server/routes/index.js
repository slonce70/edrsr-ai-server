import express from 'express';
import { v4 as uuid } from 'uuid';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

import { createClient } from '@supabase/supabase-js';
import collaborationService from '../services/collaborationService.js';
import jobQueryService from '../services/jobQueryService.js';
import jobWriteService from '../services/jobWriteService.js';
import queueService from '../services/queueService.js';
import { refreshHeuristicTitle } from '../services/jobTitleService.js';
import { createWorkerLifecycleService } from '../services/workerLifecycleService.js';
import { attachUser, requireAuthExcept } from '../middleware/auth.js';
import { adminLoginRateLimit, checkBlocked, trackFailedLogin } from '../middleware/security.js';
import jobQueue from '../queue.js';
import { sendUpdateToJobOwner } from '../websocket.js';
import { logger } from '../utils.js';
import createChatRouter from './chat.js';
import createJobCollectionRouter from './job-collection.js';
import createJobMutationsRouter from './job-mutations.js';
import createJobQueriesRouter from './job-queries.js';
import createOperationsRouter from './operations.js';
import createPromptsRouter from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const WORKER_ID = process.env.WORKER_ID || uuid();
const SERVER_STARTED_AT = new Date().toISOString();

// Supabase client for auth
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
let supabase;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function mapAuthErrorCode(error) {
  const message = String(error?.message || '').toLowerCase();
  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid email or password')
  )
    return 'invalid_credentials';
  if (message.includes('email not confirmed')) return 'email_not_confirmed';
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    error?.status === 429
  )
    return 'rate_limited';
  return 'auth_failed';
}

// Auth endpoints (public)
router.post(
  '/auth/signin',
  // Add security middleware
  adminLoginRateLimit,
  checkBlocked,
  trackFailedLogin,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: 'Email and password are required', error_code: 'missing_credentials' });
      }

      if (!supabase) {
        return res
          .status(500)
          .json({ error: 'Supabase not configured', error_code: 'supabase_not_configured' });
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return res.status(401).json({ error: error.message, error_code: mapAuthErrorCode(error) });
      }

      res.json({
        access_token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      });
    } catch (error) {
      logger.error('Sign in error:', error);
      res.status(500).json({ error: 'Authentication failed', error_code: 'auth_failed' });
    }
  }
);

// Attach user (if any) and require auth for all routes except auth and health endpoints
router.use(attachUser);
// Убираем /health/full из публичных маршрутов, оставляем только /health/light и /auth/signin
// Также пропускаем /share, чтобы публічні шари з portalRoutes не блокувались тут.
router.use(requireAuthExcept(['/health/light', '/auth/signin', '/share', '/prompts/definitions']));

// Lightweight session/user info for web portal
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Необходима авторизация' });
  return res.json({ success: true, user: { id: req.user.id, email: req.user.email } });
});
// Чат‑сессии и их метаданные (LRU + TTL)
const chatSessions = new Map(); // jobId -> ChatSession
const chatMeta = new Map(); // jobId -> { createdAt: number, lastUsed: number }

// Настройки лимитов/TTL для чат‑сессий
const CHAT_MAX_SESSIONS = Number.parseInt(process.env.CHAT_MAX_SESSIONS || '5', 10);
const CHAT_TTL_MS = Number.parseInt(process.env.CHAT_TTL_MS || String(15 * 60 * 1000), 10); // по умолчанию 15 минут
const CHAT_CLEANUP_INTERVAL_MS = Number.parseInt(
  process.env.CHAT_CLEANUP_INTERVAL_MS || String(5 * 60 * 1000),
  10
); // каждые 5 минут
const ENABLE_WORKER_CLEANUP = process.env.ENABLE_WORKER_CLEANUP !== 'false';
const ENABLE_PERIODIC_RECOVERY = process.env.ENABLE_PERIODIC_RECOVERY !== 'false';
const ENABLE_CHAT_CLEANUP = process.env.ENABLE_CHAT_CLEANUP !== 'false';
const ENABLE_WORKER_AUTO_TERMINATE = process.env.ENABLE_WORKER_AUTO_TERMINATE !== 'false';
const activeWorkers = new Map(); // Для отслеживания активных воркеров: jobId -> worker
const workerLifecycle = createWorkerLifecycleService({
  activeWorkers,
  processQueue,
});
const { forceTerminateWorker, getActiveWorkersInfo } = workerLifecycle;

async function resolveWorkspaceFromQuery(req, res) {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
  if (!workspaceId) return null;
  const role = await collaborationService.getWorkspaceRole(req.user?.id, workspaceId);
  if (!role) {
    res.status(403).json({ error: 'Недостаточно прав доступа' });
    return null;
  }
  return { id: workspaceId, role };
}

function startWorker({ jobId, links, cookie, prompt, claimed = false }) {
  // If the job wasn't claimed via DB, attempt to lock it now (best-effort)
  if (!claimed) {
    queueService
      .lockJob(jobId, WORKER_ID)
      .then((locked) => {
        if (!locked) logger.warn(`[${jobId}] Could not acquire DB lock before start`);
      })
      .catch((e) => logger.warn(`[${jobId}] Lock attempt failed: ${e.message}`));
  }
  const worker = new Worker(path.resolve(__dirname, '../worker.js'), {
    workerData: { jobId, links, cookie, prompt },
  });

  // Отслеживаем активный воркер с дополнительной информацией
  activeWorkers.set(jobId, {
    worker,
    startTime: Date.now(),
    jobId,
    status: 'running',
  });

  const updateStatus = async (status, progress, message, extra = {}) => {
    const jobDataToUpdate = { progress, ...extra };
    if ((status === 'completed' || status === 'error') && !('end_time' in jobDataToUpdate)) {
      jobDataToUpdate.end_time = new Date().toISOString();
    }
    let updatedJob = null;
    try {
      updatedJob = await jobWriteService.updateJobStatus(jobId, status, jobDataToUpdate);
    } catch (e) {
      logger.warn(`[${jobId}] updateStatus DB error: ${e.message}`);
    }
    // Heartbeat to extend lease while processing
    queueService.heartbeatJob(jobId, WORKER_ID).catch(() => {});

    if (updatedJob) {
      // Send light updates during progress to reduce payload; full data only on completion
      const wsData = {
        id: updatedJob.id,
        title: updatedJob.title,
        status,
        progress,
        message,
        processed_links: updatedJob.processed_links,
        total_links: updatedJob.total_links,
        created_at: updatedJob.created_at,
        updated_at: updatedJob.updated_at,
        prompt: updatedJob.prompt,
        duration: updatedJob.duration,
      };

      sendUpdateToJobOwner(jobId, wsData);
    } else {
      // Job might have been deleted mid-process; avoid throwing and keep worker flowing
      logger.warn(
        `[${jobId}] updateStatus: job not found (probably deleted). Skipping WS update for status '${status}'.`
      );
    }

    logger.info(`[${jobId}] Status: ${status}, Progress: ${progress}%, Message: ${message}`);
  };

  worker.on('message', async (msg) => {
    if (msg.type === 'statusUpdate') {
      const { status, progress, message, extra } = msg.payload;
      await updateStatus(status, progress, message, extra);
      // Do NOT update title mid-process to avoid confusing partial counters.
      // Title will be refined only after completion (see jobSuccess handler).
      // Acknowledge the update so the worker can proceed
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.worker.postMessage({ type: 'statusUpdateAck', requestId: msg.requestId });
      }
    } else if (msg.type === 'healthCheckResponse') {
      // Обрабатываем ответ на health check
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.lastHealthCheck = Date.now();
        workerInfo.memoryUsedMB = msg.memoryUsedMB;
        workerInfo.isHighMemory = msg.isHighMemory;
        workerInfo.isCriticalMemory = msg.isCriticalMemory;

        logger.debug(
          `[HEALTH_CHECK] Воркер ${jobId}: ${msg.memoryUsedMB}MB${msg.isHighMemory ? ' (HIGH)' : ''}${msg.isCriticalMemory ? ' (CRITICAL)' : ''}`
        );

        // Если память критически высокая, предупреждаем и готовимся к принудительному завершению
        if (msg.isCriticalMemory) {
          logger.warn(
            `[HEALTH_CHECK] Критическое потребление памяти воркером ${jobId}: ${msg.memoryUsedMB}MB`
          );
          // Жестко завершаем только если разрешено конфигом (Render‑ограничение)
          if (ENABLE_WORKER_AUTO_TERMINATE) {
            forceTerminateWorker(jobId, 'Critical memory reported by worker');
          } else {
            logger.info(`[HEALTH_CHECK] Auto‑terminate disabled, worker ${jobId} left running`);
          }
        }
      }
    } else if (msg.type === 'jobSuccess') {
      await updateStatus('analyzing', 95, 'Контроль качества...');
      await updateStatus('completed', 100, 'Анализ успешно завершён!', msg.payload);
      await queueService.clearJobLock(jobId);
      // Удаляем воркер из отслеживания
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.status = 'completed';
        activeWorkers.delete(jobId);
      }
      // Final title refinement
      refreshHeuristicTitle(jobId);
      // Освобождаем обработчик и запускаем следующую задачу
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Задание завершено успешно. Проверяю очередь...`);

      processQueue();
    } else if (msg.type === 'jobError') {
      const { errorMessage, duration } = msg.payload;
      await updateStatus('error', 0, `Критическая ошибка: ${errorMessage}`, {
        error_message: errorMessage,
        duration,
      });
      await queueService.clearJobLock(jobId);
      // Удаляем воркер из отслеживания
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.status = 'error';
        activeWorkers.delete(jobId);
      }
      // Освобождаем обработчик и запускаем следующую задачу
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Задание завершено с ошибкой. Проверяю очередь...`);

      processQueue();
    } else if (msg.type === 'jobCancelled') {
      const { message } = msg.payload;
      await updateStatus('error', 0, `Задача отменена: ${message}`, {
        error_message: message,
      });
      await queueService.clearJobLock(jobId);
      // Удаляем воркер из отслеживания
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.status = 'cancelled';
        activeWorkers.delete(jobId);
      }
      // Освобождаем обработчик и запускаем следующую задачу
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Задача отменена. Проверяю очередь...`);

      processQueue();
    }
  });

  worker.on('error', async (error) => {
    logger.error(`❌ Критическая ошибка воркера для задания ${jobId}:`, error.message);
    await updateStatus('error', 0, `Критическая ошибка: ${error.message}`, {
      error_message: error.message,
    });
    await queueService.clearJobLock(jobId);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      logger.error(`Воркер для задания ${jobId} завершился с кодом ${code}`);
      // Если воркер упал некорректно, нужно освободить очередь
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Воркер завершился аварийно. Проверяю очередь...`);

      queueService.clearJobLock(jobId).catch(() => {});
      processQueue();
    } else {
      logger.info(`[${jobId}] Воркер завершил работу корректно.`);
    }
  });
}

async function processQueue() {
  // Reserve processing slot immediately to prevent race across concurrent triggers
  if (!jobQueue.tryReserve()) {
    logger.debug('[QUEUE] Обробник зайнятий.');
    return;
  }

  // Черга тепер повністю в БД - завжди беремо через claimNextJob()
  try {
    const claimed = await queueService.claimNextJob(WORKER_ID);
    if (claimed && claimed.id) {
      const links = await jobQueryService.getJobLinks(claimed.id, claimed.user_id || null);
      // Спробувати отримати cookie з кешу (якщо job був щойно створений)
      const cachedCookie = jobQueue.getCachedCookie(claimed.id);
      const cookie = cachedCookie || '';

      logger.info(
        `[QUEUE] Запускаю job ${claimed.id} з БД (cookie: ${cachedCookie ? 'з кешу' : 'немає'})`
      );

      // Очистити cookie з кешу після використання
      if (cachedCookie) {
        jobQueue.clearCachedCookie(claimed.id);
      }

      startWorker({ jobId: claimed.id, links, cookie, prompt: claimed.prompt, claimed: true });
    } else {
      logger.debug('[QUEUE] Черга порожня.');
      // release reservation since nothing to do
      jobQueue.endProcessing();
    }
  } catch (e) {
    logger.error('[QUEUE] Помилка обробки черги:', e.message);
    jobQueue.endProcessing();
  }
}

// In‑process fallback trigger: allow other modules to request a queue pump
try {
  process.on('edrsr:queue:pump', () => {
    try {
      logger.info('[INTERNAL] Queue pump requested via process event');
      processQueue();
    } catch (e) {
      logger.error('[INTERNAL] Queue pump failed:', e.message);
    }
  });
} catch {
  // noop
}

// Автоматическая очистка зависших воркеров
function startWorkerCleanupService() {
  if (!ENABLE_WORKER_CLEANUP) {
    logger.info('[CLEANUP] Worker cleanup disabled by config');
    return;
  }

  const CLEANUP_INTERVAL = parseInt(process.env.WORKER_CLEANUP_INTERVAL_MS || '30000', 10); // 30s default
  const MAX_WORKER_LIFETIME = parseInt(process.env.WORKER_MAX_LIFETIME_MS || '1500000', 10); // 25m default
  const HEALTH_CHECK_INTERVAL = parseInt(
    process.env.WORKER_HEALTHCHECK_INTERVAL_MS || '120000',
    10
  ); // 2m default
  const MEMORY_CHECK_THRESHOLD = parseInt(process.env.WORKER_HEALTHCHECK_AFTER_MS || '300000', 10); // 5m default
  let lastHealthCheck = Date.now();

  if (!Number.isFinite(CLEANUP_INTERVAL) || CLEANUP_INTERVAL <= 0) {
    logger.info('[CLEANUP] Worker cleanup interval disabled (<= 0)');
    return;
  }

  setInterval(() => {
    const now = Date.now();
    const workersToTerminate = [];
    const workersToHealthCheck = [];

    for (const [jobId, workerInfo] of activeWorkers.entries()) {
      const runningTime = now - workerInfo.startTime;

      // Если воркер работает дольше максимального времени
      if (MAX_WORKER_LIFETIME > 0 && runningTime > MAX_WORKER_LIFETIME) {
        workersToTerminate.push({
          jobId,
          runningTime,
          reason: `Превышено максимальное время работы (${Math.round(runningTime / 1000 / 60)} минут)`,
        });
      }
      // Если воркер работает долго, но еще не превысил лимит - проверим его здоровье
      else if (MEMORY_CHECK_THRESHOLD > 0 && runningTime > MEMORY_CHECK_THRESHOLD) {
        // Больше 5 минут - проверяем здоровье и память
        workersToHealthCheck.push({ jobId, workerInfo, runningTime });
      }
    }

    // Завершаем зависшие воркеры
    if (workersToTerminate.length > 0) {
      logger.warn(`[CLEANUP] Найдено ${workersToTerminate.length} зависших воркеров, завершаю...`);

      if (ENABLE_WORKER_AUTO_TERMINATE) {
        for (const { jobId, runningTime, reason } of workersToTerminate) {
          logger.warn(
            `[CLEANUP] Завершаю зависший воркер ${jobId} (работал ${Math.round(runningTime / 1000 / 60)} минут)`
          );
          forceTerminateWorker(jobId, reason);
        }
      } else {
        logger.info('[CLEANUP] Auto‑terminate disabled, skip worker termination');
      }
    }

    // Проверяем здоровье долго работающих воркеров
    if (
      workersToHealthCheck.length > 0 &&
      HEALTH_CHECK_INTERVAL > 0 &&
      now - lastHealthCheck > HEALTH_CHECK_INTERVAL
    ) {
      logger.info(
        `[CLEANUP] Проверяю здоровье ${workersToHealthCheck.length} долго работающих воркеров...`
      );

      for (const { jobId, workerInfo, runningTime } of workersToHealthCheck) {
        try {
          // Отправляем ping воркеру
          workerInfo.worker.postMessage({
            type: 'healthCheck',
            timestamp: now,
          });

          logger.debug(
            `[CLEANUP] Отправлен health check воркеру ${jobId} (работает ${Math.round(runningTime / 1000 / 60)} минут)`
          );
        } catch (error) {
          logger.error(`[CLEANUP] Ошибка health check для воркера ${jobId}:`, error.message);
          // Если не можем отправить сообщение, воркер вероятно мертв
          if (ENABLE_WORKER_AUTO_TERMINATE) {
            forceTerminateWorker(jobId, 'Воркер не отвечает на health check');
          } else {
            logger.info(
              `[CLEANUP] Auto‑terminate disabled, worker ${jobId} left running after failed health check`
            );
          }
        }
      }

      lastHealthCheck = now;
    }

    const activeCount = activeWorkers.size;
    if (activeCount > 0) {
      logger.debug(`[CLEANUP] Проверка завершена. Активных воркеров: ${activeCount}`);
    }
  }, CLEANUP_INTERVAL);

  logger.info('[CLEANUP] Служба автоматической очистки зависших воркеров запущена');
}

// Функция восстановления зависших заданий в БД
async function recoverStuckJobs() {
  try {
    const [stuckCount, failedCount] = await Promise.all([
      queueService.recoverStuckJobs(),
      queueService.retryFailedJobs(),
    ]);

    const totalRecovered = stuckCount + failedCount;

    if (stuckCount > 0) {
      logger.info(`🔄 [RECOVERY] Восстановлено ${stuckCount} зависших заданий в БД`);
    }

    if (failedCount > 0) {
      logger.info(`🔄 [RETRY] Повторяется ${failedCount} заданий с временными ошибками`);
    }

    if (totalRecovered > 0) {
      // После восстановления пытаемся запустить обработку очереди
      setTimeout(() => processQueue(), 1000);
    }

    return totalRecovered;
  } catch (error) {
    logger.error('[RECOVERY] Ошибка восстановления заданий:', error.message);
    return 0;
  }
}

// Периодическое восстановление зависших заданий
function startPeriodicRecovery() {
  // Запускаем восстановление каждые 5 минут
  const RECOVERY_INTERVAL = parseInt(process.env.RECOVERY_INTERVAL_MS || '300000', 10);
  if (!Number.isFinite(RECOVERY_INTERVAL) || RECOVERY_INTERVAL <= 0) {
    logger.info('[RECOVERY] Periodic recovery disabled (interval <= 0)');
    return;
  }

  setInterval(() => {
    recoverStuckJobs();
  }, RECOVERY_INTERVAL);

  const mins = Math.round(RECOVERY_INTERVAL / 60000);
  logger.info(
    `[RECOVERY] Периодическое восстановление зависших заданий запущено (каждые ${mins} минут)`
  );
}

// Инициализация всех служб мониторинга
function initializeMonitoringServices() {
  // Первоначальное восстановление при старте
  // 1) Вернуть в очередь задания, "зависшие" до рестарта (сервер упал/перезапущен)
  queueService
    .recoverJobsAfterServerRestart(SERVER_STARTED_AT)
    .then((recovered) => {
      if (recovered > 0) setTimeout(() => processQueue(), 500);
    })
    .catch((e) => logger.warn('[RECOVERY] Pre-restart recovery failed:', e.message));

  // 2) Обычная проверка истекших лиз (на случай долгого простоя)
  recoverStuckJobs();

  // Запуск служб
  startWorkerCleanupService();
  if (ENABLE_PERIODIC_RECOVERY) {
    startPeriodicRecovery();
  } else {
    logger.info('[RECOVERY] Periodic recovery disabled by config');
  }

  logger.info('🔧 [MONITORING] Все службы мониторинга и восстановления запущены');
}

// Очистка чат‑сессий по TTL и LRU‑лимиту
function evictExpiredChatSessions(reason = 'scheduled') {
  const now = Date.now();
  let removed = 0;

  // 1) TTL‑очистка
  for (const [jobId, meta] of chatMeta.entries()) {
    if (now - (meta?.lastUsed || meta?.createdAt || 0) > CHAT_TTL_MS) {
      chatMeta.delete(jobId);
      chatSessions.delete(jobId);
      removed++;
    }
  }

  // 2) LRU‑сужение при превышении лимита
  if (chatSessions.size > CHAT_MAX_SESSIONS) {
    // Собираем список сессий с последним использованием
    const items = Array.from(chatMeta.entries()).map(([jobId, meta]) => ({
      jobId,
      lastUsed: meta?.lastUsed ?? meta?.createdAt ?? 0,
    }));
    // Сортируем по lastUsed возрастанию (наименее использованные в начале)
    items.sort((a, b) => a.lastUsed - b.lastUsed);

    const toRemove = chatSessions.size - CHAT_MAX_SESSIONS;
    for (let i = 0; i < toRemove; i++) {
      const victim = items[i];
      if (victim) {
        chatMeta.delete(victim.jobId);
        chatSessions.delete(victim.jobId);
        removed++;
      }
    }
  }

  if (removed > 0) {
    logger.info(
      `[CHAT_CLEANUP] Removed ${removed} sessions (reason=${reason}). Active=${chatSessions.size}`
    );
  }
}

export default function (clients) {
  // Запускаем все службы мониторинга при инициализации
  initializeMonitoringServices();
  // Запускаем периодическую очистку чат‑сессий
  try {
    if (!ENABLE_CHAT_CLEANUP) {
      logger.info('[CHAT_CLEANUP] Disabled by config');
    } else if (!Number.isFinite(CHAT_CLEANUP_INTERVAL_MS) || CHAT_CLEANUP_INTERVAL_MS <= 0) {
      logger.info('[CHAT_CLEANUP] Disabled (interval <= 0)');
    } else {
      setInterval(() => evictExpiredChatSessions('interval'), CHAT_CLEANUP_INTERVAL_MS);
      // Стартовая разовая очистка (на случай рестарта)
      evictExpiredChatSessions('startup');
      logger.info(
        `[CHAT_CLEANUP] Service started. TTL=${CHAT_TTL_MS}ms, MAX=${CHAT_MAX_SESSIONS}, INTERVAL=${CHAT_CLEANUP_INTERVAL_MS}ms`
      );
    }
  } catch (e) {
    logger.error('[CHAT_CLEANUP] Failed to start cleanup interval', e);
  }

  // Queue recovery on startup + periodic pump (throttled, quiet)
  queueService.recoverStuckJobs().catch((e) => {
    logger.warn('[QUEUE] Initial recovery failed:', e.message);
  });
  const PUMP_INTERVAL = parseInt(process.env.QUEUE_PUMP_INTERVAL_MS || '60000', 10);
  setInterval(async () => {
    try {
      const recovered = await queueService.recoverStuckJobs();
      if (recovered > 0) {
        processQueue();
      }
    } catch {
      // noop
    }
  }, PUMP_INTERVAL);
  // Kick the queue once on startup (handles already queued jobs)
  setTimeout(() => processQueue(), 2000);

  router.use(createJobCollectionRouter({ clients, processQueue }));
  router.use(createPromptsRouter());

  router.use(
    createJobMutationsRouter({
      chatMeta,
      chatSessions,
      clients,
      hasActiveWorker: (jobId) => activeWorkers.has(jobId),
      processQueue,
      resolveWorkspaceFromQuery,
      terminateWorker: forceTerminateWorker,
    })
  );
  router.use(createJobQueriesRouter({ resolveWorkspaceFromQuery }));

  router.use(createChatRouter({ chatMeta, chatSessions, resolveWorkspaceFromQuery }));

  router.use(
    createOperationsRouter({
      chatMeta,
      chatSessions,
      chatSettings: {
        CHAT_MAX_SESSIONS,
        CHAT_TTL_MS,
        CHAT_CLEANUP_INTERVAL_MS,
      },
      forceTerminateWorker,
      getActiveWorkersInfo,
      processQueue,
    })
  );

  return router;
}
