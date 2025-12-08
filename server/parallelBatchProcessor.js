/**
 * Parallel batch processor for legal case analysis
 * Handles up to 3 concurrent batch processing while maintaining order and error handling
 */

import { getBatchSummary } from './batchProcessor.js';
import { sleep } from './utils.js';
import { logger } from './utils.js';

// Зменшено з 3 до 2 для оптимізації памʼяті (3 batch × 1-2MB = 6MB одночасно)
const MAX_CONCURRENT_BATCHES = parseInt(process.env.MAX_CONCURRENT_BATCHES, 10) || 2;

/**
 * Class for managing parallel batch processing with order preservation
 */
export class ParallelBatchProcessor {
  constructor() {
    this.activeBatches = new Map(); // trackId -> { batchIndex, promise, startTime }
    this.completedResults = new Map(); // batchIndex -> result
    this.progressCallback = null;
    this.totalBatches = 0;
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

    logger.debug(
      `🚀 Starting parallel processing of ${this.totalBatches} batches (max ${MAX_CONCURRENT_BATCHES} concurrent)`
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
      if (nextBatchIndex < batches.length && activePromises.length < MAX_CONCURRENT_BATCHES) {
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

    this.activeBatches.set(trackId, {
      batchIndex,
      startTime,
      status: 'processing',
    });

    logger.debug(`🚀 Starting batch ${batchIndex + 1}/${this.totalBatches}`);

    try {
      const result = await this._processSingleBatch(
        batch,
        batchIndex + 1,
        this.totalBatches,
        userPrompt
      );

      this.completedResults.set(batchIndex, { data: result, error: null });
      this.activeBatches.delete(trackId);

      const duration = Date.now() - startTime;
      logger.debug(`✅ Batch ${batchIndex + 1} completed in ${duration}ms`);

      // Update progress only after completion
      this._updateProgressSummary();
    } catch (error) {
      console.error(`❌ Batch ${batchIndex + 1} failed:`, error.message);

      // Soft-fail policy: mark batch as empty data instead of fatal error if retries in lower layer exhausted
      this.completedResults.set(batchIndex, { data: ``, error: null });
      this.activeBatches.delete(trackId);

      this._updateProgressSummary();
    }

    return { batchIndex, completed: true };
  }

  /**
   * Process a single batch using existing getBatchSummary logic
   * @private
   */
  async _processSingleBatch(batchCases, batchNumber, totalBatches, userPrompt) {
    // Add small delay to prevent overwhelming the API
    if (batchNumber > 1) {
      await sleep(200);
    }

    return await getBatchSummary(batchCases, batchNumber, totalBatches, userPrompt);
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

      const message = `Завершено: ${completedCount}/${this.totalBatches}, активно: ${Math.min(activeCount, MAX_CONCURRENT_BATCHES)}, остается: ${remainingCount}`;
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
