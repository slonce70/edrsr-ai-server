/**
 * Configuration for Gemini AI service
 * Contains API settings, model configuration, safety settings,
 * and API key rotation manager for increased rate limits
 */

import dotenv from 'dotenv';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';

// Load environment variables first
dotenv.config({ override: true });

// --- API Key Manager для ротації кількох ключів ---

/**
 * Клас для керування кількома Gemini API ключами з round-robin ротацією.
 * Автоматично пропускає ключі, що досягли rate limit.
 */
class ApiKeyManager {
  /**
   * @param {string[]} keys - Масив API ключів
   */
  constructor(keys) {
    if (!keys || keys.length === 0) {
      throw new Error('❌ Не знайдено жодного Gemini API ключа!');
    }

    this.keys = keys;
    this.clients = keys.map((key) => new GoogleGenAI({ apiKey: key }));
    this.currentIndex = 0;
    this.cooldowns = new Map(); // keyIndex → cooldown until timestamp
    this.softBans = new Map(); // keyIndex → soft-ban until timestamp (after consecutive 429)
    this.consecutive429 = new Map(); // keyIndex → count of consecutive 429s
    this.invalidKeys = new Set(); // keyIndex → permanently invalid keys (400/401 errors)
    this.usageStats = keys.map(() => ({ requests: 0, errors: 0, rateLimits: 0, invalid: false }));
    this.reservedKeys = new Map(); // batchId → keyIndex (для паралельної обробки)
    this.activeRequests = new Map(); // keyIndex → count (активні запити на ключі)

    console.log(`✅ [API KEY MANAGER] Ініціалізовано ${keys.length} API ключ(ів)`);
  }

  /**
   * Отримати наступний доступний клієнт (round-robin з пропуском cooldown)
   * @returns {{ client: GoogleGenAI, keyIndex: number }}
   */
  getNextClient() {
    const startIndex = this.currentIndex;
    const now = Date.now();

    // Спробувати знайти ключ, що не на cooldown і не invalid
    do {
      // Пропустити invalid ключі
      if (this.invalidKeys.has(this.currentIndex)) {
        this.currentIndex = (this.currentIndex + 1) % this.clients.length;
        continue;
      }

      const cooldownUntil = this.cooldowns.get(this.currentIndex);
      const softBanUntil = this.softBans.get(this.currentIndex);

      const isCooldownActive = cooldownUntil && now < cooldownUntil;
      const isSoftBanActive = softBanUntil && now < softBanUntil;

      if (!isCooldownActive && !isSoftBanActive) {
        // Ключ доступний
        if (cooldownUntil && now > cooldownUntil) this.cooldowns.delete(this.currentIndex);
        if (softBanUntil && now > softBanUntil) this.softBans.delete(this.currentIndex);

        const keyIndex = this.currentIndex;
        const client = this.clients[keyIndex];

        // Перейти до наступного для наступного виклику
        this.currentIndex = (this.currentIndex + 1) % this.clients.length;

        // Оновити статистику
        this.usageStats[keyIndex].requests++;

        if (this.clients.length > 1) {
          console.log(
            `[GEMINI] Використовую ключ #${keyIndex + 1}/${this.clients.length} ` +
              `(запитів: ${this.usageStats[keyIndex].requests})`
          );
        }

        return { client, keyIndex };
      }

      // Цей ключ на cooldown/soft-ban - спробувати наступний
      this.currentIndex = (this.currentIndex + 1) % this.clients.length;
    } while (this.currentIndex !== startIndex);

    // Всі ключі на cooldown або invalid - знайти найкращий варіант
    let minCooldownIndex = -1;
    let minCooldown = Infinity;

    for (let i = 0; i < this.keys.length; i++) {
      // Пропустити invalid ключі навіть у fallback
      if (this.invalidKeys.has(i)) continue;

      const cooldownUntil = this.cooldowns.get(i) || 0;
      const softBanUntil = this.softBans.get(i) || 0;
      const nextAvailable = Math.max(cooldownUntil, softBanUntil);
      if (nextAvailable < minCooldown) {
        minCooldown = nextAvailable;
        minCooldownIndex = i;
      }
    }

    // Якщо всі ключі invalid - кинути помилку
    if (minCooldownIndex === -1) {
      throw new Error('❌ Всі API ключі невалідні! Перевірте GEMINI_API_KEYS в налаштуваннях.');
    }

    const waitTime = Math.max(0, minCooldown - now);
    console.warn(
      `⚠️ [GEMINI] Всі валідні ключі на cooldown! Використовую ключ #${minCooldownIndex + 1} ` +
        `(очікування: ${Math.ceil(waitTime / 1000)}с)`
    );

    return { client: this.clients[minCooldownIndex], keyIndex: minCooldownIndex };
  }

