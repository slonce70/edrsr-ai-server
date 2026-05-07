import assert from 'node:assert/strict';

process.env.GEMINI_API_KEYS = Array.from(
  { length: 17 },
  (_, index) => `AIzaSyRegressionKey${String(index).padStart(2, '0')}abcdefghijklmnopqrstu`
).join(',');
process.env.MODEL_NAME = 'gemini-2.5-flash';
process.env.FALLBACK_MODEL_NAME = 'gemini-2.5-flash';
process.env.ENABLE_CLI_PROXY = 'false';
delete process.env.MAX_RETRIES;

const {
  clearBatchProcessorTestOverrides,
  createContentGenerator,
  getBatchSummary,
  setBatchProcessorTestOverrides,
} = await import('../batchProcessor.js');

function createFakeApiKeyManager(handlers) {
  const invalidKeys = new Set();
  const clients = handlers.map((handler, index) => ({
    models: {
      async generateContent(request) {
        return handler({ ...request, keyIndex: index });
      },
    },
  }));

  return {
    clients,
    invalidKeys,
    totalCount: clients.length,
    currentIndex: 0,
    getNextClient() {
      for (let attempts = 0; attempts < clients.length; attempts++) {
        const keyIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % clients.length;
        if (!invalidKeys.has(keyIndex)) {
          return { client: clients[keyIndex], keyIndex };
        }
      }
      throw new Error('all fake keys invalid');
    },
    getClientByIndex(index) {
      return { client: clients[index], keyIndex: index };
    },
    markError() {},
    markRateLimited() {},
    markInvalid(index) {
      invalidKeys.add(index);
    },
    isInvalid(index) {
      return invalidKeys.has(index);
    },
  };
}

function createTestGenerator(handlers) {
  const apiKeyManager = createFakeApiKeyManager(handlers);
  const generator = createContentGenerator({
    apiKeyManager,
    cliProxyClient: null,
    enableCliProxy: false,
    cliProxyModel: 'fake-cli-model',
    modelName: 'gemini-2.5-flash',
    fallbackModelName: 'gemini-2.5-flash',
    generationConfig: {},
    safetySettings: [],
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    sleep: async () => {},
    configuredMaxRetries: 1,
  });

  return { apiKeyManager, generator };
}

function createUnexpectedRealClientSentinel() {
  return async function unexpectedRealClientCall() {
    throw new Error('Unexpected real Gemini client path reached');
  };
}

function overloadedHandler(usedKeys) {
  return async ({ keyIndex }) => {
    usedKeys.add(keyIndex);
    const error = new Error('503 overloaded');
    error.status = 503;
    throw error;
  };
}

function assertOnlyFakeClientsWereUsed(usedKeys, expectedCount) {
  assert.equal(
    usedKeys.size,
    expectedCount,
    'generator should use every fake key before exhausting retries'
  );
  for (let index = 0; index < expectedCount; index++) {
    assert.equal(usedKeys.has(index), true, `fake key #${index + 1} should be used`);
  }
}

async function testGenerateContentTriesAllKeys() {
  const usedKeys = new Set();
  const { apiKeyManager, generator } = createTestGenerator(
    Array.from({ length: 17 }, () => overloadedHandler(usedKeys))
  );

  let thrown = null;
  try {
    await generator('regression prompt');
  } catch (error) {
    thrown = error;
  }

  assert(thrown, 'generateContent should fail when every key is exhausted');
  assert.match(
    thrown.message,
    /Вичерпано всі спроби запиту до Gemini/,
    'expected exhausted retries error'
  );
  assertOnlyFakeClientsWereUsed(usedKeys, apiKeyManager.totalCount);
}

async function testCustomPromptFallsBackOnRetryableGeminiError() {
  const usedKeys = new Set();
  const { generator } = createTestGenerator([overloadedHandler(usedKeys)]);

  let result;
  try {
    setBatchProcessorTestOverrides({ generateContent: generator });
    result = await getBatchSummary(
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
    clearBatchProcessorTestOverrides();
  }

  assert.equal(usedKeys.size, 1, 'custom prompt test should use the fake Gemini handler');
  assert.match(
    result,
    /Частина справ не була проаналізована через тимчасову помилку AI/,
    'custom prompts should degrade to fallback summary instead of failing the whole job'
  );
}

async function testPermissionDeniedKeyIsRemovedFromRotation() {
  const usedKeys = [];
  const { apiKeyManager, generator } = createTestGenerator([
    async ({ keyIndex }) => {
      usedKeys.push(keyIndex);
      const error = new Error(
        '{"error":{"code":403,"message":"Your project has been denied access. Please contact support.","status":"PERMISSION_DENIED"}}'
      );
      error.status = 403;
      throw error;
    },
    async ({ keyIndex }) => {
      usedKeys.push(keyIndex);
      return { text: 'success from healthy key' };
    },
    createUnexpectedRealClientSentinel(),
  ]);

  const result = await generator('permission denied regression prompt');

  assert.equal(result, 'success from healthy key');
  assert.equal(apiKeyManager.isInvalid(0), true, '403 denied key should be marked invalid');
  assert.deepEqual(
    usedKeys.slice(0, 2),
    [0, 1],
    'generateContent should skip the denied key and continue with the next one'
  );
}

async function run() {
  await testGenerateContentTriesAllKeys();
  await testCustomPromptFallsBackOnRetryableGeminiError();
  await testPermissionDeniedKeyIsRemovedFromRotation();
  console.log('Gemini retry regressions passed.');
}

run();
