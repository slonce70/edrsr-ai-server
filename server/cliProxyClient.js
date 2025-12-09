/**
 * CLIProxyAPI Client - PRIMARY AI провайдер
 * OpenAI-сумісний API для Gemini 3 Pro через OAuth токени
 */
/* global fetch */

class CLIProxyClient {
  constructor(baseUrl, apiKeys, maxAttemptsPerKey = 1) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKeys = apiKeys;
    this.maxAttemptsPerKey = Math.max(1, parseInt(maxAttemptsPerKey, 10) || 1);
    this.currentKeyIndex = 0;
    this.cooldowns = new Map(); // keyIndex → timestamp
    this.stats = apiKeys.map(() => ({ requests: 0, errors: 0 }));
  }

  getNextKey() {
    const now = Date.now();
    const startIndex = this.currentKeyIndex;

    do {
      const cooldownUntil = this.cooldowns.get(this.currentKeyIndex);
      if (!cooldownUntil || now > cooldownUntil) {
        const keyIndex = this.currentKeyIndex;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        this.stats[keyIndex].requests++;
        return { key: this.apiKeys[keyIndex], keyIndex };
      }
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    } while (this.currentKeyIndex !== startIndex);

    // Всі на cooldown - повернути перший
    return { key: this.apiKeys[0], keyIndex: 0 };
  }

  markRateLimited(keyIndex, cooldownMs = 60000) {
    this.cooldowns.set(keyIndex, Date.now() + cooldownMs);
    this.stats[keyIndex].errors++;
  }

  async generateContent({ model, contents, config }) {
    const triedKeys = new Set();
    let lastError = null;
    let tries = 0;
    const attempts = Array(this.apiKeys.length).fill(0);
    const maxTotalAttempts = this.apiKeys.length * this.maxAttemptsPerKey;

    // Спробувати кожен ключ до maxAttemptsPerKey разів перед fallback
    while (tries < maxTotalAttempts) {
      const { key, keyIndex } = this.getNextKey();
      tries++;

      if (attempts[keyIndex] >= this.maxAttemptsPerKey) {
        triedKeys.add(keyIndex);
        // Якщо всі ключі вичерпали ліміт спроб — виходимо
        if (triedKeys.size >= this.apiKeys.length) break;
        continue;
      }

      attempts[keyIndex] += 1;
      triedKeys.add(keyIndex);
      triedKeys.add(keyIndex);

      try {
        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: contents }],
            max_tokens: config?.maxOutputTokens || 65536,
            reasoning_effort: 'high',
          }),
        });

        // Успіх
        if (response.ok) {
          const data = await response.json();
          return { text: data.choices?.[0]?.message?.content || '' };
        }

        // Rate limit або помилка сервера - спробувати інший ключ
        if (response.status === 429 || response.status === 503 || response.status === 403) {
          this.markRateLimited(keyIndex, response.status === 403 ? 30000 : 60000);
          lastError = new Error(`CLIProxy error (${response.status}), ключ #${keyIndex + 1}`);
          lastError.status = response.status;
          continue; // Спробувати наступний ключ
        }

        // Інші помилки - одразу fallback
        const err = new Error(`CLIProxy error: ${response.status}`);
        err.status = response.status;
        throw err;
      } catch (fetchError) {
        // Network error - спробувати інший ключ
        if (fetchError.status) throw fetchError; // Re-throw CLIProxy errors
        lastError = fetchError;
        this.markRateLimited(keyIndex, 30000);
        continue;
      }
    }

    // Всі ключі вичерпані
    const err = lastError || new Error('CLIProxy: всі ключі вичерпані');
    err.allKeysExhausted = true;
    err.tried = tries;
    err.total = this.apiKeys.length;
    err.maxAttemptsPerKey = this.maxAttemptsPerKey;
    throw err;
  }

  get totalCount() {
    return this.apiKeys.length;
  }

  get availableCount() {
    const now = Date.now();
    return this.apiKeys.filter((_, i) => {
      const cd = this.cooldowns.get(i);
      return !cd || now > cd;
    }).length;
  }
}

export { CLIProxyClient };