  /**
   * Позначити ключ як rate limited (429 помилка)
   * Адаптивний cooldown на основі RPM ліміту моделі:
   * - Gemini Flash: 10 RPM = cooldown 6 секунд
   * - Gemini Pro: 2-5 RPM = cooldown 15-30 секунд
   * @param {number} keyIndex - Індекс ключа
   * @param {number} cooldownMs - Час cooldown в мілісекундах (опціонально)
   * @param {string} modelUsed - Назва моделі що викликала rate limit
   */
  markRateLimited(keyIndex, cooldownMs = null, modelUsed = '') {
    // Адаптивний cooldown на основі моделі
    let effectiveCooldown = cooldownMs;
    if (effectiveCooldown === null) {
      if (modelUsed.toLowerCase().includes('flash')) {
        // Flash: 10 RPM = 1 запит кожні 6 сек
        effectiveCooldown = parseInt(process.env.GEMINI_RATE_LIMIT_COOLDOWN_MS_FLASH, 10) || 120000;
      } else if (modelUsed.toLowerCase().includes('pro')) {
        // Pro: 2-5 RPM = 1 запит кожні 15-30 сек
        effectiveCooldown = parseInt(process.env.GEMINI_RATE_LIMIT_COOLDOWN_MS_PRO, 10) || 180000;
      } else {
        // Default: 10 сек (компроміс)
        effectiveCooldown = parseInt(process.env.GEMINI_RATE_LIMIT_COOLDOWN_MS_DEFAULT, 10) || 120000;
      }
    }

    const cooldownUntil = Date.now() + effectiveCooldown;
    this.cooldowns.set(keyIndex, cooldownUntil);
    this.usageStats[keyIndex].rateLimits++;

    // Інкрементуємо лічильник послідовних 429
    const current429 = (this.consecutive429.get(keyIndex) || 0) + 1;
    this.consecutive429.set(keyIndex, current429);

    const softBanThreshold = parseInt(process.env.GEMINI_RATE_LIMIT_SOFTBAN_THRESHOLD, 10) || 3;
    const softBanMs = parseInt(process.env.GEMINI_RATE_LIMIT_SOFTBAN_MS, 10) || 600000; // 10 хв
    if (current429 >= softBanThreshold) {
      const softBanUntil = Date.now() + softBanMs;
      this.softBans.set(keyIndex, softBanUntil);
      this.consecutive429.set(keyIndex, 0); // скидаємо після бану
      console.warn(
        `🚫 [GEMINI] Ключ #${keyIndex + 1} у м'якому бані на ${Math.round(softBanMs / 1000)}с після ${current429} послідовних 429`
      );
    }

    console.warn(
      `⚠️ [GEMINI] Ключ #${keyIndex + 1} досяг rate limit, cooldown ${effectiveCooldown / 1000}с ` +
        `(модель: ${modelUsed || 'unknown'}, всього rate limits: ${this.usageStats[keyIndex].rateLimits})`
    );
  }

  /**
   * Позначити помилку для ключа
   * @param {number} keyIndex - Індекс ключа
   */
  markError(keyIndex) {
    this.usageStats[keyIndex].errors++;
    this.consecutive429.set(keyIndex, 0);
  }

  /**
   * Позначити ключ як перманентно невалідний (400/401 помилки)
   * Такий ключ більше ніколи не буде використовуватись
   * @param {number} keyIndex - Індекс ключа
   */
  markInvalid(keyIndex) {
    this.invalidKeys.add(keyIndex);
    this.usageStats[keyIndex].invalid = true;
    // Також видаляємо з cooldown щоб не плутати
    this.cooldowns.delete(keyIndex);
    this.softBans.delete(keyIndex);
    this.consecutive429.delete(keyIndex);
    console.error(
      `🚫 [GEMINI] Ключ #${keyIndex + 1} ПЕРМАНЕНТНО НЕВАЛІДНИЙ! ` +
        `(Залишилось валідних: ${this.keys.length - this.invalidKeys.size})`
    );
  }

  markSuccess(keyIndex) {
    // Скидаємо лічильник послідовних 429 після успішного запиту
    if (this.consecutive429.has(keyIndex)) {
      this.consecutive429.set(keyIndex, 0);
    }
  }

