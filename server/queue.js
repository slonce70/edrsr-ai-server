import { logger } from './utils.js';

class JobQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  enqueue(job) {
    this.queue.push(job);
    logger.info(
      `[QUEUE] Задание ${job.jobId} добавлено в очередь. Всего в очереди: ${this.queue.length}`
    );
  }

  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue.shift();
  }

  getQueueStatus() {
    return this.queue;
  }

  startProcessing() {
    this.isProcessing = true;
  }

  endProcessing() {
    this.isProcessing = false;
    logger.info('[QUEUE] Обработчик освободился.');
  }

  isIdle() {
    return !this.isProcessing;
  }

  // Atomically reserve processing slot to avoid races between concurrent triggers
  tryReserve() {
    if (this.isProcessing) return false;
    this.isProcessing = true;
    return true;
  }
}

const jobQueue = new JobQueue();
export default jobQueue;
