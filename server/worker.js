import { parentPort, workerData } from 'worker_threads';
import dbService from './services/dbService.js';
import { downloadAll } from './scraper.js';
import { analyzeCases } from './gemini.js';

// --- Request-Response Mechanism for Main Thread Communication ---
const pendingAcks = new Map();
let nextRequestId = 0;
const abortController = new AbortController();
let isJobCancelled = false;

parentPort.on('message', (msg) => {
  if (msg.type === 'statusUpdateAck') {
    const resolve = pendingAcks.get(msg.requestId);
    if (resolve) {
      resolve();
      pendingAcks.delete(msg.requestId);
    }
  } else if (msg.type === 'cancelJob') {
    console.log(`⚠️ [WORKER] Получен сигнал отмены задачи ${msg.jobId}`);
    isJobCancelled = true;
    abortController.abort();

    // Send cancellation response
    parentPort.postMessage({
      type: 'jobCancelled',
      payload: { jobId: msg.jobId, message: 'Задача отменена пользователем' },
    });
  } else if (msg.type === 'healthCheck') {
    // Отвечаем на проверку здоровья с детальной информацией
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    parentPort.postMessage({
      type: 'healthCheckResponse',
      timestamp: msg.timestamp,
      alive: true,
      memoryUsage: memUsage,
      memoryUsedMB: memUsedMB,
      isHighMemory: memUsedMB > 300,
      isCriticalMemory: memUsedMB > 400
    });
    
    // Если память критически высокая, принудительно запускаем GC
    if (memUsedMB > 350 && global.gc) {
      console.log(`🗑️ [WORKER] Health check triggered GC due to high memory: ${memUsedMB}MB`);
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
  const MAX_JOB_DURATION = parseInt(process.env.MAX_JOB_DURATION_MS, 10) || 25 * 60 * 1000; // по умолчанию 25 минут
  const MAX_STALL_DURATION = parseInt(process.env.MAX_STALL_DURATION_MS, 10) || 20 * 60 * 1000; // по умолчанию 20 минут без прогресса
  const MAX_MEMORY_MB = 400; // Максимум памяти в MB (снижено с 500)
  const MEMORY_WARNING_MB = 300; // Предупреждение о памяти

  let lastProgressTime = Date.now();
  let lastProcessedCount = 0;

  // Глобальный таймаут для всей задачи
  const jobTimeout = setTimeout(() => {
    const maxMins = Math.round(MAX_JOB_DURATION / 60000);
    console.error(`⏰ [WORKER] Задача ${jobId} превысила максимальное время выполнения (${maxMins} минут)`);
    isJobCancelled = true;
    abortController.abort();

    parentPort.postMessage({
      type: 'jobError',
      payload: {
        errorMessage: 'Задача превысила максимальное время выполнения (30 минут)',
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
        `⏰ [WORKER] Задача ${jobId} зависла - нет прогресса ${Math.round(timeSinceLastProgress / 1000)} секунд`
      );
      isJobCancelled = true;
      abortController.abort();

      clearTimeout(jobTimeout);
      clearInterval(stallCheckInterval);

      parentPort.postMessage({
        type: 'jobError',
        payload: {
          errorMessage: `Задача зависла — нет прогресса более ${Math.round(
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
      throw new Error('Задача отменена до начала обработки');
    }

    // Log initial memory usage
    const initialMem = process.memoryUsage();
    console.log(
      `🚀 [WORKER] Starting job ${jobId} with ${links.length} links. Initial memory: ${Math.round(initialMem.heapUsed / 1024 / 1024)}MB`
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
        `🔄 [WORKER] Обработка пакета ${batchIndex + 1}/${batches.length} (${batch.length} файлов)`
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
            throw new Error('Задача отменена пользователем');
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

          await postStatusUpdate(
            'downloading',
            progress,
            `Пакет ${batchIndex + 1}/${batches.length}: ${processedCount}/${batch.length}, всего: ${currentTotalProcessed}/${links.length} (Memory: ${memUsedMB}MB)`,
            {
              processed_links: currentTotalProcessed,
              memory_usage_mb: memUsedMB,
              current_batch: batchIndex + 1,
              total_batches: batches.length,
            }
          );

          // Проактивный мониторинг памяти
          if (memUsedMB > MEMORY_WARNING_MB) {
            console.warn(`⚠️ [WORKER] High memory usage: ${memUsedMB}MB`);
            // Принудительная сборка мусора при превышении предупреждения
            if (global.gc) {
              global.gc();
              const memAfterGC = process.memoryUsage();
              const memAfterGCMB = Math.round(memAfterGC.heapUsed / 1024 / 1024);
              console.log(`🗑️ [WORKER] Forced GC: ${memUsedMB}MB -> ${memAfterGCMB}MB`);
              
              if (memAfterGCMB > MAX_MEMORY_MB) {
                throw new Error(`Memory limit exceeded: ${memAfterGCMB}MB > ${MAX_MEMORY_MB}MB after GC`);
              }
            } else if (memUsedMB > MAX_MEMORY_MB) {
              throw new Error(`Memory limit exceeded: ${memUsedMB}MB > ${MAX_MEMORY_MB}MB`);
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
      const optimizedCases = validCasesInBatch.map(caseData => ({
        caseNumber: caseData.caseNumber,
        id: caseData.id || caseData.caseNumber,
        url: caseData.url,
        body: caseData.body, // Нужно для AI
        decisionDate: caseData.decisionDate
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
          `🗑️ [WORKER] Сборка мусора после пакета ${batchIndex + 1}: ${Math.round(memAfterGC.heapUsed / 1024 / 1024)}MB`
        );
      }

      totalProcessedCount += batch.length;
    }

    // Выполняем AI анализ всех валидных случаев (оригинальная логика)
    const analysis = await analyzeCases(allValidCasesForAnalysis, prompt, (statusUpdate) =>
      postStatusUpdate('analyzing', 65, statusUpdate)
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

    // Пытаемся сохранить результат анализа
    try {
      await dbService.saveJobResult(jobId, analysis);
      console.log(`[WORKER] ✅ Результат анализа сохранен для задачи ${jobId}`);
    } catch (error) {
      // Если задача была удалена, dbService.saveJobResult тихо проигнорирует это
      // но если произошла другая ошибка, логируем её
      console.warn(
        `[WORKER] ⚠️ Предупреждение при сохранении результата для ${jobId}:`,
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
    console.error(`❌ Ошибка обработки задания ${jobId} в воркере:`, error.message, error.stack);
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
