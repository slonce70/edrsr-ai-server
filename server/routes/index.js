import express from 'express';
import { v4 as uuid } from 'uuid';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

import { createClient } from '@supabase/supabase-js';
import dbService from '../services/dbService.js';
import { attachUser, requireAuthExcept } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import {
  limitCollect,
  limitRetry,
  limitHealthLight,
  limitPromptDefinitions,
} from '../middleware/rateLimit.js';
import {
  validateCollectRequest,
  validateChatMessage,
  validatePromptCreate,
  validatePromptUpdate,
  validatePromptImport,
} from '../middleware/validators.js';
import { adminLoginRateLimit, checkBlocked, trackFailedLogin } from '../middleware/security.js';
import { answerChatQuestion, testGeminiConnection } from '../gemini.js';
import jobQueue from '../queue.js';
import { sendUpdateToJobOwner } from '../websocket.js';
import { logger, isValidEDRSRUrl } from '../utils.js';
import { orderPromptDefinitions } from '../prompt-definitions.js';
import { APP_VERSION } from '../version.js';

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

// Автоочищення зависших воркерів кожні 5 хвилин (TTL 30 хвилин)
const MAX_WORKER_AGE_MS = 30 * 60 * 1000; // 30 хв
setInterval(
  () => {
    const now = Date.now();
    for (const [jobId, data] of activeWorkers.entries()) {
      if (now - data.startTime > MAX_WORKER_AGE_MS) {
        logger.warn(
          `[CLEANUP] Видаляю завислий воркер ${jobId} (вік: ${Math.round((now - data.startTime) / 60000)} хв)`
        );
        activeWorkers.delete(jobId);
      }
    }
  },
  5 * 60 * 1000
);