  /**
   * Перевірити чи ключ невалідний
   * @param {number} keyIndex - Індекс ключа
   * @returns {boolean}
   */
  isInvalid(keyIndex) {
    return this.invalidKeys.has(keyIndex);
  }

  /**
   * Отримати статистику використання ключів
   * @returns {Object} Статистика
   */
  getStats() {
    const now = Date.now();
    const activeCooldowns = Array.from(this.cooldowns.entries())
      .filter(([, until]) => until > now)
      .map(([index, until]) => ({
        keyIndex: index + 1,
        remainingSeconds: Math.ceil((until - now) / 1000),
      }));

    const activeSoftBans = Array.from(this.softBans.entries())
      .filter(([, until]) => until > now)
      .map(([index, until]) => ({
        keyIndex: index + 1,
        remainingSeconds: Math.ceil((until - now) / 1000),
      }));

    return {
      totalKeys: this.keys.length,
      availableKeys: this.keys.length - activeCooldowns.length - activeSoftBans.length,
      cooldowns: activeCooldowns,
      softBans: activeSoftBans,
      usage: this.usageStats.map((stats, i) => ({
        key: i + 1,
        ...stats,
      })),
    };
  }

  /**
   * Кількість доступних ключів
   * @returns {number}
   */
  get availableCount() {
    const now = Date.now();
    let available = this.keys.length;
    for (const until of this.cooldowns.values()) {
      if (until > now) available--;
    }
    return available;
  }

  /**
   * Загальна кількість ключів
   * @returns {number}
   */
  get totalCount() {
    return this.keys.length;
  }

  /**
   * Резервувати унікальний ключ для batch (для паралельної обробки)
   * Кожен batch отримує свій ключ, щоб уникнути колізій
   * @param {string} batchId - Унікальний ідентифікатор batch
   * @returns {{ client: GoogleGenAI, keyIndex: number, release: () => void }}
   */
  reserveKeyForBatch(batchId) {
    const now = Date.now();

    // Якщо batch вже має зарезервований ключ - перевірити чи він ще валідний
    if (this.reservedKeys.has(batchId)) {
      const keyIndex = this.reservedKeys.get(batchId);
      // Якщо зарезервований ключ став invalid - знайти новий
      if (this.invalidKeys.has(keyIndex)) {
        this.reservedKeys.delete(batchId);
        const currentActive = this.activeRequests.get(keyIndex) || 0;
        if (currentActive > 0) {
          this.activeRequests.set(keyIndex, currentActive - 1);
        }
        console.warn(
          `⚠️ [GEMINI] Зарезервований ключ #${keyIndex + 1} став invalid, шукаю новий...`
        );
      } else {
        return {
          client: this.clients[keyIndex],
          keyIndex,
          release: () => this.releaseKeyForBatch(batchId),
        };
      }
    }

    // Знайти ключ з найменшою кількістю активних запитів, що не на cooldown і не invalid
    let bestKeyIndex = -1;
    let minActiveRequests = Infinity;

    for (let i = 0; i < this.keys.length; i++) {
      // Пропустити invalid ключі
      if (this.invalidKeys.has(i)) {
        continue;
      }

      const cooldownUntil = this.cooldowns.get(i);
      if (cooldownUntil && now < cooldownUntil) {
        continue; // Пропустити ключі на cooldown
      }

      const activeCount = this.activeRequests.get(i) || 0;
      if (activeCount < minActiveRequests) {
        minActiveRequests = activeCount;
        bestKeyIndex = i;
      }
    }

    // Якщо всі валідні ключі на cooldown - взяти з найменшим cooldown
    if (bestKeyIndex === -1) {
      let minCooldown = Infinity;
      for (let i = 0; i < this.keys.length; i++) {
        // Пропустити invalid ключі навіть у fallback
        if (this.invalidKeys.has(i)) continue;

        const cooldownUntil = this.cooldowns.get(i) || 0;
        if (cooldownUntil < minCooldown) {
          minCooldown = cooldownUntil;
          bestKeyIndex = i;
        }
      }
    }

    // Якщо всі ключі invalid - кинути помилку
    if (bestKeyIndex === -1) {
      throw new Error('❌ Всі API ключі невалідні! Перевірте GEMINI_API_KEYS в налаштуваннях.');
    }

    // Зарезервувати ключ
    this.reservedKeys.set(batchId, bestKeyIndex);
    this.activeRequests.set(bestKeyIndex, (this.activeRequests.get(bestKeyIndex) || 0) + 1);

    console.log(
      `🔐 [GEMINI] Зарезервовано ключ #${bestKeyIndex + 1} для batch ${batchId} ` +
        `(активних запитів: ${this.activeRequests.get(bestKeyIndex)})`
    );

    return {
      client: this.clients[bestKeyIndex],
      keyIndex: bestKeyIndex,
      release: () => this.releaseKeyForBatch(batchId),
    };
  }

