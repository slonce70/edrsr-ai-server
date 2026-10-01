#!/usr/bin/env node

// The stall detector in worker.js must not kill a healthy AI phase: progress reported while Gemini
// is analysing counts as progress, not only download progress. worker.js is a script that starts a
// job on import, so its real source is run here with the thread/timer/clock/IO globals replaced.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');

const startCall = /^processJobInWorker\(jobId, links, cookie, prompt\);\s*$/m;
assert.match(source, startCall, 'worker.js must still start the job from workerData');
const body = `'use strict';\n${source
  .replace(/^import .*;$/gm, '')
  .replace(startCall, 'return processJobInWorker(jobId, links, cookie, prompt);')}`;
assert.doesNotMatch(body, /^import /m);

const runWorkerSource = new Function(
  'parentPort',
  'workerData',
  'dbService',
  'downloadAll',
  'analyzeCases',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
  'Date',
  'console',
  body
);

const MIN = 60 * 1000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

// `analyze` plays Gemini: it can advance the fake clock, report progress and trigger stall checks.
async function runJob({ afterDownloadMs = 0, analyze }) {
  const clock = { now: 1_000_000 };
  const posted = [];
  const intervals = [];
  let timerId = 0;
  let messageListener = () => {};

  const parentPort = {
    on: (event, listener) => {
      if (event === 'message') messageListener = listener;
    },
    postMessage: (message) => {
      posted.push(message);
      if (message.type === 'statusUpdate') {
        Promise.resolve().then(() =>
          messageListener({ type: 'statusUpdateAck', requestId: message.requestId })
        );
      }
    },
  };
  const workerData = { jobId: 'job-1', links: [{ url: 'u1' }], cookie: 'c', prompt: 'p' };
  const dbService = { updateLinkStatus: async () => {}, saveJobResult: async () => {} };
  const downloadAll = async (urls, cookie, onProgress) => {
    clock.now += 1000;
    await onProgress(1); // the last download progress the stall detector ever sees
    clock.now += afterDownloadMs;
    return [{ url: 'u1', caseNumber: '1', body: 'text' }];
  };
  const runStallChecks = async () => {
    for (const tick of intervals) tick();
    await flush();
  };
  const analyzeCases = (cases, prompt, onStatus) => analyze({ clock, onStatus, runStallChecks });
  const silentConsole = { log() {}, warn() {}, error() {} };

  await runWorkerSource(
    parentPort,
    workerData,
    dbService,
    downloadAll,
    analyzeCases,
    (tick) => {
      intervals.push(tick);
      return ++timerId;
    },
    () => {},
    () => ++timerId,
    () => {},
    { now: () => clock.now },
    silentConsole
  );
  return posted.filter((m) => m.type === 'jobSuccess' || m.type === 'jobError');
}

// 1. AI phase keeps reporting progress: 19 min + 19 min after the last download progress is fine
{
  const terminal = await runJob({
    analyze: async ({ clock, onStatus, runStallChecks }) => {
      clock.now += 19 * MIN;
      onStatus('Паралельна обробка: 1/2');
      await flush();
      clock.now += 19 * MIN;
      await runStallChecks();
      return 'REPORT';
    },
  });
  assert.deepEqual(
    terminal.map((m) => m.type),
    ['jobSuccess'],
    'healthy AI phase must not be reported as stalled'
  );
}

// 2. the AI phase itself starting counts as progress (download + save may take a while)
{
  const terminal = await runJob({
    afterDownloadMs: 10 * MIN,
    analyze: async ({ clock, runStallChecks }) => {
      clock.now += 15 * MIN;
      await runStallChecks();
      return 'REPORT';
    },
  });
  assert.deepEqual(
    terminal.map((m) => m.type),
    ['jobSuccess']
  );
}

// 3. control: an AI phase that really goes silent for more than 20 min is still reported as stalled
{
  const terminal = await runJob({
    analyze: async ({ clock, runStallChecks }) => {
      clock.now += 21 * MIN;
      await runStallChecks();
      return 'REPORT';
    },
  });
  const stalled = terminal.find((m) => m.type === 'jobError');
  assert.ok(stalled, 'stall detector must still fire without any progress');
  assert.match(stalled.payload.errorMessage, /зависло/);
}

console.log('Worker stall progress regressions passed.');
