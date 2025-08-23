import express from 'express';
import { v4 as uuid } from 'uuid';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

import { createClient } from '@supabase/supabase-js';
import dbService from '../services/dbService.js';
import { attachUser, requireAuthExcept } from '../middleware/auth.js';
import { limitCollect, limitRetry } from '../middleware/rateLimit.js';
import { adminLoginRateLimit, checkBlocked, trackFailedLogin } from '../middleware/security.js';
import { answerChatQuestion, testGeminiConnection } from '../gemini.js';
import jobQueue from '../queue.js';
import { sendUpdateToJobOwner } from '../websocket.js';
import { logger } from '../utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Supabase client for auth
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
let supabase;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Auth endpoints (public)
router.post('/auth/signin', 
  // Add security middleware
  adminLoginRateLimit,
  checkBlocked,
  trackFailedLogin,
  async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      return res.status(401).json({ error: error.message });
    }
    
    res.json({
      access_token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    });
  } catch (error) {
    logger.error('Sign in error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Attach user (if any) and require auth for all routes except auth and health endpoints
router.use(attachUser);
router.use(requireAuthExcept(['/health/light', '/health/full', '/auth/signin']));
// Чат‑сессии и их метаданные (LRU + TTL)
const chatSessions = new Map(); // jobId -> ChatSession
const chatMeta = new Map(); // jobId -> { createdAt: number, lastUsed: number }

// Настройки лимитов/TTL для чат‑сессий
const CHAT_MAX_SESSIONS = Number.parseInt(process.env.CHAT_MAX_SESSIONS || '100', 10);
const CHAT_TTL_MS = Number.parseInt(
  process.env.CHAT_TTL_MS || String(4 * 60 * 60 * 1000),
  10
); // по умолчанию 4 часа
const CHAT_CLEANUP_INTERVAL_MS = Number.parseInt(
  process.env.CHAT_CLEANUP_INTERVAL_MS || String(5 * 60 * 1000),
  10
); // каждые 5 минут
const activeWorkers = new Map(); // Для отслеживания активных воркеров: jobId -> worker

function truncate(str, max = 70) {
  if (!str) return '';
  const s = String(str).trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function generateInitialTitle({ linksCount = 0, prompt = null, promptLabel = null }) {
  const n = linksCount || 0;
  const suffix = n > 0 ? ` — ${n} справ` : '';
  if (promptLabel && promptLabel.trim()) return `Аналіз: «${truncate(promptLabel, 40)}»${suffix}`;
  if (prompt && typeof prompt === 'string' && prompt.trim()) {
    const words = prompt
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(' ');
    if (words) return `Запит: ${truncate(words, 40)}${suffix}`;
  }
  const today = new Date().toLocaleDateString('uk-UA');
  return `Аналіз від ${today}${suffix}`;
}

async function refreshHeuristicTitle(jobId) {
  try {
    const userId = await dbService.getJobOwnerId(jobId);
    const summary = await dbService.summarizeJobForTitle(jobId, userId || null);
    const { processed, total, topArticle, topCaseType } = summary;
    if (!total || total < 1) return false;
    let base = '';
    if (topArticle) base = `Ст. ${topArticle}`;
    else if (topCaseType) base = `${topCaseType}`;
    else base = 'Аналіз';
    const suffix = processed ? ` — ${processed} з ${total}` : ` — ${total}`;
    const title = truncate(`${base}${suffix}`, 70);
    const ok = await dbService.updateAutoTitleIfAllowed(jobId, title, 'heuristic');
    if (ok) {
      const updatedJob = await dbService.getJob(jobId, userId || null);
      // Send light update to clients
      sendUpdateToJobOwner(jobId, {
        id: updatedJob.id,
        title: updatedJob.title,
        status: updatedJob.status,
        progress: updatedJob.progress,
        processed_links: updatedJob.processed_links,
        total_links: updatedJob.total_links,
        updated_at: updatedJob.updated_at,
      });
    }
    return ok;
  } catch (e) {
    logger.debug(`[TITLE] refreshHeuristicTitle error for ${jobId}: ${e.message}`);
    return false;
  }
}

function startWorker({ jobId, links, cookie, prompt }) {
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
    const updatedJob = await dbService.updateJobStatus(jobId, status, jobDataToUpdate);

    // Send light updates during progress to reduce payload; full data only on completion
    const wsData =
      status === 'completed'
        ? { ...updatedJob, status, progress, message }
        : {
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
          };

    sendUpdateToJobOwner(jobId, wsData);
    logger.info(`[${jobId}] Status: ${status}, Progress: ${progress}%, Message: ${message}`);
  };

  worker.on('message', async (msg) => {
    if (msg.type === 'statusUpdate') {
      const { status, progress, message, extra } = msg.payload;
      await updateStatus(status, progress, message, extra);
      // Try early title refinement once some links processed
      if (extra?.processed_links && extra.processed_links >= 3) {
        refreshHeuristicTitle(jobId);
      }
      // Acknowledge the update so the worker can proceed
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.worker.postMessage({ type: 'statusUpdateAck', requestId: msg.requestId });
      }
    } else if (msg.type === 'jobSuccess') {
      await updateStatus('analyzing', 95, 'Контроль якості...');
      await updateStatus('completed', 100, 'Анализ успешно завершен!', msg.payload);
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
      logger.info(`[${jobId}] Задача завершена успешно. Проверяю очередь...`);

      processQueue();
    } else if (msg.type === 'jobError') {
      const { errorMessage, duration } = msg.payload;
      await updateStatus('error', 0, `Критическая ошибка: ${errorMessage}`, {
        errorMessage,
        duration,
      });
      // Удаляем воркер из отслеживания
      const workerInfo = activeWorkers.get(jobId);
      if (workerInfo) {
        workerInfo.status = 'error';
        activeWorkers.delete(jobId);
      }
      // Освобождаем обработчик и запускаем следующую задачу
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Задача завершена с ошибкой. Проверяю очередь...`);

      processQueue();
    } else if (msg.type === 'jobCancelled') {
      const { message } = msg.payload;
      await updateStatus('error', 0, `Задача отменена: ${message}`, {
        errorMessage: message,
      });
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
      errorMessage: error.message,
    });
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      logger.error(`Воркер для задания ${jobId} завершился с кодом ${code}`);
      // Если воркер упал некорректно, нужно освободить очередь
      jobQueue.endProcessing();
      logger.info(`[${jobId}] Воркер завершился аварийно. Проверяю очередь...`);

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

    // Даем воркеру 5 секунд на корректное завершение
    setTimeout(() => {
      const stillActive = activeWorkers.get(jobId);
      if (stillActive) {
        logger.error(
          `[FORCE_TERMINATE] Воркер ${jobId} не отвечает на сигнал отмены, принудительно завершаю`
        );

        // Принудительно завершаем воркер
        stillActive.worker.terminate();
        stillActive.status = 'force_terminated';
        activeWorkers.delete(jobId);

        // Освобождаем очередь если этот воркер блокировал её
        if (!jobQueue.isIdle()) {
          jobQueue.endProcessing();
          processQueue();
        }
      }
    }, 5000);

    return true;
  } catch (error) {
    logger.error(`[FORCE_TERMINATE] Ошибка при завершении воркера ${jobId}:`, error.message);

    // В случае ошибки все равно удаляем из отслеживания
    activeWorkers.delete(jobId);
    return false;
  }
}

function processQueue() {
  if (jobQueue.isIdle() && jobQueue.getQueueStatus().length > 0) {
    const job = jobQueue.dequeue();
    if (job) {
      logger.info(`[QUEUE] Запускаю задание ${job.jobId} из очереди.`);
      jobQueue.startProcessing();
      startWorker(job);
    }
  } else {
    logger.info('[QUEUE] Обработчик занят или очередь пуста.');
  }
}

// Автоматическая очистка зависших воркеров
function startWorkerCleanupService() {
  const CLEANUP_INTERVAL = 2 * 60 * 1000; // Проверяем каждые 2 минуты
  const MAX_WORKER_LIFETIME = 35 * 60 * 1000; // 35 минут максимум (больше чем в worker.js)
  const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // Проверяем здоровье воркеров каждые 5 минут

  let lastHealthCheck = Date.now();

  setInterval(() => {
    const now = Date.now();
    const workersToTerminate = [];
    const workersToHealthCheck = [];

    for (const [jobId, workerInfo] of activeWorkers.entries()) {
      const runningTime = now - workerInfo.startTime;

      // Если воркер работает дольше максимального времени
      if (runningTime > MAX_WORKER_LIFETIME) {
        workersToTerminate.push({
          jobId,
          runningTime,
          reason: `Превышено максимальное время работы (${Math.round(runningTime / 1000 / 60)} минут)`,
        });
      }
      // Если воркер работает долго, но еще не превысил лимит - проверим его здоровье
      else if (runningTime > 10 * 60 * 1000) {
        // Больше 10 минут
        workersToHealthCheck.push({ jobId, workerInfo, runningTime });
      }
    }

    // Завершаем зависшие воркеры
    if (workersToTerminate.length > 0) {
      logger.warn(`[CLEANUP] Найдено ${workersToTerminate.length} зависших воркеров, завершаю...`);

      for (const { jobId, runningTime, reason } of workersToTerminate) {
        logger.warn(
          `[CLEANUP] Завершаю зависший воркер ${jobId} (работал ${Math.round(runningTime / 1000 / 60)} минут)`
        );
        forceTerminateWorker(jobId, reason);
      }
    }

    // Проверяем здоровье долго работающих воркеров
    if (workersToHealthCheck.length > 0 && now - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
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
  // Запускаем службу очистки при инициализации
  startWorkerCleanupService();
  // Запускаем периодическую очистку чат‑сессий
  try {
    setInterval(() => evictExpiredChatSessions('interval'), CHAT_CLEANUP_INTERVAL_MS);
    // Стартовая разовая очистка (на случай рестарта)
    evictExpiredChatSessions('startup');
    logger.info(
      `[CHAT_CLEANUP] Service started. TTL=${CHAT_TTL_MS}ms, MAX=${CHAT_MAX_SESSIONS}, INTERVAL=${CHAT_CLEANUP_INTERVAL_MS}ms`
    );
  } catch (e) {
    logger.error('[CHAT_CLEANUP] Failed to start cleanup interval', e);
  }

  router.post('/collect', limitCollect, async (req, res, next) => {
    try {
      const { links, cookie = '', prompt = null, clientId } = req.body;
      const autoTitleEnabled =
        typeof req.body.auto_title_enabled === 'boolean' ? req.body.auto_title_enabled : true;
      const promptLabel = req.body.prompt_label || null;
      if (!links || !Array.isArray(links) || links.length === 0) {
        return res.status(400).json({ error: 'Массив ссылок "links" не может быть пустым' });
      }
      if (!clientId || !clients.has(clientId)) {
        return res.status(400).json({ error: 'Неверный или отсутствующий clientId' });
      }

      // Валидация, чтобы предотвратить падение сервера
      const validLinks = links.filter((link) => link && typeof link === 'object' && link.url);
      if (validLinks.length < links.length) {
        logger.warn(
          `[VALIDATION] Получен некорректный массив ссылок. Отфильтровано ${links.length - validLinks.length} невалидных элементов.`
        );
      }
      if (validLinks.length === 0) {
        return res
          .status(400)
          .json({ error: 'Не найдено ни одной валидной ссылки для обработки.' });
      }

      const jobId = uuid();
      const defaultTitle = generateInitialTitle({
        linksCount: validLinks.length,
        prompt,
        promptLabel,
      });

      const jobData = {
        id: jobId,
        title: defaultTitle,
        status: 'queued',
        totalLinks: validLinks.length,
        links: validLinks,
        prompt,
        titleSource: 'heuristic',
        autoTitleEnabled,
      };

      // Привязываем job к WebSocket только если он принадлежит тому же пользователю
      const clientData = clients.get(clientId);
      if (clientData && clientData.userId && req.user?.id && clientData.userId === req.user.id) {
        clientData.jobs.add(jobId);
      } else {
        logger.warn(`[SEC] ClientId ${clientId} does not match req.user for job ${jobId}`);
      }

      await dbService.createJob(jobData, req.user?.id || null);
      const initialJobState = await dbService.getJob(jobId, req.user?.id || null);

      await dbService.updateJobStatus(jobId, 'queued', { progress: 0 });
      sendUpdateToJobOwner(jobId, {
        ...initialJobState,
        status: 'queued',
        progress: 0,
        message: 'Задание в очереди',
      });

      res.json({ success: true, jobId, ...initialJobState });

      jobQueue.enqueue({ jobId, links, cookie, prompt });
      processQueue();
    } catch (error) {
      next(error);
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
      const today = new Date().toLocaleDateString('uk-UA');
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
      await dbService.createJob(jobData, req.user?.id || null);
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

      const updatedJob = await dbService.updateJobTitle(id, title, req.user?.id || null);

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
      const { limit } = req.query;
      const finalLimit = limit === 'all' ? 'all' : parseInt(limit, 10) || null;
      const jobs = await dbService.getRecentJobs(finalLimit, req.user?.id || null);
      res.json({ success: true, jobs });
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

      await dbService.deleteJob(id, req.user?.id || null);
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
      const job = await dbService.getJob(req.params.id, req.user?.id || null);
      if (!job) return res.status(404).json({ error: 'Задание не найдено' });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  // Endpoint для просмотра активных воркеров
  router.get('/workers/active', (req, res) => {
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
  router.post('/workers/:jobId/terminate', (req, res) => {
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
  router.post('/workers/terminate-all', (req, res) => {
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

  // Endpoint для получения статистики системы
  router.get('/system/stats', (req, res) => {
    try {
      const workersInfo = getActiveWorkersInfo();
      const queueStatus = jobQueue.getQueueStatus();
      const memoryUsage = process.memoryUsage();

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        workers: {
          active: workersInfo.count,
          details: workersInfo.workers,
        },
        queue: {
          length: queueStatus.length,
          isProcessing: !jobQueue.isIdle(),
          jobs: queueStatus.map((job) => ({
            jobId: job.jobId,
            linksCount: job.links?.length || 0,
          })),
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
        error: 'Ошибка получения статистики системы',
        message: error.message,
      });
    }
  });

  // Debug endpoint for chat-session state (requires auth)
  router.get('/system/chat-sessions', (req, res) => {
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

  // Endpoint для очистки очереди
  router.post('/queue/clear', (req, res) => {
    try {
      const queueLength = jobQueue.getQueueStatus().length;

      // Очищаем очередь
      while (jobQueue.getQueueStatus().length > 0) {
        jobQueue.dequeue();
      }

      res.json({
        success: true,
        message: `Очередь очищена. Удалено ${queueLength} заданий`,
        clearedJobs: queueLength,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Ошибка очистки очереди',
        message: error.message,
      });
    }
  });

  router.post('/chat/:jobId', async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Повідомлення не може бути порожнім' });

      // 1. Получаем необходимый контекст (только при первом сообщении)
      const analysis = await dbService.getJobResult(jobId, req.user?.id || null);
      if (!analysis)
        return res.status(404).json({ error: 'Аналіз для цього завдання не знайдено.' });

      // 2. Обновляем историю в БД
      await dbService.addChatMessage(jobId, 'user', message, req.user?.id || null);
      const history = await dbService.getChatHistory(jobId, req.user?.id || null);

      // 3. Получаем ответ от AI с использованием сессии
      const hadSessionBefore = chatSessions.has(jobId);
      const answer = await answerChatQuestion(jobId, analysis, history, message, chatSessions);

      // Обновляем/создаем метаданные сессии
      const now = Date.now();
      const current = chatMeta.get(jobId) || { createdAt: now, lastUsed: now };
      chatMeta.set(jobId, {
        createdAt: hadSessionBefore ? current.createdAt ?? now : now,
        lastUsed: now,
      });

      // 4. Сохраняем ответ AI в БД
      await dbService.addChatMessage(jobId, 'ai', answer, req.user?.id || null);

      // 5. Отправляем обновленную историю клиенту
      const newHistory = await dbService.getChatHistory(jobId, req.user?.id || null);
      sendUpdateToJobOwner(jobId, { type: 'CHAT_UPDATE', payload: newHistory });

      // 6. Отвечаем на HTTP запрос
      res.json({ success: true, answer });
    } catch (error) {
      next(error);
    }
  });

  router.get('/chat/:jobId', async (req, res, next) => {
    try {
      res.json(await dbService.getChatHistory(req.params.jobId, req.user?.id || null));
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

  router.get('/health/light', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/health/full', async (req, res, next) => {
    try {
      const [geminiStatus, activeJobs] = await Promise.all([
        testGeminiConnection(),
        dbService.getActiveJobsCount(),
      ]);
      res.json({
        status: 'healthy',
        services: { gemini: geminiStatus ? 'online' : 'offline' },
        activeJobs,
        version: '1.1.0',
      });
    } catch (error) {
      next(error);
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

  return router;
}