  /**
   * Звільнити зарезервований ключ після завершення batch
   * @param {string} batchId - Ідентифікатор batch
   */
  releaseKeyForBatch(batchId) {
    const keyIndex = this.reservedKeys.get(batchId);
    if (keyIndex !== undefined) {
      this.reservedKeys.delete(batchId);
      const currentActive = this.activeRequests.get(keyIndex) || 0;
      if (currentActive > 0) {
        this.activeRequests.set(keyIndex, currentActive - 1);
      }
      console.log(
        `🔓 [GEMINI] Звільнено ключ #${keyIndex + 1} від batch ${batchId} ` +
          `(залишилось активних: ${this.activeRequests.get(keyIndex) || 0})`
      );
    }
  }

  /**
   * Отримати клієнт по конкретному індексу (для використання зарезервованого ключа)
   * Якщо ключ invalid або на cooldown - автоматично fallback на round-robin
   * @param {number} keyIndex - Індекс ключа
   * @returns {{ client: GoogleGenAI, keyIndex: number }}
   */
  getClientByIndex(keyIndex) {
    if (keyIndex < 0 || keyIndex >= this.clients.length) {
      console.warn(`⚠️ [GEMINI] Невалідний keyIndex ${keyIndex}, використовую round-robin`);
      return this.getNextClient();
    }

    // Перевірити чи ключ invalid - якщо так, використати інший
    if (this.invalidKeys.has(keyIndex)) {
      console.warn(`⚠️ [GEMINI] Ключ #${keyIndex + 1} невалідний, шукаю інший...`);
      return this.getNextClient();
    }

    // Перевірити cooldown - якщо на cooldown, використати інший
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(keyIndex);
    const softBanUntil = this.softBans.get(keyIndex);
    const isCooldownActive = cooldownUntil && now < cooldownUntil;
    const isSoftBanActive = softBanUntil && now < softBanUntil;

    if (isCooldownActive || isSoftBanActive) {
      const remainingMs = Math.max(cooldownUntil || 0, softBanUntil || 0) - now;
      const remainingSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
      console.warn(
        `⚠️ [GEMINI] Ключ #${keyIndex + 1} недоступний (${remainingSeconds}с), шукаю інший...`
      );
      return this.getNextClient();
    }

    this.usageStats[keyIndex].requests++;

    if (this.clients.length > 1) {
      console.log(
        `[GEMINI] Використовую зарезервований ключ #${keyIndex + 1}/${this.clients.length} ` +
          `(запитів: ${this.usageStats[keyIndex].requests})`
      );
    }

    return { client: this.clients[keyIndex], keyIndex };
  }

  /**
   * Отримати кількість зарезервованих ключів (для визначення MAX_CONCURRENT_BATCHES)
   * @returns {number}
   */
  get reservedCount() {
    return this.reservedKeys.size;
  }
}

// --- Парсинг API ключів ---

/**
 * Валідувати формат Gemini API ключа
 * @param {string} key - API ключ
 * @param {number} index - Індекс ключа для логування
 * @returns {boolean} - true якщо ключ має валідний формат
 */
function isValidKeyFormat(key, index) {
  // Валідні Gemini API ключі починаються з "AIza"
  if (!key.startsWith('AIza')) {
    console.warn(
      `⚠️ [CONFIG] Ключ #${index + 1} (${key.slice(0, 8)}...) має невалідний формат! ` +
        `Gemini ключі повинні починатись з "AIza".`
    );
    return false;
  }
  // Мінімальна довжина ключа
  if (key.length < 30) {
    console.warn(`⚠️ [CONFIG] Ключ #${index + 1} занадто короткий (${key.length} символів)`);
    return false;
  }
  return true;
}

/**
 * Отримати масив API ключів з змінних середовища
 * Підтримує: GEMINI_API_KEYS (через кому) або GEMINI_API_KEY (один ключ)
 * Автоматично фільтрує ключі з невалідним форматом
 * @returns {string[]}
 */
