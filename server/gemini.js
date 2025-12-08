/**
 * AI module for the legal‑assistant browser extension.
 * Performs large‑scale court‑case analysis and answers follow‑up questions.
 * Drop‑in replacement for the previous implementation – same public API.
 *
 * Author: Refactored by ChatGPT (2025‑07‑02)
 * Modularized: Extracted prompts, config, utils, batch processing, and quality control
 */

/* -------------------------------------------------------------------------- */
/*  Imports                                                                    */
/* -------------------------------------------------------------------------- */

import { createTokenAwareBatches, sleep, logger } from './utils.js';
import { getBatchSummary, createFinalAnalysis } from './batchProcessor.js';
import { validateBatchProcessing, generateQualityReport } from './qualityControl.js';
import { OPTIMAL_BATCH_SIZE, MAX_TOKENS_PER_BATCH, apiKeyManager, modelName } from './config.js';
import { ParallelBatchProcessor } from './parallelBatchProcessor.js';

/* -------------------------------------------------------------------------- */
/*  Core Analysis Functions                                                    */
/* -------------------------------------------------------------------------- */

// All core functions have been modularized into separate files:
// - prompts.js: All prompt templates
// - config.js: API configuration and settings
// - utils.js: Helper functions and utilities
// - batchProcessor.js: Batch processing and analysis functions
// - qualityControl.js: Quality control and validation functions

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Main analysis function that orchestrates the entire case analysis process
 * @param {Array} cases - Array of case objects to analyze
 * @param {string} userPrompt - User-provided analysis prompt
 * @param {Function} [updateStatusCallback=() => {}] - Optional callback to update status.
 * @returns {string} - Final comprehensive analysis
 */
async function analyzeCases(cases, userPrompt = null, updateStatusCallback = () => {}) {
  logger.info(`🚀 Початок аналізу ${cases.length} справ`);

  const validCases = cases.filter((c) => c.body && c.body.length > 100);
  logger.info(`✅ Валідних справ: ${validCases.length} з ${cases.length}`);

  if (validCases.length === 0) {
    throw new Error('Немає валідних справ для аналізу');
  }

  const batches = createTokenAwareBatches(validCases, OPTIMAL_BATCH_SIZE, MAX_TOKENS_PER_BATCH);
  const totalBatches = batches.length;
  logger.info(`📊 Розподіл: ${validCases.length} справ → ${totalBatches} груп(и)`);

  let allBatchSummaries = [];
  let finalAnalysis;

  // Initialize parallel batch processor
  const processor = new ParallelBatchProcessor();

  // --- Special handling for "Detailed Annotation" to avoid redundant final call ---
  if (userPrompt === 'detailed_annotation') {
    logger.info(
      '⚡️ Оптимізований режим для "Детальна анотація". Фінальний запит до AI буде пропущено.'
    );
    updateStatusCallback('Запуск паралельної обробки для детальної анотації...');

    // Use parallel processing for detailed annotation
    allBatchSummaries = await processor.processBatchesInParallel(batches, userPrompt, (message) =>
      updateStatusCallback(`Детальна анотація: ${message}`)
    );

    // Simply combine the results from each batch.
    finalAnalysis = allBatchSummaries.join('\n\n---\n\n');
  } else if (totalBatches > 1) {
    updateStatusCallback('Запуск паралельної обробки батчей...');

    // Use parallel processing for multiple batches
    allBatchSummaries = await processor.processBatchesInParallel(batches, userPrompt, (message) =>
      updateStatusCallback(`Паралельна обробка: ${message}`)
    );

    await sleep(1000); // Add a 1-second delay to ensure the final status update is sent

    updateStatusCallback('Усі групи оброблено. Створення фінального звіту...');
    finalAnalysis = await createFinalAnalysis(validCases, allBatchSummaries, userPrompt);
  } else {
    // Direct analysis for a single batch, no summaries needed, but we pass keywords
    updateStatusCallback('Надсилання єдиної групи на аналіз...');
    finalAnalysis = await createFinalAnalysis(validCases, [], userPrompt);
  }

  const validation = validateBatchProcessing(validCases, allBatchSummaries, totalBatches);
  const qualityReport = generateQualityReport(validation, validCases.length, allBatchSummaries);

  const result = finalAnalysis + qualityReport;
  logger.info(`✅ Аналіз завершено: ${result.length} символів`);
  return result;
}

/**
 * Відповідає на запитання в чаті, використовуючи сесію для збереження контексту.
 * @param {string} jobId - ID завдання для сесії.
 * @param {string} analysisText – Готовий звіт.
 * @param {Array} history – Історія діалогу (використовується тільки для ініціалізації).
 * @param {string} question – Нове питання користувача.
 * @param {Map} chatSessions - Map для зберігання активних сесій.
 */
async function answerChatQuestion(jobId, analysisText, history, question, chatSessions) {
  let chat;

  if (chatSessions.has(jobId)) {
    chat = chatSessions.get(jobId).chat;
  } else {
    // Отримуємо клієнт з ротацією для нової сесії
    const { client, keyIndex } = apiKeyManager.getNextClient();
    logger.info(`[Chat] Нова сесія ${jobId} використовує API ключ #${keyIndex + 1}`);
    // Створюємо нову сесію з початковим контекстом (звітом)
    const initialHistory = [
      {
        role: 'user',
        parts: [
          {
            text: `Ти – юридичний AI-асистент. Твоє завдання – відповідати на запитання виключно на основі наданого аналітичного звіту. Не використовуй жодних інших знань. Відповідай лаконічно, по суті, українською мовою.\n\n# АНАЛІТИЧНИЙ ЗВІТ:\n\n${analysisText}`,
          },
        ],
      },
      {
        role: 'model',
        parts: [{ text: 'Звіт завантажено. Я готовий відповідати на ваші запитання.' }],
      },
    ];
    // Новий SDK: використовуємо client.chats.create() замість model.startChat()
    chat = client.chats.create({ model: modelName, history: initialHistory });
    chatSessions.set(jobId, { chat, keyIndex });
  }

  try {
    // Новий SDK: sendMessage приймає об'єкт { message: ... }
    const response = await chat.sendMessage({ message: question });
    return response.text;
  } catch (err) {
    console.error(`[Chat Error for Job ${jobId}]`, err);
    // Спроба відновити сесію у випадку помилки
    chatSessions.delete(jobId);
    throw new Error(`Помилка відповіді в чаті: ${err.message}`);
  }
}

/**
 * Перевірка зʼєднання з Gemini – корисно для health‑чеків.
 * Використовує ротацію ключів для перевірки доступності.
 */
async function testGeminiConnection() {
  try {
    const { client, keyIndex } = apiKeyManager.getNextClient();
    // Новий SDK: використовуємо client.models.generateContent()
    await client.models.generateContent({
      model: modelName,
      contents: 'ping',
    });
    logger.info(`[Health] Gemini OK (ключ #${keyIndex + 1})`);
    return true;
  } catch (error) {
    console.error('Помилка перевірки зʼєднання з Gemini:', error);
    return false;
  }
}

export { analyzeCases, answerChatQuestion, testGeminiConnection };