function truncate(str, max = 70) {
  if (!str) return '';
  const s = String(str).trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function generateInitialTitle({ linksCount = 0, prompt = null, promptLabel = null }) {
  const n = linksCount || 0;
  const suffix = n > 0 ? ` — ${n} дел` : '';
  if (promptLabel && promptLabel.trim()) return `Анализ: «${truncate(promptLabel, 40)}»${suffix}`;
  if (prompt && typeof prompt === 'string' && prompt.trim()) {
    const words = prompt
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(' ');
    if (words) return `Запрос: ${truncate(words, 40)}${suffix}`;
  }
  const today = new Date().toLocaleDateString('ru-RU');
  return `Анализ от ${today}${suffix}`;
}

function formatPromptsMeta(meta) {
  const count = Number.isFinite(meta?.count) ? meta.count : 0;
  const lastUpdated = meta?.lastUpdated ? new Date(meta.lastUpdated).toISOString() : null;
  const etag = `W/"${count}:${lastUpdated || '0'}"`;
  return { count, lastUpdated, etag };
}

function formatPromptDefinitionsMeta(meta) {
  const version = Number.isFinite(meta?.version) ? meta.version : 1;
  const lastUpdated = meta?.lastUpdated ? new Date(meta.lastUpdated).toISOString() : null;
  const etag = `W/"v${version}:${lastUpdated || '0'}"`;
  return { version, lastUpdated, etag };
}

async function resolveWorkspaceFromQuery(req, res) {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
  if (!workspaceId) return null;
  const role = await dbService.getWorkspaceRole(req.user?.id, workspaceId);
  if (!role) {
    res.status(403).json({ error: 'Недостаточно прав доступа' });
    return null;
  }
  return { id: workspaceId, role };
}

async function refreshHeuristicTitle(jobId) {
  try {
    const userId = await dbService.getJobOwnerId(jobId);
    const summary = await dbService.summarizeJobForTitle(jobId, userId || null);
    const { processed, total, topArticle, topCaseType } = summary;
    const status = await dbService.getJobStatus(jobId);
    if (!total || total < 1) return false;
    let base = '';
    if (topArticle) base = `Ст. ${topArticle}`;
    else if (topCaseType) base = `${topCaseType}`;
    else base = 'Анализ';
    // During processing, avoid confusing partial counters in the title.
    // Show counts only after completion; otherwise show stable total count.
    const suffix =
      status === 'completed' ? (processed ? ` — ${processed} из ${total}` : '') : ` — ${total}`;
    const title = truncate(`${base}${suffix}`, 70);
    const ok = await dbService.updateAutoTitleIfAllowed(jobId, title, 'heuristic');
    if (ok) {
      const updatedJob = await dbService.getJob(jobId, userId || null);
      // Send light update to clients if job still exists
      if (updatedJob) {
        sendUpdateToJobOwner(jobId, {
          id: updatedJob.id,
          title: updatedJob.title,
          status: updatedJob.status,
          progress: updatedJob.progress,
          processed_links: updatedJob.processed_links,
          total_links: updatedJob.total_links,
          updated_at: updatedJob.updated_at,
        });
      } else {
        logger.debug(`[TITLE] Job ${jobId} disappeared before title update broadcast`);
      }
    }
    return ok;
  } catch (e) {
    logger.debug(`[TITLE] refreshHeuristicTitle error for ${jobId}: ${e.message}`);
    return false;
  }
}

function startWorker({ jobId, links, cookie, prompt, claimed = false }) {
  // If the job wasn't claimed via DB, attempt to lock it now (best-effort)
  if (!claimed) {
    dbService
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
      updatedJob = await dbService.updateJobStatus(jobId, status, jobDataToUpdate);
    } catch (e) {
      logger.warn(`[${jobId}] updateStatus DB error: ${e.message}`);
    }
    // Heartbeat to extend lease while processing
    dbService.heartbeatJob(jobId, WORKER_ID).catch(() => {});

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
      await dbService.clearJobLock(jobId);
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
      await dbService.clearJobLock(jobId);
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
      await dbService.clearJobLock(jobId);
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
    await dbService.clearJobLock(jobId);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      logger.error(`Воркер для задания ${jobId} завершился с кодом ${code}`);
      // Если воркер упал некорректно, нужно освободить очередь
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Воркер завершился аварийно. Проверяю очередь...`);

      dbService.clearJobLock(jobId).catch(() => {});
      processQueue();
    } else {
      logger.info(`[${jobId}] Воркер завершил работу корректно.`);
    }
  });
}

// Функция для получения информации об активных воркерах
function getActiveWorkersInfo() {
  const workers = [];
  const now = Date.now();

  for (const [jobId, workerInfo] of activeWorkers.entries()) {
    const runningTime = now - workerInfo.startTime;
    workers.push({
      jobId,
      status: workerInfo.status,
      startTime: workerInfo.startTime,
      runningTimeMs: runningTime,
      runningTimeFormatted: formatDuration(runningTime),
    });
  }

  return {
    count: workers.length,
    workers: workers.sort((a, b) => b.runningTimeMs - a.runningTimeMs), // Сортируем по времени работы
  };
}

// Вспомогательная функция для форматирования времени
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}ч ${minutes % 60}м ${seconds % 60}с`;
  } else if (minutes > 0) {
    return `${minutes}м ${seconds % 60}с`;
  } else {
    return `${seconds}с`;
  }
}

