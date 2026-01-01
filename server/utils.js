import { PROMPT_TEMPLATES } from './prompts.js';
import { getPromptName } from './prompt-definitions.js';

/**
 * Utility functions for legal case analysis
 * Contains helper functions for data processing and metadata handling
 */

/**
 * Creates a rich, dynamic context string from case metadata.
 * This context is injected into the base prompt to inform the AI.
 * @param {Array} cases - Array of case objects with a 'metadata' property.
 * @returns {string} A formatted string containing the analytical context.
 */
function parseDecisionDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s) return null;

  // DD.MM.YYYY
  let match = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  match = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildMetadataContext(cases) {
  if (!cases || cases.length === 0) {
    return 'Метадані для аналізу відсутні.\n';
  }

  const metadata = {
    totalCases: cases.length,
    lawArticles: new Set(),
    caseTypes: new Set(),
    courts: new Set(),
    judges: new Set(),
    timeRange: {
      earliest: null,
      latest: null,
    },
  };

  cases.forEach((caseItem) => {
    if (!caseItem) return;

    const meta = caseItem.metadata || {};
    const lawArticles = meta.lawArticles || caseItem.lawArticles;
    const caseType = meta.caseType || caseItem.caseType;
    const court = meta.court || caseItem.court;
    const judge = meta.judge || caseItem.judge;
    const decisionDate =
      meta.decisionDate || caseItem.decisionDate || caseItem.date || caseItem.decision_date;

    if (lawArticles) {
      const list = Array.isArray(lawArticles) ? lawArticles : [lawArticles];
      list.forEach((article) => metadata.lawArticles.add(article));
    }
    if (caseType) metadata.caseTypes.add(caseType);
    if (court) metadata.courts.add(court);
    if (judge) metadata.judges.add(judge);

    const parsedDate = parseDecisionDate(decisionDate);
    if (parsedDate) {
      if (!metadata.timeRange.earliest || parsedDate < metadata.timeRange.earliest)
        metadata.timeRange.earliest = parsedDate;
      if (!metadata.timeRange.latest || parsedDate > metadata.timeRange.latest)
        metadata.timeRange.latest = parsedDate;
    }
  });

  const formatDate = (date) => (date ? date.toLocaleDateString('uk-UA') : 'N/A');
  const earliestDate = formatDate(metadata.timeRange.earliest);
  const latestDate = formatDate(metadata.timeRange.latest);

  const context = `
| Ключовий параметр | Значення |
| :--- | :--- |
| **Дата аналізу** | ${new Date().toLocaleDateString('uk-UA')} |
| **Кількість справ** | ${metadata.totalCases} |
| **Період рішень** | Від ${earliestDate} до ${latestDate} |
| **Основні суди** | ${[...metadata.courts].slice(0, 3).join(', ') || 'Не вказано'} |
| **Основні статті** | ${[...metadata.lawArticles].slice(0, 3).join(', ') || 'Не вказано'} |
`;
  return context;
}

/**
 * Assembles the final, complete prompt for the AI by combining the base
 * prompt, dynamic context, and the specific task instructions.
 * @param {Array} cases - The array of case objects.
 * @param {string} userPromptKey - The key for the desired task prompt.
 * @param {string} corpus - The combined text of all case bodies.
 * @returns {string} The fully constructed prompt ready for the AI.
 */