function parseApiKeys() {
  let rawKeys = [];

  // Пріоритет 1: Багато ключів через кому
  if (process.env.GEMINI_API_KEYS) {
    rawKeys = process.env.GEMINI_API_KEYS.split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
  }
  // Пріоритет 2: Один ключ (backward compatible)
  else if (process.env.GEMINI_API_KEY) {
    rawKeys = [process.env.GEMINI_API_KEY.trim()];
  }

  if (rawKeys.length === 0) {
    throw new Error('❌ GEMINI_API_KEY або GEMINI_API_KEYS не встановлено в змінних середовища!');
  }

  // Валідація формату ключів
  const validKeys = rawKeys.filter((key, index) => isValidKeyFormat(key, index));

  console.log(`📋 [CONFIG] Знайдено ${rawKeys.length} API ключів, валідних: ${validKeys.length}`);

  if (validKeys.length === 0) {
    throw new Error(
      `❌ Жоден з ${rawKeys.length} API ключів не має валідного формату! ` +
        `Gemini ключі повинні починатись з "AIza".`
    );
  }

  if (validKeys.length < rawKeys.length) {
    console.warn(
      `⚠️ [CONFIG] ${rawKeys.length - validKeys.length} ключ(ів) відфільтровано через невалідний формат`
    );
  }

  return validKeys;
}

// --- Ініціалізація ---

const apiKeys = parseApiKeys();
export const apiKeyManager = new ApiKeyManager(apiKeys);

// Для backward compatibility - перший клієнт
export const genAI = apiKeyManager.clients[0];

// Model configuration from environment
export const modelName = process.env.MODEL_NAME || 'gemini-2.5-flash';
// Fallback модель - якщо основна rate limited, спробувати цю
export const FALLBACK_MODEL_NAME =
  process.env.FALLBACK_MODEL_NAME ||
  (modelName === 'gemini-2.5-pro' ? 'gemini-2.5-flash' : 'gemini-2.5-pro');

// Логування конфігурації моделей при запуску
console.log(`📋 [CONFIG] Основна модель: ${modelName}`);
console.log(`📋 [CONFIG] Fallback модель: ${FALLBACK_MODEL_NAME}`);

// Generation configuration from environment
export const GENERATION_CONFIG = {
  temperature: parseFloat(process.env.TEMPERATURE) || 0.3,
  topK: parseInt(process.env.TOP_K) || 40,
  topP: parseFloat(process.env.TOP_P) || 0.8,
  maxOutputTokens: parseInt(process.env.MAX_TOKENS) || 65536,
};

// Safety settings (using enums from @google/genai)
export const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

// Batching configuration from environment
export const OPTIMAL_BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 10;
export const DELAY_BETWEEN_BATCHES = parseInt(process.env.BATCH_DELAY) || 1500;
export const BATCH_THRESHOLD = parseInt(process.env.BATCH_THRESHOLD) || 15;
export const MAX_TOKENS_PER_BATCH = parseInt(process.env.MAX_TOKENS_PER_BATCH) || 60000;

// === CLIProxyAPI Configuration (PRIMARY) ===
import { CLIProxyClient } from './cliProxyClient.js';

export const CLI_PROXY_URL = process.env.CLI_PROXY_URL || '';
export const CLI_PROXY_MODEL = process.env.CLI_PROXY_MODEL || 'gemini-3-pro-preview';
export const ENABLE_CLI_PROXY = process.env.ENABLE_CLI_PROXY === 'true';
export const CLI_PROXY_MAX_ATTEMPTS_PER_KEY = parseInt(
  process.env.CLI_PROXY_MAX_ATTEMPTS_PER_KEY || '1',
  10
);

function parseProxyKeys() {
  const keys = process.env.CLI_PROXY_API_KEYS || process.env.CLI_PROXY_API_KEY || '';
  return keys
    .split(/[,\s\n\r;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

const proxyKeys = parseProxyKeys();
export const cliProxyClient =
  ENABLE_CLI_PROXY && CLI_PROXY_URL && proxyKeys.length > 0
    ? new CLIProxyClient(CLI_PROXY_URL, proxyKeys, CLI_PROXY_MAX_ATTEMPTS_PER_KEY)
    : null;

if (cliProxyClient) {
  console.log(`🚀 [CONFIG] CLIProxyAPI PRIMARY: ${CLI_PROXY_MODEL} (${proxyKeys.length} ключів)`);
  console.log(`📋 [CONFIG] Офіційні Gemini ключі = FALLBACK (${apiKeyManager.totalCount} шт)`);
} else {
  console.log(`📋 [CONFIG] CLIProxyAPI вимкнено, тільки офіційні ключі`);
}
