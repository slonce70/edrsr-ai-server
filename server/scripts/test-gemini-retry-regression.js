import assert from 'node:assert/strict';

process.env.GEMINI_API_KEYS = Array.from(
  { length: 17 },
  (_, index) => `AIzaSyRegressionKey${String(index).padStart(2, '0')}abcdefghijklmnopqrstu`
).join(',');
process.env.MODEL_NAME = 'gemini-2.5-flash';
process.env.FALLBACK_MODEL_NAME = 'gemini-2.5-flash';
process.env.ENABLE_CLI_PROXY = 'false';
process.env.GEMINI_RATE_LIMIT_COOLDOWN_MS_DEFAULT = '60000';
process.env.GEMINI_RATE_LIMIT_SOFTBAN_MS = '180000';
process.env.GEMINI_RATE_LIMIT_SOFTBAN_THRESHOLD = '3';
delete process.env.MAX_RETRIES;

const {
  clearBatchProcessorTestOverrides,
  createContentGenerator,
  createFinalAnalysis,
  getBatchSummary,
  setBatchProcessorTestOverrides,
} = await import('../batchProcessor.js');
const { ApiKeyManager } = await import('../config.js');
const { computeReportCoverage } = await import('../quality/coverage.js');

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
  const batchSleeps = [];

  let result;
  try {
    setBatchProcessorTestOverrides({
      generateContent: generator,
      sleep: async (ms) => {
        batchSleeps.push(ms);
      },
    });
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
  assert.equal(
    batchSleeps.length,
    1,
    'a 503 batch is retried once (same batch) after a backoff pause'
  );
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

const COVERAGE_CASES = [
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
const INCOMPLETE_REPORT =
  'Неповний звіт: [Справа №333/333/33](https://reyestr.court.gov.ua/Review/333333333) (2026-06-03).';

async function testCoverageRepairKeepsReportAndListsUncoveredCases() {
  const calls = [];
  try {
    setBatchProcessorTestOverrides({
      generateContent: async (prompt) => {
        calls.push(prompt);
        return INCOMPLETE_REPORT;
      },
    });

    const result = await createFinalAnalysis(
      COVERAGE_CASES,
      [],
      'ищу все релевантные дела по передаче в палату'
    );

    assert.equal(calls.length, 2, 'draft call plus exactly one repair call');
    assert.ok(result.startsWith(INCOMPLETE_REPORT), 'the finished report must be kept intact');
    assert.match(result, /Неповне охоплення справ/, 'appended section must be clearly labelled');
    assert.match(result, /- 444\/444\/44 \| https:\/\/reyestr\.court\.gov\.ua\/Review\/444444444/);
    assert.doesNotMatch(
      result.slice(INCOMPLETE_REPORT.length),
      /Review\/333333333/,
      'only the not-covered case is listed'
    );
    // Listed URLs now count as "cited", so the section must keep the report flagged as partial.
    const coverage = computeReportCoverage(
      result,
      COVERAGE_CASES.map((c) => c.url)
    );
    assert.equal(coverage.partial, true, 'a report with a not-covered section stays partial');
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

async function testCoverageRepairCallFailureKeepsDraft() {
  let calls = 0;
  try {
    setBatchProcessorTestOverrides({
      generateContent: async () => {
        calls += 1;
        if (calls === 1) return INCOMPLETE_REPORT;
        throw new Error('Вичерпано всі спроби запиту до Gemini');
      },
    });

    const result = await createFinalAnalysis(COVERAGE_CASES, [], 'ищу дела по передаче в палату');

    assert.ok(result.startsWith(INCOMPLETE_REPORT), 'draft survives a failed repair call');
    assert.match(result, /Review\/444444444/);
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

async function testNonCoverageFinalAnalysisErrorsStayFatal() {
  try {
    setBatchProcessorTestOverrides({
      generateContent: async () => {
        throw new Error('boom');
      },
    });
    await assert.rejects(
      () => createFinalAnalysis(COVERAGE_CASES, [], 'ищу дела по передаче в палату'),
      /boom/,
      'a failing main call must still fail the final analysis'
    );
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

/* ---------------------------- real ApiKeyManager ---------------------------- */

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

// Fake wall clock: patches Date.now (ApiKeyManager and the generator read it) and provides a
// sleep that only advances that clock, so cooldown/ban/backoff logic runs instantly.
function createFakeClock() {
  const realNow = Date.now;
  let current = 1_700_000_000_000;
  Date.now = () => current;
  const clock = {
    sleeps: [],
    now: () => current,
    advance(ms) {
      current += ms;
    },
    async sleep(ms) {
      clock.sleeps.push(ms);
      current += ms;
    },
    restore() {
      Date.now = realNow;
    },
  };
  return clock;
}

function createRealManager(keyCount, onCall = async () => ({ text: 'ok' })) {
  const keys = Array.from(
    { length: keyCount },
    (_, index) => `AIzaSyUnitManagerKey${String(index).padStart(2, '0')}abcdefghijklmnopqrstu`
  );
  const manager = new ApiKeyManager(keys);
  manager.clients = keys.map((_, keyIndex) => ({
    models: {
      async generateContent(request) {
        return onCall({ ...request, keyIndex });
      },
    },
  }));
  return manager;
}

function createRealGenerator(manager, clock, overrides = {}) {
  return createContentGenerator({
    apiKeyManager: manager,
    cliProxyClient: null,
    enableCliProxy: false,
    modelName: 'model-primary',
    fallbackModelName: 'model-fallback',
    generationConfig: {},
    safetySettings: [],
    logger: silentLogger,
    sleep: (ms) => clock.sleep(ms),
    configuredMaxRetries: 4,
    ...overrides,
  });
}

function httpError(status, message) {
  const error = new Error(message);
  if (status !== undefined) error.status = status;
  return error;
}

const QUOTA_BODY = '{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}';
const OVERLOAD_BODY = '{"error":{"code":503,"message":"overloaded","status":"UNAVAILABLE"}}';

function reserveAndRelease(manager, count, prefix) {
  const picked = [];
  for (let index = 0; index < count; index++) {
    const { keyIndex, release } = manager.reserveKeyForBatch(`${prefix}_${index}`);
    picked.push(keyIndex);
    release();
  }
  return picked;
}

// A: reservations must spread over idle keys instead of always landing on key #1.
async function testReservationsSpreadAcrossIdleKeys() {
  const manager = createRealManager(11);
  const counts = new Array(11).fill(0);
  for (const keyIndex of reserveAndRelease(manager, 22, 'seq')) counts[keyIndex] += 1;
  assert.deepEqual(counts, new Array(11).fill(2), 'idle keys must be used evenly, not just key #1');

  // Two batches in flight at a time (MAX_CONCURRENT_BATCHES=2): still walks through every key.
  const concurrent = createRealManager(11);
  const touched = new Set();
  let held = concurrent.reserveKeyForBatch('c_0');
  touched.add(held.keyIndex);
  for (let index = 1; index < 11; index++) {
    const next = concurrent.reserveKeyForBatch(`c_${index}`);
    assert.notEqual(next.keyIndex, held.keyIndex, 'concurrent batches must not share a key');
    touched.add(next.keyIndex);
    held.release();
    held = next;
  }
  held.release();
  assert.equal(touched.size, 11, 'all 11 keys must take part when batches rotate');
}

async function testReservationsSkipCooledSoftBannedAndInvalidKeys() {
  const clock = createFakeClock();
  try {
    const manager = createRealManager(6);
    manager.markRateLimited(1, 60000, 'model'); // cooldown only
    manager.softBans.set(2, clock.now() + 180000); // soft-ban only
    manager.markInvalid(3);

    assert.deepEqual(
      new Set(reserveAndRelease(manager, 12, 'a')),
      new Set([0, 4, 5]),
      'cooled / soft-banned / invalid keys are skipped'
    );

    clock.advance(60001);
    const afterCooldown = new Set(reserveAndRelease(manager, 12, 'b'));
    assert.deepEqual(afterCooldown, new Set([0, 1, 4, 5]), 'cooldown expiry returns the key');

    clock.advance(180000);
    const afterBan = new Set(reserveAndRelease(manager, 12, 'c'));
    assert.deepEqual(afterBan, new Set([0, 1, 2, 4, 5]), 'soft-ban expiry returns the key');
  } finally {
    clock.restore();
  }
}

// B: 429 streak accumulates into the soft-ban, expires, and success resets it.
async function testSoftBanAccumulatesExpiresAndResetsOnSuccess() {
  const clock = createFakeClock();
  try {
    const manager = createRealManager(2);
    manager.markRateLimited(0, 1000, 'model');
    manager.markRateLimited(0, 1000, 'model');
    assert.equal(manager.softBans.has(0), false, 'two 429s are below the soft-ban threshold');
    manager.markRateLimited(0, 1000, 'model');
    assert.equal(
      manager.softBans.get(0),
      clock.now() + 180000,
      'third 429 soft-bans for the configured time'
    );

    clock.advance(1001); // cooldown over, soft-ban still on
    assert.equal(manager.getNextClient().keyIndex, 1, 'soft-banned key is skipped');
    assert.equal(manager.getWaitMs(), 0, 'a free key exists, so nothing to wait for');

    clock.advance(180000);
    assert.equal(manager.getWaitMs(), 0);
    assert.deepEqual(
      new Set([manager.getNextClient().keyIndex, manager.getNextClient().keyIndex]),
      new Set([0, 1]),
      'key is back after the soft-ban expires'
    );

    // A success in between breaks the streak.
    manager.markRateLimited(1, 1000, 'model');
    manager.markRateLimited(1, 1000, 'model');
    manager.markSuccess(1);
    manager.markRateLimited(1, 1000, 'model');
    assert.equal(manager.softBans.has(1), false, 'success resets the consecutive-429 counter');

    // getWaitMs reports the earliest expiry when every valid key is cooled or banned.
    const all = createRealManager(3);
    all.softBans.set(0, clock.now() + 50000);
    all.cooldowns.set(1, clock.now() + 20000);
    all.softBans.set(2, clock.now() + 90000);
    all.cooldowns.set(2, clock.now() + 120000);
    assert.equal(all.getWaitMs(), 20000);
    all.markInvalid(1);
    assert.equal(all.getWaitMs(), 50000, 'invalid keys never count as available');
    all.markInvalid(0);
    all.markInvalid(2);
    assert.equal(all.getWaitMs(), 0, 'no valid keys: let getNextClient raise its own error');
  } finally {
    clock.restore();
  }
}

async function testGeneratorSoftBansAfterThreeQuotaFailuresAndWaitsWhenAllKeysBanned() {
  const clock = createFakeClock();
  try {
    let failuresLeft = 6; // 3 attempts x (primary + fallback)
    const callTimes = [];
    const manager = createRealManager(1, async () => {
      callTimes.push(clock.now());
      if (failuresLeft-- > 0) throw httpError(429, QUOTA_BODY);
      return { text: 'recovered' };
    });
    let banWindow = null;
    const originalMarkRateLimited = manager.markRateLimited.bind(manager);
    manager.markRateLimited = (...args) => {
      originalMarkRateLimited(...args);
      const until = manager.softBans.get(0);
      if (until && !banWindow)
        banWindow = { from: clock.now(), until, callsBefore: callTimes.length };
    };

    const result = await createRealGenerator(manager, clock, {
      configuredMaxRetries: 10,
      maxKeyWaitMs: 600000,
      maxTotalKeyWaitMs: 3600000,
    })('p');

    assert.equal(result, 'recovered', 'generator makes progress once the only key is unbanned');
    assert.ok(
      banWindow,
      '3 consecutive 429s must soft-ban the key (markError must not reset them)'
    );
    assert.equal(banWindow.until - banWindow.from, 180000);
    assert.ok(
      callTimes.slice(banWindow.callsBefore).every((t) => t >= banWindow.until),
      'no request may hit the key while it is banned'
    );
    assert.ok(callTimes.length > banWindow.callsBefore, 'requests resume after the ban');
    assert.ok(clock.now() >= banWindow.until, 'it waited for the earliest expiry');
    assert.ok(
      clock.sleeps.some((ms) => ms > 60000 && ms <= 180000),
      'the wait is the remaining ban time, not a busy loop'
    );
    assert.equal(manager.consecutive429.get(0), 0, 'success resets the streak');
  } finally {
    clock.restore();
  }
}

async function testAllKeysBannedStillTerminates() {
  const clock = createFakeClock();
  try {
    let calls = 0;
    const manager = createRealManager(2, async () => {
      calls += 1;
      throw httpError(429, QUOTA_BODY);
    });
    for (let keyIndex = 0; keyIndex < 2; keyIndex++) {
      manager.softBans.set(keyIndex, clock.now() + 100000 * (keyIndex + 1));
    }

    await assert.rejects(
      createRealGenerator(manager, clock, {
        configuredMaxRetries: 6,
        maxKeyWaitMs: 600000,
        maxTotalKeyWaitMs: 3600000,
      })('p'),
      /Вичерпано всі спроби запиту до Gemini/,
      'it must give up after maxRetries instead of looping forever'
    );
    assert.ok(calls <= 12, `bounded number of requests (${calls})`);
    assert.ok(clock.sleeps[0] === 100000, 'first wait is exactly the earliest ban expiry');
    assert.ok(
      clock.sleeps.every((ms) => ms > 0 && ms <= 600000),
      'every pause is finite'
    );
  } finally {
    clock.restore();
  }
}

async function testLongBanIsNotWaitedOutByDefault() {
  // Default caps: a long soft-ban means a real outage / exhausted daily quota. Waiting minutes per
  // batch would stall the whole job, so the generator fails fast like before instead of sleeping.
  const clock = createFakeClock();
  try {
    let calls = 0;
    const manager = createRealManager(2, async () => {
      calls += 1;
      throw httpError(429, QUOTA_BODY);
    });
    for (let keyIndex = 0; keyIndex < 2; keyIndex++) {
      manager.softBans.set(keyIndex, clock.now() + 600000);
    }
    await assert.rejects(
      createRealGenerator(manager, clock, { configuredMaxRetries: 6 })('p'),
      /Вичерпано всі спроби запиту до Gemini/
    );
    assert.ok(
      clock.sleeps.every((ms) => ms <= 1000),
      'a 10 min ban must not be slept through (only the 1 s model-switch pause remains)'
    );
    assert.ok(calls <= 12, `bounded number of requests (${calls})`);

    // a short cooldown (60-120 s) is worth waiting for, but never more than the per-call total
    const clock2 = createFakeClock();
    let calls2 = 0;
    const manager2 = createRealManager(1, async () => {
      calls2 += 1;
      if (calls2 <= 2) throw httpError(429, QUOTA_BODY);
      return { text: 'ok' };
    });
    const result = await createRealGenerator(manager2, clock2, { configuredMaxRetries: 6 })('p');
    assert.equal(result, 'ok');
    assert.ok(
      clock2.sleeps.every((ms) => ms <= 130000),
      'each wait is capped'
    );
    clock2.restore();
  } finally {
    clock.restore();
  }
}

// B: 503 is a model overload; it must not cool the key and trips a per-model breaker.
async function test503DoesNotCoolKeyAndBreakerFlipsToFallbackAndRecovers() {
  const clock = createFakeClock();
  try {
    const calls = [];
    let primaryHealthy = false;
    const manager = createRealManager(2, async ({ model }) => {
      calls.push(model === 'model-primary' ? 'P' : 'F');
      if (model === 'model-primary' && !primaryHealthy) throw httpError(503, OVERLOAD_BODY);
      return { text: `ok from ${model}` };
    });
    const generator = createRealGenerator(manager, clock);

    for (let index = 0; index < 3; index++) {
      assert.equal(await generator('p'), 'ok from model-fallback');
    }
    assert.deepEqual(
      calls,
      ['P', 'F', 'P', 'F', 'P', 'F'],
      'primary is still tried before the breaker opens'
    );
    assert.equal(manager.cooldowns.size, 0, '503 must not cool the key');
    assert.equal(manager.softBans.size, 0);
    assert.ok(manager.usageStats.every((s) => s.rateLimits === 0 && s.errors === 0));

    calls.length = 0;
    await generator('p');
    await generator('p');
    assert.deepEqual(calls, ['F', 'F'], 'after 3 consecutive 503s the primary model is skipped');

    clock.advance(91000);
    calls.length = 0;
    await generator('p');
    await generator('p');
    assert.deepEqual(
      calls,
      ['P', 'F', 'F'],
      'one probe after the window; a 503 re-opens it at once'
    );

    primaryHealthy = true;
    clock.advance(91000);
    calls.length = 0;
    assert.equal(await generator('p'), 'ok from model-primary');
    assert.deepEqual(calls, ['P'], 'a successful probe closes the breaker');

    primaryHealthy = false;
    calls.length = 0;
    for (let index = 0; index < 3; index++) await generator('p');
    await generator('p');
    assert.deepEqual(
      calls,
      ['P', 'F', 'P', 'F', 'P', 'F', 'F'],
      'after the reset it takes 3 fresh consecutive 503s to open again'
    );
    assert.equal(manager.cooldowns.size, 0);
  } finally {
    clock.restore();
  }
}

async function testFallbackListTriesEveryModelOnTheSameKey() {
  // FALLBACK_MODEL_NAME may list several models: primary -> first fallback -> second fallback, same key.
  const clock = createFakeClock();
  try {
    const seen = [];
    const manager = createRealManager(1, async ({ model }) => {
      seen.push(model);
      if (model !== 'model-third') throw httpError(503, OVERLOAD_BODY);
      return { text: 'from the third model' };
    });
    const result = await createRealGenerator(manager, clock, {
      fallbackModelName: ' model-fallback , model-third ,model-primary',
    })('p');
    assert.equal(result, 'from the third model');
    assert.deepEqual(seen, ['model-primary', 'model-fallback', 'model-third']);
    assert.equal(manager.cooldowns.size, 0, '503 does not cool the key');

    // a single name keeps working exactly as before
    const single = [];
    const manager2 = createRealManager(1, async ({ model }) => {
      single.push(model);
      if (model === 'model-primary') throw httpError(503, OVERLOAD_BODY);
      return { text: 'fallback ok' };
    });
    assert.equal(await createRealGenerator(manager2, clock)('p'), 'fallback ok');
    assert.deepEqual(single, ['model-primary', 'model-fallback']);
  } finally {
    clock.restore();
  }
}

async function testOverloadOnBothModelsStillDoesNotCoolKey() {
  const clock = createFakeClock();
  try {
    const manager = createRealManager(1, async () => {
      throw httpError(503, OVERLOAD_BODY);
    });
    await assert.rejects(
      createRealGenerator(manager, clock, { configuredMaxRetries: 3 })('p'),
      /Вичерпано всі спроби запиту до Gemini/
    );
    assert.equal(manager.cooldowns.size, 0);
    assert.equal(manager.softBans.size, 0);
    assert.equal(manager.usageStats[0].rateLimits, 0);
    assert.equal(manager.isInvalid(0), false);
  } finally {
    clock.restore();
  }
}

async function testQuotaOnPrimaryPlusOverloadOnFallbackStillCoolsKey() {
  const clock = createFakeClock();
  try {
    const manager = createRealManager(1, async ({ model }) => {
      throw model === 'model-primary' ? httpError(429, QUOTA_BODY) : httpError(503, OVERLOAD_BODY);
    });
    await assert.rejects(
      createRealGenerator(manager, clock, { configuredMaxRetries: 2 })('p'),
      /Вичерпано всі спроби запиту до Gemini/
    );
    assert.ok(manager.usageStats[0].rateLimits >= 1, 'a real 429 on the key is still recorded');
  } finally {
    clock.restore();
  }
}

// C(a): only truncation/blocking splits a batch; 429/503 retry the same batch.
const BATCH_CASES = [
  { caseNumber: 'A', id: 'A', url: 'https://reyestr.court.gov.ua/Review/1', body: 'тіло А' },
  { caseNumber: 'B', id: 'B', url: 'https://reyestr.court.gov.ua/Review/2', body: 'тіло Б' },
];

async function summarizeWith(generate) {
  const sizes = [];
  const sleeps = [];
  setBatchProcessorTestOverrides({
    generateContent: async (prompt) => {
      sizes.push((prompt.match(/--- Справа №/g) || []).length);
      return generate(sizes.length);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  try {
    return { result: await getBatchSummary(BATCH_CASES, 1, 1, null), sizes, sleeps };
  } finally {
    clearBatchProcessorTestOverrides();
  }
}

async function testOversizedRequest400SplitsTheBatch() {
  // A 400 "input token count exceeds the maximum" is cured by a smaller batch: split, do not fail the job.
  const { result, sizes } = await summarizeWith((callNo) => {
    if (callNo === 1) {
      throw httpError(
        400,
        'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).'
      );
    }
    return 'ok summary';
  });
  assert.deepEqual(sizes, [2, 1, 1], 'oversized request is halved');
  assert.match(result, /ok summary/);
}

async function testQuotaAndOverloadRetrySameBatchWithoutSplitting() {
  const failures = [
    () => httpError(429, QUOTA_BODY),
    () => httpError(503, OVERLOAD_BODY),
    () => new Error('Вичерпано всі спроби запиту до Gemini'),
    () => new Error('Gemini повернув порожню відповідь.'),
  ];
  for (const makeError of failures) {
    const { result, sizes, sleeps } = await summarizeWith(() => {
      throw makeError();
    });
    assert.deepEqual(sizes, [2, 2], 'same 2-case batch is retried once, never halved');
    assert.equal(sleeps.length, 1);
    assert.ok(
      sleeps[0] >= 16000 && sleeps[0] <= 24000,
      `retry pause is jittered 20s (${sleeps[0]})`
    );
    assert.match(result, /Частина справ не була проаналізована/);
    assert.match(result, /Review\/1/);
    assert.match(result, /Review\/2/);
  }

  const recovered = await summarizeWith((call) => {
    if (call === 1) throw httpError(503, OVERLOAD_BODY);
    return 'Резюме після повтору';
  });
  assert.equal(recovered.result, 'Резюме після повтору');
  assert.deepEqual(recovered.sizes, [2, 2]);
}

async function testTruncationAndBlockedStillSplitTheBatch() {
  const truncated = () =>
    Object.assign(new Error('Gemini обірвав відповідь по ліміту токенів'), { truncated: true });
  const blocked = () =>
    Object.assign(new Error('Gemini заблокував відповідь (finishReason=SAFETY).'), {
      blocked: true,
    });
  for (const makeError of [truncated, blocked]) {
    const { sizes, sleeps } = await summarizeWith(() => {
      throw makeError();
    });
    assert.deepEqual(sizes, [2, 1, 1], 'a truncated/blocked batch is halved');
    assert.equal(sleeps.length, 0, 'splitting needs no pause');
  }
}

async function testRequestErrorsAndLookalikeDigitsAreNotRetryable() {
  for (const makeError of [
    () =>
      httpError(
        400,
        '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'
      ),
    () => new Error('Prompt contains 1503 tokens and 4290 characters'),
  ]) {
    const sizes = [];
    setBatchProcessorTestOverrides({
      generateContent: async (prompt) => {
        sizes.push((prompt.match(/--- Справа №/g) || []).length);
        throw makeError();
      },
      sleep: async () => {},
    });
    try {
      await assert.rejects(() => getBatchSummary(BATCH_CASES, 1, 1, null));
    } finally {
      clearBatchProcessorTestOverrides();
    }
    assert.deepEqual(sizes, [2], 'a non-retryable error fails the batch right away');
  }
}

// C(b): backoff is capped at 60 s and jittered.
async function testNetworkBackoffIsCappedAndJittered() {
  async function collectDelays(random) {
    const sleeps = [];
    const apiKeyManager = createFakeApiKeyManager([
      async () => {
        throw new Error('fetch failed');
      },
    ]);
    const generator = createContentGenerator({
      apiKeyManager,
      cliProxyClient: null,
      enableCliProxy: false,
      modelName: 'model-primary',
      fallbackModelName: 'model-fallback',
      generationConfig: {},
      safetySettings: [],
      logger: silentLogger,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random,
      configuredMaxRetries: 9,
    });
    await assert.rejects(generator('p'), /fetch failed/);
    return sleeps;
  }

  assert.deepEqual(
    await collectDelays(() => 0.5),
    [20000, 40000, 50000, 50000, 50000, 50000, 50000, 50000],
    'exponential from 20 s, flat afterwards (old code reached 2560 s at attempt 8)'
  );
  const low = await collectDelays(() => 0);
  const high = await collectDelays(() => 0.999999);
  assert.equal(low[0], 16000, 'jitter -20 %');
  assert.ok(
    high.every((ms) => ms <= 60000),
    'jitter never pushes a delay past 60 s'
  );
  assert.equal(high.at(-1), 60000);
  const real = await collectDelays(Math.random);
  assert.ok(real.every((ms) => ms >= 16000 && ms <= 60000));
  assert.ok(new Set(real.slice(2)).size > 1, 'capped delays still differ from each other');
}

// C(c): statuses come from error.status; message digits alone do not count.
async function testStatusDetectionIgnoresDigitsInMessages() {
  const clock = createFakeClock();
  try {
    let calls = 0;
    const manager = createRealManager(3, async () => {
      calls += 1;
      throw httpError(400, 'Request has 500 tokens too many, see /Review/50300');
    });
    await assert.rejects(createRealGenerator(manager, clock)('p'), /500 tokens too many/);
    assert.equal(calls, 1, 'a 400 mentioning "500" is not an internal error and is not retried');
    assert.deepEqual(clock.sleeps, []);

    calls = 0;
    const lookalike = createRealManager(3, async () => {
      calls += 1;
      throw new Error('Prompt contains 1503 tokens');
    });
    await assert.rejects(createRealGenerator(lookalike, clock)('p'), /1503 tokens/);
    assert.equal(calls, 1, '"1503" is not a 503');
    assert.equal(lookalike.cooldowns.size, 0);

    // Without any structured status, a whole-word 500 in the message still counts.
    let attempt = 0;
    const noStatus = createRealManager(1, async () => {
      attempt += 1;
      if (attempt === 1) throw httpError(undefined, '{"error":{"code":500,"status":"INTERNAL"}}');
      return { text: 'ok after 500' };
    });
    assert.equal(await createRealGenerator(noStatus, clock)('p'), 'ok after 500');
    assert.equal(clock.sleeps.length, 1);
    assert.ok(clock.sleeps[0] >= 16000 && clock.sleeps[0] <= 24000);
  } finally {
    clock.restore();
  }
}

// C(d): only 401/403 or an explicit invalid-key message blacklists a key.
async function testPlainBadRequestDoesNotBlacklistKeys() {
  const clock = createFakeClock();
  try {
    let calls = 0;
    const manager = createRealManager(11, async () => {
      calls += 1;
      throw httpError(
        400,
        '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'
      );
    });
    await assert.rejects(createRealGenerator(manager, clock)('p'), /invalid argument/);
    assert.equal(calls, 1, 'the same bad payload must not walk through all keys');
    assert.equal(manager.invalidKeys.size, 0, 'a request error never blacklists a key');
  } finally {
    clock.restore();
  }
}

async function testDeadKeySignalsStillBlacklistTheKey() {
  const clock = createFakeClock();
  try {
    const signals = [
      httpError(
        400,
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'
      ),
      httpError(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}'),
      httpError(401, 'Unauthorized'),
      httpError(403, 'Forbidden'),
      httpError(undefined, '{"error":{"status":"PERMISSION_DENIED"}}'),
      httpError(undefined, 'API key not valid. Please pass a valid API key.'),
    ];
    for (const failure of signals) {
      const used = [];
      const manager = createRealManager(2, async ({ keyIndex }) => {
        used.push(keyIndex);
        if (keyIndex === 0) throw failure;
        return { text: 'healthy key answered' };
      });
      assert.equal(await createRealGenerator(manager, clock)('p'), 'healthy key answered');
      assert.equal(
        manager.isInvalid(0),
        true,
        `blacklisted: ${failure.status} ${failure.message.slice(0, 40)}`
      );
      assert.deepEqual(used, [0, 1]);
    }
  } finally {
    clock.restore();
  }
}

async function run() {
  await testGenerateContentTriesAllKeys();
  await testCustomPromptFallsBackOnRetryableGeminiError();
  await testPermissionDeniedKeyIsRemovedFromRotation();
  await testHardQuotaErrorCooldownsKeyInsteadOfInvalidating();
  await testCustomFinalAnalysisRepairsMissingCaseCoverage();
  await testCoverageRepairKeepsReportAndListsUncoveredCases();
  await testCoverageRepairCallFailureKeepsDraft();
  await testNonCoverageFinalAnalysisErrorsStayFatal();
  await testReservationsSpreadAcrossIdleKeys();
  await testReservationsSkipCooledSoftBannedAndInvalidKeys();
  await testSoftBanAccumulatesExpiresAndResetsOnSuccess();
  await testGeneratorSoftBansAfterThreeQuotaFailuresAndWaitsWhenAllKeysBanned();
  await testAllKeysBannedStillTerminates();
  await testLongBanIsNotWaitedOutByDefault();
  await testFallbackListTriesEveryModelOnTheSameKey();
  await testOversizedRequest400SplitsTheBatch();
  await test503DoesNotCoolKeyAndBreakerFlipsToFallbackAndRecovers();
  await testOverloadOnBothModelsStillDoesNotCoolKey();
  await testQuotaOnPrimaryPlusOverloadOnFallbackStillCoolsKey();
  await testQuotaAndOverloadRetrySameBatchWithoutSplitting();
  await testTruncationAndBlockedStillSplitTheBatch();
  await testRequestErrorsAndLookalikeDigitsAreNotRetryable();
  await testNetworkBackoffIsCappedAndJittered();
  await testStatusDetectionIgnoresDigitsInMessages();
  await testPlainBadRequestDoesNotBlacklistKeys();
  await testDeadKeySignalsStillBlacklistTheKey();
  console.log('Gemini retry regressions passed.');
}

run();