export function createAnalysisPrompt(cases, userPromptKey, corpus) {
  const reportTitle = getPromptName(userPromptKey).toUpperCase();
  const metadataTable = buildMetadataContext(cases);

  // --- Special handler for "Detailed Annotation" prompt ---
  if (userPromptKey === 'detailed_annotation') {
    const annotationTask = PROMPT_TEMPLATES.detailed_annotation;
    const finalPrompt = `
${annotationTask}

# МАТЕРІАЛИ ДЛЯ АНАЛІЗУ:
Нижче наведено стислі вижимки з судових рішень. Твоя задача - для КОЖНОЇ справи з цих матеріалів створити окрему, детально структуровану анотацію згідно з наданою вище структурою. Розділяй анотації для кожної справи трьома дефісами (---).

${corpus}
`;
    return finalPrompt;
  }

  // --- Default handler for all other summary prompts ---
  const base = PROMPT_TEMPLATES.base_prompt;

  let task;
  if (userPromptKey && PROMPT_TEMPLATES[userPromptKey]) {
    task = PROMPT_TEMPLATES[userPromptKey];
  } else if (userPromptKey) {
    // For custom prompts, we don't have a template, so the task is the prompt itself.
    // Add a specific reminder to format links correctly.
    task = `
**ВАШЕ ІНДИВІДУАЛЬНЕ ЗАВДАННЯ:**
${userPromptKey}

**ПРАВИЛА ДЛЯ ВІДПОВІДІ:**
- Дай максимально якісний, глибокий і доказовий аналіз саме того, що просить користувач.
- Не перераховуй усі справи, якщо вони не релевантні до запиту.
- Якщо користувач просить аналіз лише певних справ або критеріїв — включай тільки ті, що відповідають, і вкажи, за яким критерієм відсікались інші.
- Усі ключові твердження підтверджуй посиланнями на релевантні справи.
- Якщо даних недостатньо — прямо зазнач це.

**НАГАДУВАННЯ:** Не забувайте форматувати посилання на справи у форматі Markdown: "[Справа №...](URL)".`;
  } else {
    // Default to practice_overview if no key is provided
    task = PROMPT_TEMPLATES.practice_overview;
  }

  let finalPrompt = base.replace('{{analytical_context}}', `## ${reportTitle}\n${metadataTable}`);
  finalPrompt += `\n**ВАЖЛИВА ВКАЗІВКА:** Твій аналіз має охоплювати **${cases.length}** справ. Усі статистичні дані та висновки мають базуватися на цій загальній кількості.`;
  finalPrompt += task;
  finalPrompt += `\n\n# **МАТЕРІАЛИ ДЛЯ АНАЛІЗУ**\n\n${corpus}`;

  // Replace placeholders in statistical analysis
  if (userPromptKey === 'statistical_analysis') {
    finalPrompt = finalPrompt.replace('{{totalCases}}', cases.length.toString());
  }

  return finalPrompt;
}

/**
 * Split array into chunks of specified size
 * @param {Array} array - Array to split
 * @param {number} size - Chunk size
 * @returns {Array} - Array of chunks
 */
export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Creates batches of cases that respect both size and token limits.
 * @param {Array} cases - The full array of case objects.
 * @param {number} maxCasesPerBatch - The maximum number of cases in a batch.
 * @param {number} maxTokensPerBatch - The maximum estimated tokens per batch.
 * @returns {Array<Array>} An array of case batches.
 */
export function createTokenAwareBatches(cases, maxCasesPerBatch, maxTokensPerBatch) {
  const batches = [];
  if (!cases || cases.length === 0) {
    return batches;
  }

  let currentBatch = [];
  let currentBatchTokens = 0;

  for (const caseItem of cases) {
    // Estimate token count (a common approximation is 4 chars/token)
    const caseTokens = Math.ceil((caseItem.body || '').length / 4);

    // If the current case is larger than the batch limit, handle it as a single-item batch.
    if (caseTokens > maxTokensPerBatch) {
      // If there's a pending batch, push it first.
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      // Push the oversized item as its own batch.
      batches.push([caseItem]);
      // Reset for the next iteration.
      currentBatch = [];
      currentBatchTokens = 0;
      continue;
    }

    // Check if adding the new case would exceed limits
    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= maxCasesPerBatch ||
        currentBatchTokens + caseTokens > maxTokensPerBatch)
    ) {
      // Finalize the current batch and start a new one
      batches.push(currentBatch);
      currentBatch = [caseItem];
      currentBatchTokens = caseTokens;
    } else {
      // Add the case to the current batch
      currentBatch.push(caseItem);
      currentBatchTokens += caseTokens;
    }
  }

  // Add the last remaining batch if it's not empty
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after delay
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates the optimal batch size based on the number of cases
 * @param {number} totalCases - Total number of cases
 * @returns {number} - Optimal batch size
 */
