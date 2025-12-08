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

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 20000; // 20 seconds
const RATE_LIMIT_COOLDOWN_MS = 60000; // 60 seconds cooldown for rate-limited keys

/**
 * Generate content using Gemini AI with retry, fallback, and API key rotation.
 * @param {string} prompt - The prompt to send to Gemini
 * @returns {string} - Generated content
 */
async function generateContent(prompt) {
  let currentModelName = modelName;
  let lastKeyIndex = -1;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Отримати наступний доступний API ключ (round-robin)
    const { client, keyIndex } = apiKeyManager.getNextClient();
    lastKeyIndex = keyIndex;

    logger.info(
      `🚀 Відправка запиту до Gemini (Спроба ${attempt}/${MAX_RETRIES}, ` +
        `Модель: ${currentModelName}, Ключ: #${keyIndex + 1}/${apiKeyManager.totalCount})...`
    );
    logger.info(`📏 Промпт: ~${(prompt.length / 4).toFixed(0)} токенів.`);

    const model = client.getGenerativeModel({
      model: currentModelName,
      generationConfig: GENERATION_CONFIG,
      safetySettings: SAFETY_SETTINGS,
    });

    try {
      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.();

      if (!text?.trim()) {
        throw new Error('Gemini повернув порожню відповідь.');
      }
      return text.trim();
    } catch (error) {
      console.error(
        `❌ Помилка виклику Gemini (Спроба ${attempt}/${MAX_RETRIES}, ` +
          `Модель: ${currentModelName}, Ключ: #${keyIndex + 1}): ${error.message}`
      );

      const message = String(error.message || '');
      const isOverloadError = message.includes('503');
      const isQuotaError = message.includes('429');
      const isInternalError = message.includes('500');
      const isNetworkError =
        message.includes('fetch failed') || message.includes('ENET') || message.includes('ECONN');
      const isEmptyResponse =
        message.includes('порожню відповідь') || message.toLowerCase().includes('empty');

      // Позначити помилку в статистиці
      apiKeyManager.markError(keyIndex);

      if (
        (isOverloadError || isQuotaError || isInternalError || isNetworkError || isEmptyResponse) &&
        attempt < MAX_RETRIES
      ) {
        // Rate limit (429) - позначити ключ на cooldown і спробувати інший
        if (isQuotaError) {
          apiKeyManager.markRateLimited(keyIndex, RATE_LIMIT_COOLDOWN_MS);

          // Якщо є інші доступні ключі - спробувати негайно
          if (apiKeyManager.availableCount > 0) {
            logger.info(
              `[KEY ROTATION] Ключ #${keyIndex + 1} rate limited, переключаюсь на інший...`
            );
            continue;
          }
        }

        // Fallback logic (only for overload/quota)
        if (
          FALLBACK_MODEL_NAME &&
          currentModelName !== FALLBACK_MODEL_NAME &&
          (isOverloadError || isQuotaError)
        ) {
          logger.info(
            `[FALLBACK] Основна модель перевантажена. Переключення на резервну модель: ${FALLBACK_MODEL_NAME}`
          );
          currentModelName = FALLBACK_MODEL_NAME;
          continue;
        }

        // Retry with exponential backoff
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // 20s, 40s, 80s, ...
        const reason =
          (isOverloadError && 'перевантаження (503)') ||
          (isQuotaError && 'квота (429)') ||
          (isInternalError && 'внутрішня помилка (500)') ||
          (isNetworkError && 'мережева помилка') ||
          (isEmptyResponse && 'порожня відповідь');
        console.log(
          `[RETRY] Причина: ${reason}. Повторна спроба через ${Math.round(delay / 1000)} секунд...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // For other errors or if retries are exhausted, re-throw the error
        throw error;
      }
    }
  }
}

/**
 * Analyze a single batch of cases to get a summary.
 * This is the first step in the optimized pipeline.
 * @param {Array} batchCases - A small group of cases.
 * @param {number} batchNumber - The current batch number for logging.
 * @param {number} totalBatches - The total number of batches.
 * @param {string} finalUserPrompt - The user's ultimate analysis goal.
 * @returns {string} A concise, focused summary of the batch.
 */
async function getBatchSummary(batchCases, batchNumber, totalBatches, finalUserPrompt = null) {
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
    return generateContent(prompt);
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

    return generateContent(prompt);
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
    const summary = await generateContent(prompt);
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
