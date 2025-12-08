/**
 * Parallel batch processor for legal case analysis
 * Handles concurrent batch processing while maintaining order and error handling
 * Адаптивно масштабує паралелізм на основі кількості доступних API ключів
 */

import { getBatchSummary } from './batchProcessor.js';
import { apiKeyManager } from './config.js';
import { sleep } from './utils.js';
import { logger } from './utils.js';

// Максимальна кількість паралельних батчів (обмеження через пам'ять на Render.com 512MB)
const MAX_SAFE_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BATCHES, 10) || 5;

/**
 * Розрахувати оптимальну кількість паралельних батчів
 * Враховує: кількість API ключів та обмеження пам'яті
 * @returns {number}
 */
function getOptimalConcurrency() {
  const availableKeys = apiKeyManager.totalCount;
  const optimalConcurrency = Math.min(availableKeys, MAX_SAFE_CONCURRENT);
  logger.debug(`📊 Optimal concurrency: ${optimalConcurrency} (keys: ${availableKeys}, max: ${MAX_SAFE_CONCURRENT})`);
  return optimalConcurrency;
}

/**
 * Class for managing parallel batch processing with order preservation
 */
export class ParallelBatchProcessor {
  constructor() {
    this.activeBatches = new Map(); // trackId -> { batchIndex, promise, startTime, reservedKey }
    this.completedResults = new Map(); // batchIndex -> result
    this.progressCallback = null;
    this.totalBatches = 0;
    this.maxConcurrent = getOptimalConcurrency();
  }

  /**
   * Process batches in parallel while maintaining order
   * @param {Array} batches - Array of batch cases
   * @param {string} userPrompt - Analysis prompt
   * @param {Function} updateCallback - Progress update callback
   * @returns {Array} - Ordered array of batch summaries
   */
  async processBatchesInParallel(batches, userPrompt, updateCallback) {
    if (!batches || batches.length === 0) {
      return [];
    }

    this.totalBatches = batches.length;
    this.progressCallback = updateCallback;
    this.completedResults.clear();
    this.activeBatches.clear();
    // Оновити concurrency при кожному запуску (ключі можуть змінитись)
    this.maxConcurrent = getOptimalConcurrency();

    logger.debug(
      `🚀 Starting parallel processing of ${this.totalBatches} batches (max ${this.maxConcurrent} concurrent, ${apiKeyManager.totalCount} API keys)`
    );

    const results = [];

    // For single batch, process directly without parallel overhead
    if (batches.length === 1) {
      const result = await this._processSingleBatch(batches[0], 1, this.totalBatches, userPrompt);
      return [result];
    }

    // Process batches with controlled concurrency
    await this._processAllBatches(batches, userPrompt);

    // Collect results in correct order
    for (let i = 0; i < this.totalBatches; i++) {
      const result = this.completedResults.get(i);
      if (result) {
        if (result.error) {
          throw new Error(`Batch ${i + 1} failed: ${result.error}`);
        }
        results.push(result.data);
      } else {
        throw new Error(`Missing result for batch ${i + 1}`);
      }
    }

    // Очищаємо Maps для звільнення памʼяті
    this.completedResults.clear();
    this.activeBatches.clear();

    logger.debug(`✅ Parallel processing completed: ${results.length} batches processed`);
    return results;
  }

  /**
   * Process all batches with controlled concurrency
   * @private
   */
  async _processAllBatches(batches, userPrompt) {
    const activePromises = [];
    let nextBatchIndex = 0;

    // Function to start a new batch if slot is available
    const startNextBatch = () => {
      if (nextBatchIndex < batches.length && activePromises.length < this.maxConcurrent) {
        const batchPromise = this._startBatchProcessing(
          batches[nextBatchIndex],
          nextBatchIndex,
          userPrompt
        ).then((result) => {
          // Remove this promise from active list when completed
          const index = activePromises.indexOf(batchPromise);
          if (index > -1) {
            activePromises.splice(index, 1);
          }
          return result;
        });

        activePromises.push(batchPromise);
        nextBatchIndex++;
        return true;
      }
      return false;
    };

    // Start initial batches
    while (startNextBatch()) {
      // Continue starting batches until we hit the limit or run out
    }

    // Process remaining batches as slots become available
    while (activePromises.length > 0 || nextBatchIndex < batches.length) {
      if (activePromises.length > 0) {
        // Wait for at least one task to complete
        await Promise.race(activePromises);

        // Try to start new batches in freed slots
        while (startNextBatch()) {
          // Continue starting batches
        }
      }
    }
  }

