/**
 * Configuration for Gemini AI service
 * Contains API settings, model configuration, safety settings,
 * and API key rotation manager for increased rate limits
 */

import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
    this.clients = keys.map((key) => new GoogleGenerativeAI(key));
    this.currentIndex = 0;
    this.cooldowns = new Map(); // keyIndex → cooldown until timestamp
    this.usageStats = keys.map(() => ({ requests: 0, errors: 0, rateLimits: 0 }));

    console.log(`✅ [API KEY MANAGER] Ініціалізовано ${keys.length} API ключ(ів)`);
  }

  /**
   * Отримати наступний доступний клієнт (round-robin з пропуском cooldown)
   * @returns {{ client: GoogleGenerativeAI, keyIndex: number }}
   */
  getNextClient() {
    const startIndex = this.currentIndex;
    const now = Date.now();

    // Спробувати знайти ключ, що не на cooldown
    do {
      const cooldownUntil = this.cooldowns.get(this.currentIndex);

      if (!cooldownUntil || now > cooldownUntil) {
        // Ключ доступний
        if (cooldownUntil && now > cooldownUntil) {
          // Cooldown закінчився - очистити
          this.cooldowns.delete(this.currentIndex);
        }

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

      // Цей ключ на cooldown - спробувати наступний
      this.currentIndex = (this.currentIndex + 1) % this.clients.length;
    } while (this.currentIndex !== startIndex);

    // Всі ключі на cooldown - повернути перший (з найменшим cooldown)
    let minCooldownIndex = 0;
    let minCooldown = Infinity;

    for (const [index, until] of this.cooldowns.entries()) {
      if (until < minCooldown) {
        minCooldown = until;
        minCooldownIndex = index;
      }
    }

    const waitTime = Math.max(0, minCooldown - now);
    console.warn(
      `⚠️ [GEMINI] Всі ключі на cooldown! Використовую ключ #${minCooldownIndex + 1} ` +
        `(очікування: ${Math.ceil(waitTime / 1000)}с)`
    );

    return { client: this.clients[minCooldownIndex], keyIndex: minCooldownIndex };
  }

  /**
   * Позначити ключ як rate limited (429 помилка)
   * @param {number} keyIndex - Індекс ключа
   * @param {number} cooldownMs - Час cooldown в мілісекундах (за замовчуванням 60 сек)
   */
  markRateLimited(keyIndex, cooldownMs = 60000) {
    const cooldownUntil = Date.now() + cooldownMs;
    this.cooldowns.set(keyIndex, cooldownUntil);
    this.usageStats[keyIndex].rateLimits++;

    console.warn(
      `⚠️ [GEMINI] Ключ #${keyIndex + 1} досяг rate limit, cooldown ${cooldownMs / 1000}с ` +
        `(всього rate limits: ${this.usageStats[keyIndex].rateLimits})`
    );
  }

  /**
   * Позначити помилку для ключа
   * @param {number} keyIndex - Індекс ключа
   */
  markError(keyIndex) {
    this.usageStats[keyIndex].errors++;
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

    return {
      totalKeys: this.keys.length,
      availableKeys: this.keys.length - activeCooldowns.length,
      cooldowns: activeCooldowns,
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
}

// --- Парсинг API ключів ---

/**
 * Отримати масив API ключів з змінних середовища
 * Підтримує: GEMINI_API_KEYS (через кому) або GEMINI_API_KEY (один ключ)
 * @returns {string[]}
 */
function parseApiKeys() {
  // Пріоритет 1: Багато ключів через кому
  if (process.env.GEMINI_API_KEYS) {
    const keys = process.env.GEMINI_API_KEYS.split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    if (keys.length > 0) {
      console.log(`📋 [CONFIG] Знайдено ${keys.length} API ключів (GEMINI_API_KEYS)`);
      return keys;
    }
  }

  // Пріоритет 2: Один ключ (backward compatible)
  if (process.env.GEMINI_API_KEY) {
    console.log(`📋 [CONFIG] Знайдено 1 API ключ (GEMINI_API_KEY)`);
    return [process.env.GEMINI_API_KEY];
  }

  throw new Error('❌ GEMINI_API_KEY або GEMINI_API_KEYS не встановлено в змінних середовища!');
}

// --- Ініціалізація ---

const apiKeys = parseApiKeys();
export const apiKeyManager = new ApiKeyManager(apiKeys);

// Для backward compatibility - перший клієнт
export const genAI = apiKeyManager.clients[0];

// Model configuration from environment
export const modelName = process.env.MODEL_NAME || 'gemini-2.0-flash';
// Fallback модель - якщо основна rate limited, спробувати цю
export const FALLBACK_MODEL_NAME =
  process.env.FALLBACK_MODEL_NAME ||
  (modelName === 'gemini-2.0-flash' ? 'gemini-1.5-flash' : 'gemini-2.0-flash');

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

// Safety settings
export const SAFETY_SETTINGS = [
  {
    category: 'HARM_CATEGORY_HARASSMENT',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
  {
    category: 'HARM_CATEGORY_HATE_SPEECH',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
  {
    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
  {
    category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
];

// Batching configuration from environment
export const OPTIMAL_BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 10;
export const DELAY_BETWEEN_BATCHES = parseInt(process.env.BATCH_DELAY) || 1500;
export const BATCH_THRESHOLD = parseInt(process.env.BATCH_THRESHOLD) || 15;
export const MAX_TOKENS_PER_BATCH = parseInt(process.env.MAX_TOKENS_PER_BATCH) || 60000;