export function calculateOptimalBatchSize(totalCases) {
  const BATCH_SIZE =
    parseInt(process.env.AI_BATCH_SIZE, 10) ||
    parseInt(process.env.BATCH_SIZE, 10) ||
    10;

  if (totalCases <= BATCH_SIZE) {
    return totalCases; // Process all in one batch if under or equal to the desired size
  }

  return BATCH_SIZE;
}

// testGeminiConnection moved to gemini.js to avoid duplication

/**
 * Extracts key aspects from a user's custom prompt to focus the analysis.
 * @param {string} userPrompt - The custom prompt provided by the user.
 * @returns {Promise<string>} A string containing comma-separated keywords, or an empty string.
 */
/*
export async function extractKeywordsFromPrompt(userPrompt) {
  if (!userPrompt || userPrompt.trim().length < 10) {
    return '';
  }

  const { generateContent } = await import('./batchProcessor.js');

  const keywordExtractionPrompt = `Проаналізуй наступний запит користувача. Виділи 3-5 ключових аспектів, юридичних термінів або питань, на які потрібно звернути увагу при аналізі судових документів. У відповідь дай лише список цих аспектів через кому. Не додавай жодних пояснень чи форматування.

ЗАПИТ: "${userPrompt}"`;

  try {
    const keywords = await generateContent(keywordExtractionPrompt);
    console.log(`🔍 Виділені ключові аспекти з промпту: ${keywords}`);
    return keywords.trim();
  } catch (error) {
    console.error(`Помилка при виділенні ключових слів з промпту: ${error.message}`);
    return ''; // Return empty string on error to not break the main flow
  }
}
*/

class Logger {
  constructor() {
    const logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };
    const configuredLevel = process.env.LOG_LEVEL || 'info';
    this.logLevel = logLevels[configuredLevel.toLowerCase()] ?? logLevels.info;
  }

  /**
   * Logs an info message if the configured log level is 'info' or 'debug'.
   * @param {...any} args - Arguments to log.
   */
  info(...args) {
    if (this.logLevel >= 2) {
      console.log('[INFO]', ...args);
    }
  }

  /**
   * Logs a standard message (alias for info).
   * @param {...any} args - Arguments to log.
   */
  log(...args) {
    this.info(...args);
  }

  /**
   * Logs a warning message if the configured log level is 'warn', 'info', or 'debug'.
   * @param {...any} args - Arguments to log as a warning.
   */
  warn(...args) {
    if (this.logLevel >= 1) {
      console.warn('[WARN]', ...args);
    }
  }

  /**
   * Always logs an error message.
   * @param {...any} args - Arguments to log as an error.
   */
  error(...args) {
    if (this.logLevel >= 0) {
      console.error('[ERROR]', ...args);
    }
  }

  /**
   * Logs a debug message only if the configured log level is 'debug'.
   * @param {...any} args - Arguments to log as a debug message.
   */
  debug(...args) {
    if (this.logLevel >= 3) {
      console.log('[DEBUG]', ...args);
    }
  }
}

export const logger = new Logger();

// Strict EDRSR URL validation
export function isValidEDRSRUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.hostname !== 'reyestr.court.gov.ua') return false;
    return /^\/Review\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Best-effort client IP extraction supporting common proxy headers.
 * Falls back to Express/Node addresses when headers are absent.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function getClientIp(req) {
  try {
    const headers = req?.headers || {};
    const xff = headers['x-forwarded-for'];
    // x-forwarded-for may contain a comma-separated list; take the first public IP
    let ip = Array.isArray(xff)
      ? xff[0]
      : typeof xff === 'string'
        ? xff.split(',')[0].trim()
        : null;

    ip =
      ip ||
      headers['x-real-ip'] ||
      headers['cf-connecting-ip'] ||
      headers['true-client-ip'] ||
      headers['x-client-ip'] ||
      headers['fastly-client-ip'] ||
      headers['x-cluster-client-ip'] ||
      req?.ip ||
      req?.connection?.remoteAddress ||
      req?.socket?.remoteAddress ||
      req?.connection?.socket?.remoteAddress ||
      null;

    if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    return typeof ip === 'string' ? ip : null;
  } catch {
    return null;
  }
}