// Функция для принудительного завершения воркера
function forceTerminateWorker(jobId, reason = 'Принудительное завершение') {
  const workerInfo = activeWorkers.get(jobId);
  if (!workerInfo) {
    logger.warn(`[FORCE_TERMINATE] Воркер для задачи ${jobId} не найден`);
    return false;
  }

  logger.warn(`[FORCE_TERMINATE] Принудительно завершаю воркер для задачи ${jobId}: ${reason}`);

  try {
    // Сначала пытаемся отправить сигнал отмены
    workerInfo.worker.postMessage({
      type: 'cancelJob',
      jobId: jobId,
      reason: reason,
    });

    // Даем воркеру 3 секунды на корректное завершение (сокращено с 5)
    setTimeout(() => {
      const stillActive = activeWorkers.get(jobId);
      if (stillActive) {
        logger.error(
          `[FORCE_TERMINATE] Воркер ${jobId} не отвечает на сигнал отмены, принудительно завершаю`
        );

        // Принудительно завершаем воркер
        try {
          stillActive.worker.terminate();
        } catch (termError) {
          logger.error(
            `[FORCE_TERMINATE] Ошибка при завершении воркера ${jobId}:`,
            termError.message
          );
        }

        stillActive.status = 'force_terminated';
        activeWorkers.delete(jobId);

        // Освобождаем блокировку в БД
        dbService.clearJobLock(jobId).catch((err) => {
          logger.error(
            `[FORCE_TERMINATE] Ошибка очистки блокировки в БД для ${jobId}:`,
            err.message
          );
        });

        // Освобождаем очередь если этот воркер блокировал её
        if (!jobQueue.isIdle()) {
          jobQueue.endProcessing();
          processQueue();
        }
      }
    }, 3000);

    return true;
  } catch (error) {
    logger.error(`[FORCE_TERMINATE] Ошибка при завершении воркера ${jobId}:`, error.message);

    // В случае ошибки все равно удаляем из отслеживания
    activeWorkers.delete(jobId);
    return false;
  }
}

