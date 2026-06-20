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
  createFinalAnalysis,
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

async function testHardQuotaErrorCooldownsKeyInsteadOfInvalidating() {
  const usedKeys = [];
  const { apiKeyManager, generator } = createTestGenerator([
    async ({ keyIndex }) => {
      usedKeys.push(keyIndex);
      const error = new Error(
        '{"error":{"code":429,"message":"You exceeded your current quota. See https://ai.google.dev/gemini-api/docs/rate-limits#400_errors","status":"RESOURCE_EXHAUSTED"}}'
      );
      error.status = 429;
      throw error;
    },
    async ({ keyIndex }) => {
      usedKeys.push(keyIndex);
      return { text: 'success after quota cooldown' };
    },
  ]);

  const result = await generator('quota regression prompt');

  assert.equal(result, 'success after quota cooldown');
  assert.equal(
    apiKeyManager.isInvalid(0),
    false,
    'a 429 quota/billing error must NOT permanently invalidate the key — quotas reset, so it is a cooldown'
  );
  assert.deepEqual(
    usedKeys.slice(0, 2),
    [0, 1],
    'generateContent should cooldown the quota key and continue with another key'
  );
}

async function testCustomFinalAnalysisRepairsMissingCaseCoverage() {
  const cases = [
    {
      caseNumber: '111/111/11',
      id: '111/111/11',
      url: 'https://reyestr.court.gov.ua/Review/111111111',
      decisionDate: '2026-06-01',
      body: 'Перша справа про передачу на розгляд Великої Палати.',
    },
    {
      caseNumber: '222/222/22',
      id: '222/222/22',
      url: 'https://reyestr.court.gov.ua/Review/222222222',
      decisionDate: '2026-06-02',
      body: 'Друга справа про відмову у передачі на розгляд обʼєднаної палати.',
    },
  ];
  const calls = [];

  try {
    setBatchProcessorTestOverrides({
      generateContent: async (prompt) => {
        calls.push(prompt);
        if (calls.length === 1) {
          return 'Знайдено одну справу: [Справа №111/111/11](https://reyestr.court.gov.ua/Review/111111111) (2026-06-01).';
        }
        return [
          '## Повний звіт',
          '[Справа №111/111/11](https://reyestr.court.gov.ua/Review/111111111) (2026-06-01) — релевантна.',
          '[Справа №222/222/22](https://reyestr.court.gov.ua/Review/222222222) (2026-06-02) — релевантна.',
        ].join('\n');
      },
    });

    const result = await createFinalAnalysis(
      cases,
      [],
      'ищу дела где суд передал дело на рассмотрение большой палаты'
    );

    assert.equal(calls.length, 2, 'missing custom-report coverage should trigger one repair call');
    assert.match(result, /Review\/111111111/);
    assert.match(result, /Review\/222222222/);
    assert.match(calls[1], /НЕ ВКЛЮЧЕНІ У ЧЕРНЕТКУ/i);
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

async function testCustomFinalAnalysisFailsWhenRepairStillMissesCoverage() {
  const cases = [
    {
      caseNumber: '333/333/33',
      id: '333/333/33',
      url: 'https://reyestr.court.gov.ua/Review/333333333',
      decisionDate: '2026-06-03',
      body: 'Третя справа про передачу на розгляд палати.',
    },
    {
      caseNumber: '444/444/44',
      id: '444/444/44',
      url: 'https://reyestr.court.gov.ua/Review/444444444',
      decisionDate: '2026-06-04',
      body: 'Четверта справа про відмову у передачі.',
    },
  ];

  try {
    setBatchProcessorTestOverrides({
      generateContent: async () =>
        'Неповний звіт: [Справа №333/333/33](https://reyestr.court.gov.ua/Review/333333333) (2026-06-03).',
    });

    await assert.rejects(
      () => createFinalAnalysis(cases, [], 'ищу все релевантные дела по передаче в палату'),
      /Фінальний AI-звіт неповний/,
      'custom final analysis should fail instead of saving an incomplete repaired report'
    );
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

async function run() {
  await testGenerateContentTriesAllKeys();
  await testCustomPromptFallsBackOnRetryableGeminiError();
  await testPermissionDeniedKeyIsRemovedFromRotation();
  await testHardQuotaErrorCooldownsKeyInsteadOfInvalidating();
  await testCustomFinalAnalysisRepairsMissingCaseCoverage();
  await testCustomFinalAnalysisFailsWhenRepairStillMissesCoverage();
  console.log('Gemini retry regressions passed.');
}

run();
