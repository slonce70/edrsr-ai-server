/**
 * Batch processing functions for legal case analysis
 * Handles batch analysis, progressive analysis, and final comprehensive analysis
 */

import {
  apiKeyManager,
  modelName,
  FALLBACK_MODEL_NAME,
  GENERATION_CONFIG,
  SAFETY_SETTINGS,
} from './config.js';
import { PROMPT_TEMPLATES } from './prompts.js';
import { createAnalysisPrompt, logger } from './utils.js';

// MAX_RETRIES should be at least totalKeys * 2 to try all keys with retries
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10) || 15;
const INITIAL_RETRY_DELAY_MS = 20000; // 20 seconds
const RATE_LIMIT_COOLDOWN_MS = 60000; // 60 seconds cooldown for rate-limited keys

/**
 * Generate content using Gemini AI with retry, fallback, and API key rotation.
 * @param {string} prompt - The prompt to send to Gemini
 * @param {number|null} reservedKeyIndex - Опціональний індекс зарезервованого ключа для batch
 * @returns {string} - Generated content
 */
async function generateContent(prompt, reservedKeyIndex = null) {
  let attempt = 0;
  let keysFullyTried = new Set(); // Ключі де обидві моделі не спрацювали

  while (attempt < MAX_RETRIES) {
    attempt++;

    // Використати зарезервований ключ або взяти наступний доступний
    const { client, keyIndex } = reservedKeyIndex !== null
      ? apiKeyManager.getClientByIndex(reservedKeyIndex)
      : apiKeyManager.getNextClient();

    // Спробувати спочатку основну модель, потім fallback
    const modelsToTry = [modelName];
    if (FALLBACK_MODEL_NAME && FALLBACK_MODEL_NAME !== modelName) {
      modelsToTry.push(FALLBACK_MODEL_NAME);
    }

    for (const currentModel of modelsToTry) {
      logger.info(
        `🚀 Gemini (Спроба ${attempt}/${MAX_RETRIES}, Ключ #${keyIndex + 1}/${apiKeyManager.totalCount}, Модель: ${currentModel})`
      );

      const model = client.getGenerativeModel({
        model: currentModel,
        generationConfig: GENERATION_CONFIG,
        safetySettings: SAFETY_SETTINGS,
      });

      try {
        const result = await model.generateContent(prompt);
        const text = result?.response?.text?.();

        if (!text?.trim()) {
          throw new Error('Gemini повернув порожню відповідь.');
        }
        return text.trim(); // Успіх!
      } catch (error) {
        const message = String(error.message || '');
        const statusCode = error.status || error.statusCode || (message.match(/\b(\d{3})\b/)?.[1]);

        // Детальне логування помилки
        logger.warn(`❌ [GEMINI] Ключ #${keyIndex + 1}, ${currentModel}: ${message.slice(0, 200)}`);
        if (statusCode) {
          logger.warn(`   HTTP Status: ${statusCode}`);
        }

        const isQuotaError = message.includes('429') || message.includes('RESOURCE_EXHAUSTED');
        const isOverloadError = message.includes('503') || message.includes('overloaded');
        const isInvalidKey =
          message.includes('400') ||
          message.includes('401') ||
          message.includes('API_KEY_INVALID') ||
          message.includes('INVALID_ARGUMENT');

        apiKeyManager.markError(keyIndex);

        // Невалідний ключ - позначаємо як ПЕРМАНЕНТНО невалідний
        if (isInvalidKey) {
          logger.error(`🚫 [GEMINI] Ключ #${keyIndex + 1} НЕВАЛІДНИЙ! Перевірте ключ в Google AI Studio.`);
          apiKeyManager.markInvalid(keyIndex); // Permanent ban замість cooldown
          keysFullyTried.add(keyIndex);
          break;
        }

        if (isQuotaError || isOverloadError) {
          // Спробувати fallback модель на цьому ж ключі
          if (currentModel === modelName && modelsToTry.length > 1) {
            logger.info(`⚠️ ${currentModel} rate limited, пробую fallback модель...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue; // Спробувати наступну модель
          }

          // Обидві моделі не спрацювали на цьому ключі
          // Використовуємо адаптивний cooldown на основі моделі
          apiKeyManager.markRateLimited(keyIndex, null, currentModel);
          keysFullyTried.add(keyIndex);
          logger.info(`⚠️ Ключ #${keyIndex + 1} повністю rate limited, пробую інший ключ...`);
          break; // Вийти з циклу моделей, спробувати інший ключ
        }

        // Інші помилки
        const isNetworkError =
          message.includes('fetch failed') || message.includes('ENET') || message.includes('ECONN');
        const isInternalError = message.includes('500');

        if ((isNetworkError || isInternalError) && attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          logger.info(`[RETRY] Помилка, повтор через ${Math.round(delay / 1000)} сек...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          break;
        }

        throw error;
      }
    }

    // Якщо всі ключі вичерпані
    if (keysFullyTried.size >= apiKeyManager.totalCount) {
      logger.warn(`⚠️ Всі ${apiKeyManager.totalCount} ключів rate limited, чекаю 60 сек...`);
      keysFullyTried.clear();
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }

  throw new Error('Вичерпано всі спроби запиту до Gemini');
}

/**
 * Analyze a single batch of cases to get a summary.
 * This is the first step in the optimized pipeline.
 * @param {Array} batchCases - A small group of cases.
 * @param {number} batchNumber - The current batch number for logging.
 * @param {number} totalBatches - The total number of batches.
 * @param {string} finalUserPrompt - The user's ultimate analysis goal.
 * @param {number|null} reservedKeyIndex - Опціональний індекс зарезервованого ключа для batch.
 * @returns {string} A concise, focused summary of the batch.
 */
async function getBatchSummary(batchCases, batchNumber, totalBatches, finalUserPrompt = null, reservedKeyIndex = null) {
  logger.info(
    `📦 Summarizing batch ${batchNumber}/${totalBatches} (${batchCases.length} cases) for task: ${finalUserPrompt || 'default'}`
  );

  const corpus = batchCases
    .map(
      (c) =>
        `--- Справа №${c.caseNumber || c.id} (Дата: ${c.decisionDate || 'не вказано'}) ---\nURL: ${c.url}\n${c.body}`
    )
    .join('\n\n');

  // Default to a simple factual summary if no specific prompt is provided.
  if (!finalUserPrompt) {
    const prompt = `${PROMPT_TEMPLATES.batch_summary.replace('{{focus_block}}', '')}\n\n${corpus}`;
    return generateContent(prompt, reservedKeyIndex);
  }

  // Custom user prompt that is not part of predefined templates.
  if (!PROMPT_TEMPLATES[finalUserPrompt]) {
    const prompt = `
# КОНТЕКСТ:
Ти допомагаєш юристу виконати індивідуальний запит. Потрібна детальна попередня вижимка по кожній справі, що повністю відповідає користувацьким інструкціям.

# КОРИСТУВАЦЬКА ІНСТРУКЦІЯ (НЕ СКОРОЧУЙ):
"""
${finalUserPrompt}
"""

# ОБОВ'ЯЗКОВІ ПРАВИЛА:
${PROMPT_TEMPLATES.batch_summary}
- Не опускай жодного релевантного факту, аргументу чи висновку, які можуть вплинути на виконання інструкції вище.
- Для кожної справи чітко вкажи усі моменти, які можуть бути критично важливими для відповіді на користувацький запит.

# МАТЕРІАЛИ ДЛЯ АНАЛІЗУ:
${corpus}
`;

    return generateContent(prompt, reservedKeyIndex);
  }

  // For all other prompts from the template set, construct a focused summary request.
  const taskPrompt = PROMPT_TEMPLATES[finalUserPrompt];
  const prompt = `
# КОНТЕКСТ:
Ти - частина великого аналітичного процесу. Твоя задача - зробити попередню вижимку з групи судових рішень, яка допоможе на фінальному етапі дати відповідь на головний запит.

# ГОЛОВНЕ ЗАВДАННЯ АНАЛІЗУ:
"""
${taskPrompt}
"""

# ТВОЯ ПОТОЧНА ДІЯ:
Проаналізуй кожну справу в наданих нижче матеріалах. Для кожної справи витягни **всю інформацію, факти, аргументи та висновки суду, які є критично важливими** для відповіді на вищевказане "ГОЛОВНЕ ЗАВДАННЯ АНАЛІЗУ". Твоя вижимка має бути детальною та повною в контексті цього завдання. Не роби загальних висновків по групі справ, лише вижимки по кожній окремій справі.

# МАТЕРІАЛИ:
${corpus}
`;

  try {
    const summary = await generateContent(prompt, reservedKeyIndex);
    logger.info(`✅ Summary for batch ${batchNumber} received: ${summary.length} chars`);
    return summary;
  } catch (err) {
    console.error(`❌ Error summarizing batch ${batchNumber}: ${err.message}`);
    // Re-throw the error to ensure the job stops if a batch fails permanently.
    throw err;
  }
}

/**
 * Create the final, comprehensive analysis from all batch summaries in a single AI call.
 * @param {Array} cases - The full array of case objects for metadata context.
 * @param {Array} allSummaries - An array of batch summaries.
 * @param {string|null} userPromptKey - The key for the selected prompt or the custom prompt text.
 * @returns {string} The final, comprehensive analysis report.
 */
async function createFinalAnalysis(cases, allSummaries, userPromptKey) {
  logger.info(
    `🎯 Creating final analysis for ${cases.length} cases (Task: ${userPromptKey || 'default'})...`
  );

  const corpus =
    allSummaries.length > 0
      ? allSummaries
          .map((summary, index) => `--- ЗВЕДЕННЯ ГРУПИ ${index + 1} ---\n${summary}`)
          .join('\n\n')
      : cases
          .map(
            (c) =>
              `--- Справа №${c.caseNumber || c.id} (Дата: ${c.decisionDate || 'не вказано'}) ---\nURL: ${c.url}\n${c.body}`
          )
          .join('\n\n');

  const finalPrompt = createAnalysisPrompt(cases, userPromptKey, corpus);

  try {
    const finalReport = await generateContent(finalPrompt);
    logger.info(`✅ Final analysis created: ${finalReport.length} chars`);
    return finalReport;
  } catch (err) {
    console.error(`❌ Error in final analysis:`, err);
    // Re-throw the error to ensure the job stops if the final analysis fails.
    throw err;
  }
}

export { generateContent, getBatchSummary, createFinalAnalysis };