async function processQueue() {
  // Reserve processing slot immediately to prevent race across concurrent triggers
  if (!jobQueue.tryReserve()) {
    logger.debug('[QUEUE] Обробник зайнятий.');
    return;
  }

  // Черга тепер повністю в БД - завжди беремо через claimNextJob()
  try {
    const claimed = await dbService.claimNextJob(WORKER_ID);
    if (claimed && claimed.id) {
      const links = await dbService.getJobLinks(claimed.id, claimed.user_id || null);
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
          forceTerminateWorker(jobId, 'Воркер не отвечает на health check');
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
      dbService.recoverStuckJobs(),
      dbService.retryFailedJobs(),
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
  dbService
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
  dbService.recoverStuckJobs().catch((e) => {
    logger.warn('[QUEUE] Initial recovery failed:', e.message);
  });
  const PUMP_INTERVAL = parseInt(process.env.QUEUE_PUMP_INTERVAL_MS || '60000', 10);
  setInterval(async () => {
    try {
      const recovered = await dbService.recoverStuckJobs();
      if (recovered > 0) {
        processQueue();
      }
    } catch {
      // noop
    }
  }, PUMP_INTERVAL);
  // Kick the queue once on startup (handles already queued jobs)
  setTimeout(() => processQueue(), 2000);

  router.post('/collect', limitCollect, validateCollectRequest, async (req, res, next) => {
    try {
      const { links, cookie = '', prompt = null, clientId } = req.body;
      const autoTitleEnabled =
        typeof req.body.auto_title_enabled === 'boolean' ? req.body.auto_title_enabled : true;
      const promptLabel = req.body.prompt_label || null;
      if (!links || !Array.isArray(links) || links.length === 0) {
        return res.status(400).json({ error: 'Массив ссылок "links" не может быть пустым' });
      }
      // Лимит на количество ссылок в одном запросе (конфигурируемый)
      const MAX_LINKS = parseInt(process.env.MAX_LINKS_PER_REQUEST || '300', 10);
      if (links.length > MAX_LINKS) {
        return res.status(422).json({ error: `Слишком много ссылок: максимум ${MAX_LINKS}` });
      }
      let clientData = null;
      if (clientId) {
        if (!clients.has(clientId)) {
          logger.warn(`[SEC] Unknown clientId provided for collect: ${clientId}`);
        } else {
          clientData = clients.get(clientId);
        }
      }

      // Валидация, чтобы предотвратить падение сервера
      const validLinks = links.filter((link) => link && typeof link === 'object' && link.url);
      if (validLinks.length < links.length) {
        logger.warn(
          `[VALIDATION] Получен некорректный массив ссылок. Отфильтровано ${links.length - validLinks.length} невалидных элементов.`
        );
      }
      // Строгая проверка домена/пути (только EDRSR /Review/<id>)
      const strictlyValid = validLinks.filter(
        (l) => typeof l.url === 'string' && isValidEDRSRUrl(l.url)
      );
      // Ограничение длины URL и полей
      const MAX_URL_LEN = parseInt(process.env.MAX_URL_LENGTH || '2048', 10);
      const MAX_PROMPT_LEN = parseInt(process.env.MAX_PROMPT_LENGTH || '4000', 10);
      if (prompt && typeof prompt === 'string' && prompt.length > MAX_PROMPT_LEN) {
        return res.status(422).json({ error: `Слишком длинный prompt (> ${MAX_PROMPT_LEN})` });
      }
      const tooLongUrls = strictlyValid.filter((l) => l.url.length > MAX_URL_LEN).length;
      if (tooLongUrls > 0) {
        logger.warn(
          `[VALIDATION] Отфильтровано ${tooLongUrls} слишком длинных URL (> ${MAX_URL_LEN})`
        );
      }
      const safeLinks = strictlyValid.filter((l) => l.url.length <= MAX_URL_LEN);

      if (safeLinks.length === 0) {
        return res
          .status(400)
          .json({ error: 'Не найдено ни одной валидной ссылки для обработки.' });
      }

      const jobId = uuid();
      const defaultTitle = generateInitialTitle({
        linksCount: safeLinks.length,
        prompt,
        promptLabel,
      });

      const jobData = {
        id: jobId,
        title: defaultTitle,
        status: 'queued',
        totalLinks: safeLinks.length,
        links: safeLinks,
        prompt,
        titleSource: 'heuristic',
        autoTitleEnabled,
      };

      // Привязываем job к WebSocket только если он принадлежит тому же пользователю
      if (clientData && clientData.userId && req.user?.id && clientData.userId === req.user.id) {
        clientData.jobs.add(jobId);
      } else if (clientId) {
        logger.warn(`[SEC] ClientId ${clientId} does not match req.user for job ${jobId}`);
      }

      let workspace = null;
      const requestedWorkspaceId =
        typeof req.body.workspaceId === 'string' ? req.body.workspaceId : null;
      if (req.user?.id) {
        if (requestedWorkspaceId) {
          const role = await dbService.getWorkspaceRole(req.user.id, requestedWorkspaceId);
          if (!role) return res.status(403).json({ error: 'Недостаточно прав доступа' });
          workspace = { id: requestedWorkspaceId, role };
        } else {
          workspace = await dbService.ensureWorkspaceForUser(req.user.id, req.user.email);
        }
      }
      const matterId = typeof req.body.matterId === 'string' ? req.body.matterId : null;
      if (matterId && workspace) {
        const matter = await dbService.getMatter(matterId, workspace.id);
        if (!matter) return res.status(404).json({ error: 'Matter not found' });
      }

      await dbService.createJob(jobData, req.user?.id || null, workspace?.id || null, matterId);
      const initialJobState = await dbService.getJob(jobId, req.user?.id || null);

      await dbService.updateJobStatus(jobId, 'queued', { progress: 0 });
      sendUpdateToJobOwner(jobId, {
        ...initialJobState,
        status: 'queued',
        progress: 0,
        message: 'Задание в очереди',
      });

      res.json({ success: true, jobId, ...initialJobState });

      // Queue только очищенные ссылки, чтобы не перегружать воркерлер лишними проверками
      jobQueue.enqueue({ jobId, links: safeLinks, cookie, prompt });
      processQueue();
    } catch (error) {
      next(error);
    }
  });

  // --- Prompt Definitions (public) ---
  router.get('/prompts/definitions', limitPromptDefinitions, async (req, res, next) => {
    try {
      const meta = await dbService.getPromptDefinitionsMeta();
      const { etag, lastUpdated, version } = formatPromptDefinitionsMeta(meta);
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === etag) {
        res.set('ETag', etag);
        return res.status(304).end();
      }

      const defs = await dbService.getPromptDefinitions();
      res.set('ETag', etag);
      return res.json({
        success: true,
        definitions: orderPromptDefinitions(defs?.payload || null),
        version: defs?.version ?? version,
        lastUpdated: defs?.updatedAt || lastUpdated,
      });
    } catch (error) {
      return next(error);
    }
  });

  // --- User Prompts ---
  router.get('/prompts', async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const meta = await dbService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === etag) {
        res.set('ETag', etag);
        return res.status(304).end();
      }

      const prompts = await dbService.listPrompts(userId);
      res.set('ETag', etag);
      return res.json({ success: true, prompts, lastUpdated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/prompts', validatePromptCreate, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { name, content } = req.body || {};
      const result = await dbService.createPrompt(userId, name, content);
      const meta = await dbService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({
        success: true,
        prompt: result.prompt,
        renamed: result.renamed,
        lastUpdated,
        etag,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/prompts/:id', validatePromptUpdate, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const promptId = req.params.id;
      const result = await dbService.updatePrompt(userId, promptId, req.body || {});
      if (!result?.prompt) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      const meta = await dbService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({
        success: true,
        prompt: result.prompt,
        renamed: result.renamed,
        lastUpdated,
        etag,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/prompts/:id', async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const promptId = req.params.id;
      const ok = await dbService.deletePrompt(userId, promptId);
      if (!ok) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      const meta = await dbService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({ success: true, lastUpdated, etag });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/prompts/import', validatePromptImport, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { prompts } = req.body || {};
      const result = await dbService.importPrompts(userId, prompts);
      const meta = await dbService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({
        success: true,
        imported: result.imported,
        renamedCount: result.renamedCount,
        lastUpdated,
        etag,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/retry/:jobId', limitRetry, async (req, res, next) => {
    try {
      const { jobId: oldJobId } = req.params;
      const { clientId } = req.body;

      if (!clientId || !clients.has(clientId)) {
        return res.status(400).json({ error: 'Неверный или отсутствующий clientId' });
      }

      // 1. Get the original job details
      const originalJob = await dbService.getJob(oldJobId, req.user?.id || null);
      if (!originalJob) {
        return res.status(404).json({ error: 'Задание для повтора не найдено.' });
      }

      // 2. Create a new job ID and data object
      const newJobId = uuid();
      const today = new Date().toLocaleDateString('ru-RU');
      const defaultTitle = `Повторный анализ от ${today}`;

      const jobData = {
        id: newJobId,
        title: defaultTitle,
        status: 'queued',
        totalLinks: originalJob.totalLinks,
        links: originalJob.links.map((link) => ({
          url: link.url,
          decisionDate: link.decision_date,
          status: 'pending',
        })),
        prompt: originalJob.prompt,
        originalJobId: oldJobId, // Keep a reference to the original
      };

      // 3. Associate the new job with the client
      const clientData = clients.get(clientId);
      if (clientData && clientData.userId && req.user?.id && clientData.userId === req.user.id) {
        clientData.jobs.add(newJobId);
      } else {
        logger.warn(`[SEC] ClientId ${clientId} does not match req.user for job ${newJobId}`);
      }

      // 4. Save the new job to the database
      await dbService.createJob(
        jobData,
        req.user?.id || null,
        originalJob.workspace_id || null,
        originalJob.matter_id || null
      );
      const newJobState = await dbService.getJob(newJobId, req.user?.id || null);

      // 5. Send initial "queued" status via WebSocket
      sendUpdateToJobOwner(newJobId, {
        ...newJobState,
        status: 'queued',
        progress: 0,
        message: 'Задание в очереди на повтор',
      });

      // 6. Respond to the HTTP request
      res.json({ success: true, jobId: newJobId, ...newJobState });

      // 7. Enqueue the job for the worker
      // Assuming originalJob had a cookie, we might need to handle that if it's stored.
      // For now, passing an empty one as '/collect' does.
      jobQueue.enqueue({
        jobId: newJobId,
        links: newJobState.links,
        cookie: '',
        prompt: newJobState.prompt,
      });
      processQueue();
    } catch (error) {
      next(error);
    }
  });

  router.patch('/jobs/:id/title', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { title } = req.body;

      if (!title || typeof title !== 'string' || title.length > 255) {
        return res.status(400).json({ error: 'Неверный или отсутствующий заголовок' });
      }

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;

      let updatedJob = null;
      if (workspace) {
        const job = await dbService.getJobLightForWorkspace(id, workspace.id);
        if (!job) return res.status(404).json({ error: 'Задание не найдено' });
        if (workspace.role === 'member' && job.user_id && job.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Недостаточно прав доступа' });
        }
        updatedJob = await dbService.updateJobTitleForWorkspace(id, title, workspace.id);
      } else {
        updatedJob = await dbService.updateJobTitle(id, title, req.user?.id || null);
      }

      if (!updatedJob) {
        return res.status(404).json({ error: 'Задание не найдено' });
      }

      // Send a WebSocket update to all relevant clients
      sendUpdateToJobOwner(id, {
        id,
        ...updatedJob,
        message: 'Заголовок обновлен',
      });

      res.status(200).json({ success: true, job: updatedJob });
    } catch (error) {
      next(error);
    }
  });

  router.get('/jobs', async (req, res, next) => {
    try {
      const { limit, page, status = '', search = '' } = req.query;
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const maxLimit = parseInt(process.env.JOBS_MAX_LIMIT || '100', 10);
      const numericLimit = Math.min(parseInt(limit, 10) || maxLimit, maxLimit);
      const finalLimit = limit === 'all' ? maxLimit : numericLimit;

      const wantPaged = typeof page !== 'undefined' || status || search;
      if (limit === 'all' && !wantPaged) {
        const jobs = workspace
          ? await dbService.getRecentJobsForWorkspace(workspace.id, 'all')
          : await dbService.getRecentJobs('all', req.user?.id || null);
        return res.json({ success: true, jobs });
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const result = await dbService.getJobsPage({
        page: pageNum,
        limit: finalLimit,
        status: typeof status === 'string' ? status : '',
        search: typeof search === 'string' ? search : '',
        userId: workspace ? null : req.user?.id || null,
        workspaceId: workspace?.id || null,
      });

      return res.json({
        success: true,
        jobs: result.jobs,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/jobs/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      // Проверяем есть ли активный воркер для этой задачи
      const workerInfo = activeWorkers.get(id);
      if (workerInfo) {
        logger.info(`[DELETE_JOB] Найден активный воркер для задачи ${id}, завершаю его...`);
        forceTerminateWorker(id, 'Задача удалена пользователем');
      }

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;

      if (workspace) {
        const job = await dbService.getJobLightForWorkspace(id, workspace.id);
        if (!job) return res.status(404).json({ error: 'Задание не найдено' });
        if (workspace.role === 'member' && job.user_id && job.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Недостаточно прав доступа' });
        }
        await dbService.deleteJobForWorkspace(id, workspace.id);
      } else {
        await dbService.deleteJob(id, req.user?.id || null);
      }
      // Clean up chat session context and metadata for this job
      if (chatSessions.has(id)) chatSessions.delete(id);
      if (chatMeta.has(id)) chatMeta.delete(id);
      res.status(200).json({
        success: true,
        message: `Job ${id} deleted successfully.`,
        workerTerminated: !!workerInfo,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status/:id', async (req, res, next) => {
    try {
      const include = []
        .concat(req.query.include || [])
        .flat()
        .map((s) => String(s).toLowerCase());
      const wantAnalysis = include.includes('analysis');
      const wantLinks = include.includes('links');

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;

      const userId = workspace ? null : req.user?.id || null;
      const base = workspace
        ? await dbService.getJobLightForWorkspace(req.params.id, workspace.id)
        : await dbService.getJobLight(req.params.id, userId);
      if (!base) return res.status(404).json({ error: 'Задание не найдено' });

      if (wantAnalysis) {
        base.analysis = workspace
          ? await dbService.getJobResultForWorkspace(req.params.id, workspace.id)
          : await dbService.getJobResult(req.params.id, userId);
      }
      if (wantLinks) {
        base.links = workspace
          ? await dbService.getJobLinksLightForWorkspace(req.params.id, workspace.id)
          : await dbService.getJobLinksLight(req.params.id, userId);
      }

      res.json(base);
    } catch (error) {
      next(error);
    }
  });

  // Analysis-only endpoint
  router.get('/jobs/:jobId/analysis', async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const analysis = workspace
        ? await dbService.getJobResultForWorkspace(jobId, workspace.id)
        : await dbService.getJobResult(jobId, req.user?.id || null);
      if (!analysis) return res.status(404).json({ error: 'Анализ для этого задания не найден.' });
      res.json({ success: true, jobId, analysis });
    } catch (error) {
      next(error);
    }
  });

  // Links content-only endpoint (for TXT download on demand)
  router.get('/jobs/:jobId/links-content', async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const links = workspace
        ? await dbService.getLinksContentForWorkspace(jobId, workspace.id)
        : await dbService.getLinksContent(jobId, req.user?.id || null);
      res.json({ success: true, jobId, links });
    } catch (error) {
      next(error);
    }
  });

  // Endpoint для просмотра активных воркеров
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

  // Endpoint для принудительного завершения воркера
  router.post('/workers/:jobId/terminate', requireAdmin, (req, res) => {
    try {
      const { jobId } = req.params;
      const { reason } = req.body;

      const success = forceTerminateWorker(jobId, reason || 'Принудительное завершение через API');

      if (success) {
        res.json({
          success: true,
          message: `Воркер для задачи ${jobId} завершается...`,
          jobId,
        });
      } else {
        res.status(404).json({
          success: false,
          error: `Активный воркер для задачи ${jobId} не найден`,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Ошибка завершения воркера',
        message: error.message,
      });
    }
  });

  // Endpoint для принудительного завершения всех активных воркеров
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

      res.json({
        success: true,
        message: `Завершается ${terminatedCount} из ${workersInfo.count} воркеров`,
        terminated: terminatedCount,
        total: workersInfo.count,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Ошибка массового завершения воркеров',
        message: error.message,
      });
    }
  });

  // Endpoint для отримання статистики системи
  router.get('/system/stats', requireAdmin, async (req, res) => {
    try {
      const workersInfo = getActiveWorkersInfo();
      const memoryUsage = process.memoryUsage();

      // Отримати кількість jobs в черзі з БД
      let queuedJobsCount = 0;
      try {
        const result = await dbService.pool.query(
          `SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'retrying')`
        );
        queuedJobsCount = parseInt(result.rows[0]?.count || 0, 10);
      } catch (dbErr) {
        logger.warn('[STATS] Не вдалося отримати кількість jobs з БД:', dbErr.message);
      }

      res.json({
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
      res.status(500).json({
        success: false,
        error: 'Помилка отримання статистики системи',
        message: error.message,
      });
    }
  });

  // Debug endpoint for chat-session state (requires auth)
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

      res.json({
        success: true,
        config: {
          CHAT_MAX_SESSIONS,
          CHAT_TTL_MS,
          CHAT_CLEANUP_INTERVAL_MS,
        },
        counts: {
          sessions: chatSessions.size,
          metas: chatMeta.size,
        },
        oldest,
        newest,
        sample: items.slice(0, 10),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint для очищення черги
  router.post('/queue/clear', requireAdmin, async (req, res) => {
    try {
      // Очистити кеш cookies
      const cachedCount = jobQueue.getCachedJobsCount();
      jobQueue.clearAllCookies();

      // Скасувати всі queued jobs в БД (змінити статус на 'cancelled')
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

      res.json({
        success: true,
        message: `Чергу очищено. Скасовано ${cancelledCount} завдань, очищено ${cachedCount} cookies`,
        cancelledJobs: cancelledCount,
        clearedCookies: cachedCount,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Помилка очищення черги',
        message: error.message,
      });
    }
  });

  router.post('/chat/:jobId', validateChatMessage, async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Сообщение не может быть пустым' });

      // 1. Получаем необходимый контекст (только при первом сообщении)
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const analysis = workspace
        ? await dbService.getJobResultForWorkspace(jobId, workspace.id)
        : await dbService.getJobResult(jobId, req.user?.id || null);
      if (!analysis) return res.status(404).json({ error: 'Анализ для этого задания не найден.' });

      // 2. Обновляем историю в БД
      await dbService.addChatMessage(jobId, 'user', message, req.user?.id || null);
      const history = workspace
        ? await dbService.getChatHistoryForWorkspace(jobId, workspace.id)
        : await dbService.getChatHistory(jobId, req.user?.id || null);

      // 3. Получаем ответ от AI с использованием сессии
      const hadSessionBefore = chatSessions.has(jobId);
      const answer = await answerChatQuestion(jobId, analysis, history, message, chatSessions);

      // Обновляем/создаем метаданные сессии
      const now = Date.now();
      const current = chatMeta.get(jobId) || { createdAt: now, lastUsed: now };
      chatMeta.set(jobId, {
        createdAt: hadSessionBefore ? (current.createdAt ?? now) : now,
        lastUsed: now,
      });

      // 4. Сохраняем ответ AI в БД
      await dbService.addChatMessage(jobId, 'ai', answer, req.user?.id || null);

      // 5. Отправляем обновленную историю клиенту
      const newHistory = workspace
        ? await dbService.getChatHistoryForWorkspace(jobId, workspace.id)
        : await dbService.getChatHistory(jobId, req.user?.id || null);
      sendUpdateToJobOwner(jobId, { type: 'CHAT_UPDATE', payload: newHistory });

      // 6. Отвечаем на HTTP запрос
      res.json({ success: true, answer });
    } catch (error) {
      next(error);
    }
  });

  router.get('/chat/:jobId', async (req, res, next) => {
    try {
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const history = workspace
        ? await dbService.getChatHistoryForWorkspace(req.params.jobId, workspace.id)
        : await dbService.getChatHistory(req.params.jobId, req.user?.id || null);
      res.json(history);
    } catch (error) {
      next(error);
    }
  });

  router.get('/jobs/last', async (req, res, next) => {
    try {
      const lastJob = await dbService.getLastRelevantJob(req.user?.id || null);
      if (!lastJob) {
        return res.status(404).json({ error: 'Нет доступных заданий' });
      }
      res.json({ success: true, job: lastJob });
    } catch (error) {
      next(error);
    }
  });

  router.get('/health/light', limitHealthLight, (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Кэш состояния health/full, чтобы не дергать дорогие проверки слишком часто
  const HEALTH_TTL = parseInt(process.env.HEALTH_FULL_TTL_MS || '60000', 10);
  let healthCache = { data: null, ts: 0 };

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
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  // Внутренний endpoint для запуска обработки очереди
  router.post('/internal/process-queue', requireAdmin, async (req, res) => {
    try {
      logger.info('[INTERNAL] Запуск обработки очереди по внутреннему запросу');
      processQueue();
      res.json({ success: true, message: 'Queue processing triggered' });
    } catch (error) {
      logger.error('[INTERNAL] Ошибка запуска очереди:', error.message);
      res.status(500).json({ error: 'Failed to process queue' });
    }
  });

  router.get('/processed-urls', async (req, res, next) => {
    try {
      const processedUrls = await dbService.getProcessedUrls(req.user?.id || null);
      res.json({ success: true, urls: processedUrls });
    } catch (error) {
      next(error);
    }
  });

  // Membership check for processed URLs on the current page
  router.post('/urls/processed-check', async (req, res, next) => {
    try {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter(Boolean) : [];
      if (urls.length === 0) return res.json({ success: true, processed: [] });
      const processed = await dbService.getProcessedMembership(urls, req.user?.id || null);
      res.json({ success: true, processed });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
