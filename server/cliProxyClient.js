/**
 * CLIProxyAPI Client - PRIMARY AI провайдер
 * OpenAI-сумісний API для Gemini 3 Pro через OAuth токени
 */

class CLIProxyClient {
  constructor(baseUrl, apiKeys) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKeys = apiKeys;
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
    const { key, keyIndex } = this.getNextKey();

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: contents }],
        max_tokens: config?.maxOutputTokens || 65536,
      }),
    });

    if (response.status === 429 || response.status === 503) {
      this.markRateLimited(keyIndex);
      const err = new Error(`CLIProxy rate limited (${response.status})`);
      err.status = response.status;
      err.keyIndex = keyIndex;
      throw err;
    }

    if (!response.ok) {
      const err = new Error(`CLIProxy error: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    return { text: data.choices?.[0]?.message?.content || '' };
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
