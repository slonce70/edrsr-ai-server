import assert from 'node:assert/strict';

// Env must be set before importing modules that parse keys at import time.
process.env.GEMINI_API_KEYS = Array.from(
  { length: 4 },
  (_, index) => `AIzaSyTruncRegressionKey${String(index).padStart(2, '0')}abcdefghijklmnop`
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
const { validateBatchProcessing, generateQualityReport } = await import('../qualityControl.js');

function createFakeApiKeyManager(handlers) {
  const invalidKeys = new Set();
  const rateLimited = new Set();
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
    rateLimited,
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
    markRateLimited(index) {
      rateLimited.add(index);
    },
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
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    sleep: async () => {},
    configuredMaxRetries: 1,
  });
  return { apiKeyManager, generator };
}

// 1) A MAX_TOKENS-truncated response must NOT be returned as a successful result.
async function testMaxTokensFinishReasonThrowsTruncation() {
  const { generator } = createTestGenerator([
    async () => ({
      text: 'Частковий звіт, що обривається на середин',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    }),
  ]);

  let thrown = null;
  try {
    await generator('truncation prompt');
  } catch (error) {
    thrown = error;
  }

  assert(thrown, 'MAX_TOKENS response must not be silently returned as success');
  assert.equal(thrown.truncated, true, 'truncation error must be tagged truncated=true');
  assert.match(thrown.message, /MAX_TOKENS|неповн|обірв/i);
}

// 2) A SAFETY/blocked finishReason must throw a labelled blocked error, not a generic empty-response.
async function testSafetyFinishReasonThrowsBlocked() {
  const { generator } = createTestGenerator([
    async () => ({ text: '', candidates: [{ finishReason: 'SAFETY' }] }),
  ]);

  let thrown = null;
  try {
    await generator('safety prompt');
  } catch (error) {
    thrown = error;
  }

  assert(thrown, 'SAFETY response must throw');
  assert.equal(thrown.blocked, true, 'blocked error must be tagged blocked=true');
  assert.match(thrown.message, /заблок|SAFETY/i);
}

// 3) A truncated batch summary must route into the recursive batch-split recovery.
async function testBatchSummarySplitsOnTruncationAndRecovers() {
  const caseCounts = [];
  const fakeGenerator = async (prompt) => {
    const count = (prompt.match(/--- Справа №/g) || []).length;
    caseCounts.push(count);
    if (count > 1) {
      const error = new Error(
        'Gemini обірвав відповідь по ліміту токенів (MAX_TOKENS). Звіт неповний.'
      );
      error.truncated = true;
      throw error;
    }
    return `Резюме для ${count} справи`;
  };

  try {
    setBatchProcessorTestOverrides({ generateContent: fakeGenerator });
    const result = await getBatchSummary(
      [
        { caseNumber: 'A', id: 'A', url: 'https://reyestr.court.gov.ua/Review/1', body: 'тіло А' },
        { caseNumber: 'B', id: 'B', url: 'https://reyestr.court.gov.ua/Review/2', body: 'тіло Б' },
      ],
      1,
      1,
      null
    );
    assert.match(result, /Резюме для 1 справи/, 'split halves should produce real per-case summaries');
    assert(
      caseCounts.includes(2) && caseCounts.includes(1),
      'should try the 2-case batch, then split into 1-case batches'
    );
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

// 4) The quality footer must not claim "100% / everything correct" when a batch degraded to a placeholder.
async function testQualityFooterFlagsSkippedBatches() {
  const cases = [{}, {}, {}];
  const summaries = [
    'Нормальне резюме справи. '.repeat(8),
    [
      '⚠️ Частина справ не була проаналізована через тимчасову помилку AI.',
      'Причина: Gemini обірвав відповідь.',
      'Перелік справ для ручної перевірки:',
      '- 123 | https://reyestr.court.gov.ua/Review/2',
    ].join('\n'),
  ];

  const validation = validateBatchProcessing(cases, summaries, 2);
  const report = generateQualityReport(validation, cases.length, summaries);

  assert.equal(validation.isValid, false, 'a placeholder summary must invalidate completeness');
  assert.doesNotMatch(
    report,
    /Все дела обработаны корректно/,
    'footer must not falsely certify a degraded report'
  );
  assert.match(report, /проаналізовано|пробел|проблем/i, 'footer must surface the gap');
}

async function run() {
  await testMaxTokensFinishReasonThrowsTruncation();
  await testSafetyFinishReasonThrowsBlocked();
  await testBatchSummarySplitsOnTruncationAndRecovers();
  await testQualityFooterFlagsSkippedBatches();
  console.log('Truncation + quota regressions passed.');
}

run();
