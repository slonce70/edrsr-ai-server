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

  function releaseQueueIfNeeded() {
    if (!jobQueue.isIdle()) {
      jobQueue.endProcessing();
      processQueue();
    }
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
        const stillActive = activeWorkers.get(jobId);
        if (!stillActive) return;

        logger.error(
          `[FORCE_TERMINATE] Воркер ${jobId} не отвечает на сигнал отмены, принудительно завершаю`
        );

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
        clearLockAfterForceTerminate(jobId, reason);
        releaseQueueIfNeeded();
      }, 3000);

      return true;
    } catch (error) {
      logger.error(`[FORCE_TERMINATE] Ошибка при завершении воркера ${jobId}:`, error.message);

      activeWorkers.delete(jobId);
      clearLockAfterForceTerminate(jobId, reason);
      return false;
    }
  }

  return {
    forceTerminateWorker,
    getActiveWorkersInfo,
  };
}
