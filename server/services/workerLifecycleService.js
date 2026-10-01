import jobWriteService from './jobWriteService.js';
import queueService from './queueService.js';
import jobQueue from '../queue.js';
import { logger } from '../utils.js';
import { sendUpdateToJobOwner } from '../websocket.js';

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}ч ${minutes % 60}м ${seconds % 60}с`;
  if (minutes > 0) return `${minutes}м ${seconds % 60}с`;
  return `${seconds}с`;
}

export function createWorkerLifecycleService({ activeWorkers, processQueue }) {
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
      workers: workers.sort((a, b) => b.runningTimeMs - a.runningTimeMs),
    };
  }

  async function markJobAsForceTerminated(jobId, reason) {
    const errorMessage = `Воркер принудительно завершён: ${reason}`;

    try {
      const updatedJob = await jobWriteService.updateJobStatus(jobId, 'error', {
        error_message: errorMessage,
        end_time: new Date().toISOString(),
      });

      if (updatedJob) {
        sendUpdateToJobOwner(jobId, {
          ...updatedJob,
          error_message: errorMessage,
        });
      }
    } catch (statusError) {
      logger.error(
        `[FORCE_TERMINATE] Ошибка обновления статуса задачи ${jobId}:`,
        statusError.message
      );
    }
  }

  function clearLockAfterForceTerminate(jobId, reason) {
    void markJobAsForceTerminated(jobId, reason).finally(() => {
      queueService.clearJobLock(jobId).catch((error) => {
        logger.error(
          `[FORCE_TERMINATE] Ошибка очистки блокировки в БД для ${jobId}:`,
          error.message
        );
      });
    });
  }

  // A worker counts as live only while activeWorkers still holds this exact entry.
  function isActiveWorker(workerInfo) {
    return activeWorkers.get(workerInfo.jobId) === workerInfo;
  }

  function terminateQuietly(workerInfo) {
    return (async () => workerInfo.worker.terminate())().catch((error) => {
      logger.error(`[${workerInfo.jobId}] Ошибка при завершении воркера:`, error.message);
    });
  }

  // Single exit point for every terminal event (jobSuccess/jobError/jobCancelled, worker 'error'/'exit',
  // force terminate). Only the first call per worker removes the entry, terminates the thread and
  // releases the queue slot; later events from it (incl. the exit(1) caused by our own terminate())
  // return false and must not touch slot accounting. `finalize` (status/lock writes) runs first.
  async function finishWorker(workerInfo, status, finalize) {
    if (!isActiveWorker(workerInfo)) return false;
    workerInfo.status = status;
    activeWorkers.delete(workerInfo.jobId);

    if (finalize) {
      try {
        await finalize();
      } catch (error) {
        logger.error(`[${workerInfo.jobId}] Ошибка завершения воркера (${status}):`, error.message);
      }
    }

    void terminateQuietly(workerInfo);
    jobQueue.endProcessing();
    processQueue();
    return true;
  }

  // 'exit' before any terminal event means the thread died on its own: release the queue (once).
  // After finishWorker() it is only the exit(1) caused by our own terminate() and changes nothing.
  function handleWorkerExit(workerInfo, code) {
    const { jobId } = workerInfo;
    if (!isActiveWorker(workerInfo)) {
      logger.info(`[${jobId}] Воркер завершил работу корректно.`);
      return;
    }
    logger.error(`Воркер для задания ${jobId} завершился с кодом ${code}`);
    logger.info(`[${jobId}] Воркер завершился аварийно. Проверяю очередь...`);
    void finishWorker(workerInfo, 'crashed', () => queueService.clearJobLock(jobId));
  }

  function forceTerminateWorker(jobId, reason = 'Принудительное завершение') {
    const workerInfo = activeWorkers.get(jobId);
    if (!workerInfo) {
      logger.warn(`[FORCE_TERMINATE] Воркер для задачи ${jobId} не найден`);
      return false;
    }

    logger.warn(`[FORCE_TERMINATE] Принудительно завершаю воркер для задачи ${jobId}: ${reason}`);

    try {
      workerInfo.worker.postMessage({
        type: 'cancelJob',
        jobId,
        reason,
      });

      setTimeout(() => {
        // Normally the worker answers with jobCancelled and finishWorker() has already terminated it.
        // Compare the entry itself: a retried job may have a newer worker under the same jobId.
        if (!isActiveWorker(workerInfo)) return;

        logger.error(
          `[FORCE_TERMINATE] Воркер ${jobId} не отвечает на сигнал отмены, принудительно завершаю`
        );

        void finishWorker(workerInfo, 'force_terminated');
        clearLockAfterForceTerminate(jobId, reason);
      }, 3000);

      return true;
    } catch (error) {
      logger.error(`[FORCE_TERMINATE] Ошибка при завершении воркера ${jobId}:`, error.message);

      void finishWorker(workerInfo, 'force_terminated');
      clearLockAfterForceTerminate(jobId, reason);
      return false;
    }
  }

  return {
    finishWorker,
    forceTerminateWorker,
    getActiveWorkersInfo,
    handleWorkerExit,
    isActiveWorker,
  };
}
