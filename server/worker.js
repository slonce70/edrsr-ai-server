import { parentPort, workerData } from 'worker_threads';
import dbService from './services/dbService.js';
import { downloadAll } from './scraper.js';
import { analyzeCases } from './gemini.js';

// --- Request-Response Mechanism for Main Thread Communication ---
const pendingAcks = new Map();
let nextRequestId = 0;
const abortController = new globalThis.AbortController();
let isJobCancelled = false;

parentPort.on('message', (msg) => {
  if (msg.type === 'statusUpdateAck') {
    const resolve = pendingAcks.get(msg.requestId);
    if (resolve) {
      resolve();
      pendingAcks.delete(msg.requestId);
    }
  } else if (msg.type === 'cancelJob') {
    console.log(`⚠️ [WORKER] Отримано сигнал скасування завдання ${msg.jobId}`);
    isJobCancelled = true;
    abortController.abort();

    // Send cancellation response
    parentPort.postMessage({
      type: 'jobCancelled',
      payload: { jobId: msg.jobId, message: 'Задание отменено пользователем' },
    });
  } else if (msg.type === 'healthCheck') {
    // Відповідаємо на перевірку здоровʼя з детальною інформацією
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    parentPort.postMessage({
      type: 'healthCheckResponse',
      timestamp: msg.timestamp,
      alive: true,
      memoryUsage: memUsage,
      memoryUsedMB: memUsedMB,
      isHighMemory: memUsedMB > 300,
      isCriticalMemory: memUsedMB > 400,
    });

    // Якщо памʼять критично висока, примусово запускаємо GC
    if (memUsedMB > 350 && global.gc) {
      console.log(
        `🗑️ [WORKER] Health check triggered GC через високе використання памʼяті: ${memUsedMB}MB`
      );
      global.gc();
    }
  }
});
// --- End Mechanism ---

/**
 * Sends a status update message back to the main thread and waits for acknowledgement.
 * @param {string} status - The current status of the job.
 * @param {number} progress - The progress percentage.
 * @param {string} message - A descriptive message for the status.
 * @param {object} extra - Any extra data to include in the update.
 * @returns {Promise<void>} A promise that resolves when the main thread acknowledges the update.
 */
function postStatusUpdate(status, progress, message, extra = {}) {
  const requestId = nextRequestId++;
  const promise = new Promise((resolve) => {
    pendingAcks.set(requestId, resolve);
  });

  parentPort.postMessage({
    type: 'statusUpdate',
    requestId, // Include the ID in the message
    payload: { status, progress, message, extra },
  });

  return promise;
}

/**
 * The core job processing logic, now running in a worker thread.
 * @param {string} jobId - The ID of the job to process.
 * @param {string[]} links - The array of links to process.
 * @param {string} cookie - The session cookie for scraping.
 * @param {string} prompt - The analysis prompt for Gemini.
 */
