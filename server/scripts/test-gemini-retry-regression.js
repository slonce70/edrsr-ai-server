import assert from 'node:assert/strict';

process.env.GEMINI_API_KEYS = Array.from({ length: 17 }, (_, index) =>
  `AIzaSyRegressionKey${String(index).padStart(2, '0')}abcdefghijklmnopqrstu`
).join(',');
process.env.MODEL_NAME = 'gemini-2.5-flash';
process.env.FALLBACK_MODEL_NAME = 'gemini-2.5-flash';
process.env.ENABLE_CLI_PROXY = 'false';
delete process.env.MAX_RETRIES;

const batchProcessor = await import('../batchProcessor.js');
const config = await import('../config.js');

function resetKeyManagerState() {
  config.apiKeyManager.currentIndex = 0;
  config.apiKeyManager.cooldowns.clear();
  config.apiKeyManager.softBans.clear();
  config.apiKeyManager.consecutive429.clear();
  config.apiKeyManager.invalidKeys.clear();
  config.apiKeyManager.reservedKeys.clear();
  config.apiKeyManager.activeRequests.clear();
  for (const stat of config.apiKeyManager.usageStats) {
    stat.requests = 0;
    stat.errors = 0;
    stat.rateLimits = 0;
    stat.invalid = false;
  }
}

async function testGenerateContentTriesAllKeys() {
  resetKeyManagerState();

  const usedKeys = new Set();
  const originalClients = [...config.apiKeyManager.clients];

  config.apiKeyManager.clients = config.apiKeyManager.clients.map((client, index) => ({
    ...client,
    models: {
      ...client.models,
      async generateContent() {
        usedKeys.add(index);
        const error = new Error('503 overloaded');
        error.status = 503;
        throw error;
      },
    },
  }));

  let thrown = null;
  try {
    await batchProcessor.generateContent('regression prompt');
  } catch (error) {
    thrown = error;
  } finally {
    config.apiKeyManager.clients = originalClients;
  }

  assert(thrown, 'generateContent should fail when every key is exhausted');
  assert.match(
    thrown.message,
    /Вичерпано всі спроби запиту до Gemini/,
    'expected exhausted retries error'
  );
  assert.equal(
    usedKeys.size,
    config.apiKeyManager.totalCount,
    'generateContent should try every available Gemini key before giving up'
  );
}

async function testCustomPromptFallsBackOnRetryableGeminiError() {
  resetKeyManagerState();

  const originalClients = [...config.apiKeyManager.clients];
  config.apiKeyManager.clients = config.apiKeyManager.clients.map((client) => ({
    ...client,
    models: {
      ...client.models,
      async generateContent() {
        const error = new Error('503 overloaded');
        error.status = 503;
        throw error;
      },
    },
  }));

  let result;
  try {
    result = await batchProcessor.getBatchSummary(
      [
        {
          caseNumber: '123/456/78',
          id: '123/456/78',
          url: 'https://reyestr.court.gov.ua/Review/12345678',
          body: 'Тестовий текст судового рішення',
          decisionDate: '2026-04-21',
        },
      ],
      1,
      1,
      'ищу дела где лицо обвиняется в'
    );
  } finally {
    config.apiKeyManager.clients = originalClients;
  }

  assert.match(
    result,
    /Частина справ не була проаналізована через тимчасову помилку AI/,
    'custom prompts should degrade to fallback summary instead of failing the whole job'
  );
}

async function run() {
  await testGenerateContentTriesAllKeys();
  await testCustomPromptFallsBackOnRetryableGeminiError();
  console.log('Gemini retry regressions passed.');
}

run();