  /**
   * Start processing a single batch
   * @private
   */
  async _startBatchProcessing(batch, batchIndex, userPrompt) {
    const trackId = `batch_${batchIndex}`;
    const startTime = Date.now();

    // Резервуємо унікальний API ключ для цього batch
    const { keyIndex, release } = apiKeyManager.reserveKeyForBatch(trackId);

    this.activeBatches.set(trackId, {
      batchIndex,
      startTime,
      status: 'processing',
      reservedKeyIndex: keyIndex,
    });

    logger.debug(`🚀 Starting batch ${batchIndex + 1}/${this.totalBatches} with key #${keyIndex + 1}`);

    try {
      const result = await this._processSingleBatch(
        batch,
        batchIndex + 1,
        this.totalBatches,
        userPrompt,
        keyIndex // Передаємо зарезервований ключ
      );

      this.completedResults.set(batchIndex, { data: result, error: null });
      this.activeBatches.delete(trackId);
      release(); // Звільняємо ключ після успішного завершення

      const duration = Date.now() - startTime;
      logger.debug(`✅ Batch ${batchIndex + 1} completed in ${duration}ms (key #${keyIndex + 1} released)`);

      // Update progress only after completion
      this._updateProgressSummary();
    } catch (error) {
      console.error(`❌ Batch ${batchIndex + 1} failed:`, error.message);

      // Soft-fail policy: mark batch as empty data instead of fatal error if retries in lower layer exhausted
      this.completedResults.set(batchIndex, { data: ``, error: null });
      this.activeBatches.delete(trackId);
      release(); // Звільняємо ключ навіть при помилці

      this._updateProgressSummary();
    }

    return { batchIndex, completed: true };
  }

  /**
   * Process a single batch using existing getBatchSummary logic
   * @private
   * @param {Array} batchCases - Cases in this batch
   * @param {number} batchNumber - Batch number (1-indexed)
   * @param {number} totalBatches - Total batches count
   * @param {string} userPrompt - User's prompt
   * @param {number|null} reservedKeyIndex - Reserved API key index for this batch
   */
  async _processSingleBatch(batchCases, batchNumber, totalBatches, userPrompt, reservedKeyIndex = null) {
    // Add small delay to prevent overwhelming the API
    if (batchNumber > 1) {
      await sleep(200);
    }

    return await getBatchSummary(batchCases, batchNumber, totalBatches, userPrompt, reservedKeyIndex);
  }

  /**
   * Update progress with current status
   * @private
   */
  _updateProgress(message) {
    if (this.progressCallback) {
      this.progressCallback(message);
    }
  }

  /**
   * Update progress summary with current statistics
   * @private
   */
  _updateProgressSummary() {
    if (this.progressCallback) {
      const completedCount = this.completedResults.size;
      const activeCount = this.activeBatches.size;
      const remainingCount = this.totalBatches - completedCount;

      const message = `Завершено: ${completedCount}/${this.totalBatches}, активно: ${Math.min(activeCount, this.maxConcurrent)}, залишилось: ${remainingCount}`;
      this.progressCallback(message);
    }
  }

  /**
   * Get current processing statistics
   */
  getStats() {
    return {
      totalBatches: this.totalBatches,
      completed: this.completedResults.size,
      active: this.activeBatches.size,
      remaining: this.totalBatches - this.completedResults.size,
    };
  }
}

export default ParallelBatchProcessor;
