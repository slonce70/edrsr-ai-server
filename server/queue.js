import { logger } from './utils.js';

/**
 * Job Queue Manager
 *
 * Версія 2.0: Персистентна черга
 * - Черга повністю зберігається в PostgreSQL (таблиця jobs зі статусом 'queued')
 * - In-memory зберігається тільки стан процесора (isProcessing)
 * - Jobs не втрачаються при рестарті сервера
 * - Cookie тимчасово кешується для активних jobs
 */
class JobQueue {
  constructor() {
    // Видалено: this.queue = [] - тепер черга в БД
    this.isProcessing = false;
    // Тимчасовий кеш cookies для активних jobs (не персистується)
    this.cookieCache = new Map(); // jobId → cookie
  }

  /**
   * Додати job в чергу
   * УВАГА: Job має бути вже створений в БД зі статусом 'queued'
   * Цей метод тільки кешує cookie та логує
   * @param {Object} job - { jobId, links, cookie, prompt }
   */
  enqueue(job) {
    // Зберігаємо cookie в тимчасовому кеші
    if (job.cookie) {
      this.cookieCache.set(job.jobId, job.cookie);
      logger.debug(`[QUEUE] Cookie збережено для job ${job.jobId}`);
    }

    logger.info(
      `[QUEUE] Job ${job.jobId} готовий до обробки (cookie: ${job.cookie ? 'є' : 'немає'})`
    );
  }

  /**
   * Отримати наступний job з черги
   * @deprecated Тепер використовується claimNextJob() з dbService напряму
   * @returns {null} Завжди повертає null - черга в БД
   */
  dequeue() {
    // Черга тепер в БД, метод залишено для backward compatibility
    return null;
  }

  /**
   * Отримати cookie для job (якщо є в кеші)
   * @param {string} jobId - ID job
   * @returns {string|null} Cookie або null
   */
  getCachedCookie(jobId) {
    return this.cookieCache.get(jobId) || null;
  }

  /**
   * Очистити cookie з кешу після завершення job
   * @param {string} jobId - ID job
   */
  clearCachedCookie(jobId) {
    this.cookieCache.delete(jobId);
  }

  /**
   * Отримати статус черги
   * @deprecated Черга в БД - використовуйте dbService.getQueuedJobsCount()
   * @returns {Array} Пустий масив для backward compatibility
   */
  getQueueStatus() {
    // Для backward compatibility повертаємо пустий масив
    // Реальний статус отримується з БД
    return [];
  }

  /**
   * Отримати кількість jobs в кеші cookies
   * @returns {number}
   */
  getCachedJobsCount() {
    return this.cookieCache.size;
  }

  startProcessing() {
    this.isProcessing = true;
  }

  endProcessing() {
    this.isProcessing = false;
    logger.info('[QUEUE] Обробник звільнився.');
  }

  isIdle() {
    return !this.isProcessing;
  }

  /**
   * Атомарно зарезервувати слот обробки
   * @returns {boolean} true якщо успішно зарезервовано
   */
  tryReserve() {
    if (this.isProcessing) return false;
    this.isProcessing = true;
    return true;
  }

  /**
   * Очистити весь кеш cookies (при необхідності)
   */
  clearAllCookies() {
    const count = this.cookieCache.size;
    this.cookieCache.clear();
    logger.info(`[QUEUE] Очищено ${count} cookies з кешу`);
  }
}

const jobQueue = new JobQueue();
export default jobQueue;