async function processJobInWorker(jobId, links, cookie, prompt) {
  const startTime = Date.now();
  // Разрешенное общее время задачи и таймаут отсутствия прогресса (можно переопределить через env)
  const MAX_JOB_DURATION = parseInt(process.env.MAX_JOB_DURATION_MS, 10) || 25 * 60 * 1000; // за замовчуванням 25 хв
  const MAX_STALL_DURATION = parseInt(process.env.MAX_STALL_DURATION_MS, 10) || 20 * 60 * 1000; // за замовчуванням 20 хв без прогресу
  const MAX_MEMORY_MB = 400; // Максимум памʼяті в MB (зменшено з 500)
  const MEMORY_WARNING_MB = 300; // Попередження про памʼять

  let lastProgressTime = Date.now();
  let lastProcessedCount = 0;
  // Throttle UI/status updates to avoid noisy per‑case flicker in the extension
  let lastNotifiedProgress = 0;
  let lastNotifiedProcessed = 0;
  // Notify roughly every 10% of total or at least every 3 items
  const NOTIFY_EVERY = Math.max(3, Math.ceil(links.length / 10));
  const MIN_STATUS_UPDATE_INTERVAL_MS = parseInt(process.env.STATUS_UPDATE_INTERVAL_MS || '2000', 10);
  let lastStatusUpdateAt = Date.now();

  // Глобальный таймаут для всей задачи
  const jobTimeout = setTimeout(() => {
    const maxMins = Math.round(MAX_JOB_DURATION / 60000);
    console.error(
      `⏰ [WORKER] Задание ${jobId} превысило максимальное время выполнения (${maxMins} минут)`
    );
    isJobCancelled = true;
    abortController.abort();

    parentPort.postMessage({
      type: 'jobError',
      payload: {
        errorMessage: 'Задание превысило максимальное время выполнения (30 минут)',
        duration: Math.round((Date.now() - startTime) / 1000),
      },
    });
  }, MAX_JOB_DURATION);

  // Таймаут для отслеживания зависания (отсутствие прогресса)
  const stallCheckInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastProgress = now - lastProgressTime;

    if (timeSinceLastProgress > MAX_STALL_DURATION && !isJobCancelled) {
      console.error(
        `⏰ [WORKER] Задание ${jobId} зависло — нет прогресса ${Math.round(timeSinceLastProgress / 1000)} секунд`
      );
      isJobCancelled = true;
      abortController.abort();

      clearTimeout(jobTimeout);
      clearInterval(stallCheckInterval);

      parentPort.postMessage({
        type: 'jobError',
        payload: {
          errorMessage: `Задание зависло — нет прогресса более ${Math.round(
            MAX_STALL_DURATION / 60000
          )} минут`,
          duration: Math.round((Date.now() - startTime) / 1000),
        },
      });
    }
  }, 30000); // Проверяем каждые 30 секунд

  try {
    // Check if job was cancelled before starting
    if (isJobCancelled) {
      clearTimeout(jobTimeout);
      throw new Error('Задание отменено до начала обработки');
    }

    // Log initial memory usage
    const initialMem = process.memoryUsage();
    console.log(
      `🚀 [WORKER] Старт завдання ${jobId} з ${links.length} посиланнями. Початкова памʼять: ${Math.round(initialMem.heapUsed / 1024 / 1024)}MB`
    );

    await postStatusUpdate('downloading', 10, `Инициализация загрузки ${links.length} дел...`);

    // Пакетная обработка: разделяем ссылки на пакеты по ENV или 5 по умолчанию
    const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 25;
    const batches = [];
    for (let i = 0; i < links.length; i += BATCH_SIZE) {
      batches.push(links.slice(i, i + BATCH_SIZE));
    }

    let totalProcessedCount = 0;
    const allValidCasesForAnalysis = []; // Возвращаем оригинальную логику для качественного анализа

    // Обрабатываем каждый пакет отдельно
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const urlsToDownload = batch.map((link) => link.url);

      console.log(
        `🔄 [WORKER] Обробка пакета ${batchIndex + 1}/${batches.length} (${batch.length} файлів)`
      );
      const memBeforeBatch = process.memoryUsage();
      console.log(
        `📊 [WORKER] До пакета ${batchIndex + 1}: heap=${Math.round(
          memBeforeBatch.heapUsed / 1024 / 1024
        )}MB rss=${Math.round(memBeforeBatch.rss / 1024 / 1024)}MB`
      );

      // Загружаем текущий пакет
      const cases = await downloadAll(
        urlsToDownload,
        cookie,
        async (processedCount) => {
          // Check for cancellation during progress updates
          if (isJobCancelled || abortController.signal.aborted) {
            throw new Error('Завдання скасовано користувачем');
          }

          // Обновляем информацию о прогрессе для отслеживания зависания
          const currentTotalProcessed = totalProcessedCount + processedCount;
          if (currentTotalProcessed > lastProcessedCount) {
            lastProgressTime = Date.now();
            lastProcessedCount = currentTotalProcessed;
          }

          const progress = 10 + Math.round((currentTotalProcessed / links.length) * 50);

          // Monitor memory usage during processing
          const memUsage = process.memoryUsage();
          const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

          const progressedEnough = progress >= lastNotifiedProgress + 5; // 5% steps
          const processedEnough =
            currentTotalProcessed - lastNotifiedProcessed >= NOTIFY_EVERY ||
            processedCount === batch.length; // always at batch end

          const now = Date.now();
          const isBatchEnd = processedCount === batch.length;
          const isJobEnd = currentTotalProcessed >= links.length;
          const intervalElapsed = now - lastStatusUpdateAt >= MIN_STATUS_UPDATE_INTERVAL_MS;

          if ((progressedEnough || processedEnough || isBatchEnd || isJobEnd) && (intervalElapsed || isBatchEnd || isJobEnd)) {
            await postStatusUpdate(
              'downloading',
              progress,
              `Пакет ${batchIndex + 1}/${batches.length}: ${processedCount}/${batch.length}, всего: ${currentTotalProcessed}/${links.length} (Память: ${memUsedMB}MB)`,
              {
                processed_links: currentTotalProcessed,
                memory_usage_mb: memUsedMB,
                current_batch: batchIndex + 1,
                total_batches: batches.length,
              }
            );
            lastNotifiedProgress = progress;
            lastNotifiedProcessed = currentTotalProcessed;
            lastStatusUpdateAt = now;
          }

          // Проактивный мониторинг памяти
          if (memUsedMB > MEMORY_WARNING_MB) {
            console.warn(`⚠️ [WORKER] Високе використання памʼяті: ${memUsedMB}MB`);
            // Принудительная сборка мусора при превышении предупреждения
            if (global.gc) {
              global.gc();
              const memAfterGC = process.memoryUsage();
              const memAfterGCMB = Math.round(memAfterGC.heapUsed / 1024 / 1024);
              console.log(
                `🗑️ [WORKER] Примусова збірка сміття: ${memUsedMB}MB -> ${memAfterGCMB}MB`
              );

              if (memAfterGCMB > MAX_MEMORY_MB) {
                throw new Error(
                  `Перевищено ліміт памʼяті: ${memAfterGCMB}MB > ${MAX_MEMORY_MB}MB після GC`
                );
              }
            } else if (memUsedMB > MAX_MEMORY_MB) {
              throw new Error(`Перевищено ліміт памʼяті: ${memUsedMB}MB > ${MAX_MEMORY_MB}MB`);
            }
          }
        },
        abortController.signal
      );

      // Сопоставляем результаты загрузки с исходными данными (включая decision_date)
      const casesWithDates = cases.map((caseData) => {
        const originalLinkData = batch.find((l) => l.url === caseData.url);
        return {
          ...caseData,
          decisionDate: originalLinkData ? originalLinkData.decision_date : null,
        };
      });

      // Немедленно сохраняем пакет в базу данных
      for (const caseData of casesWithDates) {
        if (caseData.error) {
          await dbService.updateLinkStatus(jobId, caseData.url, 'error', null, caseData.error);
        } else {
          await dbService.updateLinkStatus(
            jobId,
            caseData.url,
            'processed',
            caseData.body,
            null,
            caseData.metadata
          );
        }
      }

      // Логируем метрики после сохранения пакета
      const memAfterSave = process.memoryUsage();
      console.log(
        `📊 [WORKER] После сохранения пакета ${batchIndex + 1}: heap=${Math.round(
          memAfterSave.heapUsed / 1024 / 1024
        )}MB rss=${Math.round(memAfterSave.rss / 1024 / 1024)}MB`
      );

      // Собираем валидные случаи для анализа (сохраняем оригинальную логику)
      const validCasesInBatch = casesWithDates.filter((c) => !c.error);

      // Оптимизация памяти: оставляем только нужные поля для AI
      const optimizedCases = validCasesInBatch.map((caseData) => ({
        caseNumber: caseData.caseNumber,
        id: caseData.id || caseData.caseNumber,
        url: caseData.url,
        body: caseData.body, // Нужно для AI
        decisionDate: caseData.decisionDate,
      }));

      allValidCasesForAnalysis.push(...optimizedCases);

      // Очищаем память после копирования
      for (const caseData of casesWithDates) {
        caseData.body = null;
        caseData.metadata = null;
      }
      cases.length = 0;
      casesWithDates.length = 0;
      validCasesInBatch.length = 0;
      optimizedCases.length = 0;

      // Принудительный запуск сборщика мусора между пакетами
      if (global.gc) {
        global.gc();
        const memAfterGC = process.memoryUsage();
        console.log(
          `🗑️ [WORKER] Збірка сміття після пакета ${batchIndex + 1}: ${Math.round(memAfterGC.heapUsed / 1024 / 1024)}MB`
        );
      }

      totalProcessedCount += batch.length;
    }

    // Выполняем AI анализ всех валидных случаев (оригинальная логика)
    const analysis = await analyzeCases(allValidCasesForAnalysis, prompt, (statusUpdate) =>
      postStatusUpdate('analyzing', 65, statusUpdate, { processed_links: links.length })
    );

    // Очищаем память после завершения AI анализа
    for (const caseData of allValidCasesForAnalysis) {
      caseData.body = null;
    }
    allValidCasesForAnalysis.length = 0;

    // Финальная сборка мусора
    if (global.gc) {
      global.gc();
    }

    // Прагнемо зберегти результат аналізу
    try {
      await dbService.saveJobResult(jobId, analysis);
      console.log(`[WORKER] ✅ Результат аналізу збережено для завдання ${jobId}`);
    } catch (error) {
      // Якщо завдання було видалено, dbService.saveJobResult тихо проігнорує це
      // але якщо сталася інша помилка — логую її
      console.warn(
        `[WORKER] ⚠️ Попередження під час збереження результату для ${jobId}:`,
        error.message
      );
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    clearTimeout(jobTimeout);
    clearInterval(stallCheckInterval);
    parentPort.postMessage({
      type: 'jobSuccess',
      payload: { duration },
    });
  } catch (error) {
    clearTimeout(jobTimeout);
    clearInterval(stallCheckInterval);
    console.error(`❌ Помилка обробки завдання ${jobId} у воркері:`, error.message, error.stack);
    const duration = Math.round((Date.now() - startTime) / 1000);
    // Convert fatal batch failure into retryable job status by signaling a soft error
    parentPort.postMessage({
      type: 'jobError',
      payload: {
        errorMessage: error.message,
        duration,
        retrySuggested: true,
      },
    });
  }
}

// Start the job processing from workerData passed from the main thread
const { jobId, links, cookie, prompt } = workerData;
processJobInWorker(jobId, links, cookie, prompt);
