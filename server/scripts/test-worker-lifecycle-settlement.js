#!/usr/bin/env node

// Worker lifecycle regressions: every terminal event settles a worker exactly once (entry removed,
// thread terminated, queue slot released), and nothing a settled worker does afterwards can touch
// the slot or the status of a newer job. Offline: fake workers, stubbed DB-facing services.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

// connection.js needs DATABASE_URL at import time; the pool never connects in this test.
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/edrsr_test_worker_lifecycle';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

const { default: jobQueue } = await import('../queue.js');
const { default: queueService } = await import('../services/queueService.js');
const { default: jobWriteService } = await import('../services/jobWriteService.js');
const { createWorkerLifecycleService } = await import('../services/workerLifecycleService.js');

// --- instrumentation -------------------------------------------------------------------------
let releases = 0;
const realEndProcessing = jobQueue.endProcessing.bind(jobQueue);
jobQueue.endProcessing = () => {
  releases += 1;
  realEndProcessing();
};
const lockClears = [];
queueService.clearJobLock = async (jobId) => {
  lockClears.push(jobId);
};
const statusWrites = [];
jobWriteService.updateJobStatus = async (jobId, status) => {
  statusWrites.push([jobId, status]);
  return null; // "job not found": skips the websocket push
};

let pumps = 0;
const activeWorkers = new Map();
const lifecycle = createWorkerLifecycleService({
  activeWorkers,
  processQueue: () => {
    pumps += 1;
  },
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Like the real thread: terminate() ends it and 'exit' fires with code 1.
function fakeWorker() {
  const worker = new EventEmitter();
  worker.posted = [];
  worker.terminateCalls = 0;
  worker.postMessage = (message) => worker.posted.push(message);
  worker.terminate = () => {
    worker.terminateCalls += 1;
    setImmediate(() => worker.emit('exit', 1));
    return Promise.resolve(1);
  };
  return worker;
}

// Mirrors what startWorker() in routes/index.js does with a new worker.
function register(jobId, worker = fakeWorker()) {
  const info = { worker, startTime: Date.now(), jobId, status: 'running' };
  activeWorkers.set(jobId, info);
  worker.on('exit', (code) => lifecycle.handleWorkerExit(info, code));
  return info;
}

function reset() {
  activeWorkers.clear();
  jobQueue.isProcessing = false;
  releases = 0;
  pumps = 0;
  lockClears.length = 0;
  statusWrites.length = 0;
}

// Run `fn` with setTimeout captured, so the 3 s force-terminate fallback can be fired by hand.
function captureTimers(fn) {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms) => {
    timers.push({ callback, ms });
    return 0;
  };
  try {
    fn();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  return timers;
}

// 1. terminate after success / error / cancel; slot released once, also after the exit(1) of terminate()
for (const status of ['completed', 'error', 'cancelled']) {
  reset();
  assert.equal(jobQueue.tryReserve(), true);
  const info = register('job-a');
  const order = [];
  info.worker.on('exit', () => order.push('exit'));

  const finished = await lifecycle.finishWorker(info, status, async () => {
    order.push('finalize');
    assert.equal(info.worker.terminateCalls, 0, 'terminate must wait until the message is handled');
    assert.equal(releases, 0, 'slot must stay held while the final status is written');
  });

  assert.equal(finished, true);
  assert.equal(info.worker.terminateCalls, 1, `${status}: worker must be terminated`);
  assert.equal(releases, 1, `${status}: slot released once`);
  assert.equal(pumps, 1, `${status}: queue pumped once`);
  assert.equal(jobQueue.isIdle(), true);
  assert.equal(activeWorkers.has('job-a'), false, `${status}: entry removed`);
  assert.equal(info.status, status);

  await flush(); // the exit(1) caused by our own terminate()
  assert.deepEqual(order, ['finalize', 'exit']);
  assert.equal(releases, 1, `${status}: exit(1) after terminate() must not release again`);
  assert.equal(pumps, 1);
  assert.equal(lockClears.length, 0, 'exit after settle must not clear the lock again');
  assert.equal(info.status, status, 'exit after settle must not rewrite the status');
}

// 2. duplicate terminal events (jobSuccess + trailing jobError + 'error' event) settle only once
reset();
jobQueue.tryReserve();
{
  const info = register('job-a');
  let finalizeRuns = 0;
  const finalize = async () => {
    finalizeRuns += 1;
    await flush();
  };
  const results = await Promise.all([
    lifecycle.finishWorker(info, 'completed', finalize),
    lifecycle.finishWorker(info, 'error', finalize),
    lifecycle.finishWorker(info, 'cancelled', finalize),
  ]);
  assert.deepEqual(results, [true, false, false]);
  assert.equal(finalizeRuns, 1);
  assert.equal(releases, 1);
  assert.equal(info.worker.terminateCalls, 1);
  assert.equal(info.status, 'completed');
}

// 3. crash: 'exit' with no terminal message releases once; a following 'error' event adds nothing
reset();
jobQueue.tryReserve();
{
  const info = register('job-a');
  info.worker.emit('exit', 1);
  await flush();
  assert.equal(activeWorkers.has('job-a'), false, 'crashed worker must not stay as a ghost entry');
  assert.equal(releases, 1);
  assert.equal(pumps, 1);
  assert.deepEqual(lockClears, ['job-a']);
  assert.equal(info.status, 'crashed');
  assert.equal(await lifecycle.finishWorker(info, 'error', async () => assert.fail('late')), false);
  info.worker.emit('exit', 1);
  await flush();
  assert.equal(releases, 1);
}

// 3b. 'error' event first, then its exit(1): one release (by the error path), not two
reset();
jobQueue.tryReserve();
{
  const info = register('job-a');
  await lifecycle.finishWorker(info, 'error', async () => {
    await queueService.clearJobLock('job-a');
  });
  info.worker.emit('exit', 1);
  await flush();
  assert.equal(releases, 1);
  assert.deepEqual(lockClears, ['job-a']);
}

// 3c. a failing finalize must not leak the slot or the thread
reset();
jobQueue.tryReserve();
{
  const info = register('job-a');
  await lifecycle.finishWorker(info, 'error', async () => {
    throw new Error('db down');
  });
  assert.equal(releases, 1);
  assert.equal(info.worker.terminateCalls, 1);
  assert.equal(jobQueue.isIdle(), true);
}

// 4. a late message / exit from a settled worker does not touch a newer job under the same id
reset();
jobQueue.tryReserve();
{
  const oldInfo = register('job-a');
  await lifecycle.finishWorker(oldInfo, 'completed', async () => {});
  await flush();
  assert.equal(releases, 1);

  // retry of the same job: new reservation, new worker under the same jobId
  assert.equal(jobQueue.tryReserve(), true);
  const newInfo = register('job-a');
  const releasesBefore = releases;
  const statusWritesBefore = statusWrites.length;

  assert.equal(lifecycle.isActiveWorker(oldInfo), false, 'old worker is no longer the active one');
  assert.equal(lifecycle.isActiveWorker(newInfo), true);
  assert.equal(
    await lifecycle.finishWorker(oldInfo, 'error', async () => {
      statusWrites.push(['job-a', 'error']);
    }),
    false
  );
  oldInfo.worker.emit('exit', 1);
  oldInfo.worker.emit('exit', 0);
  await flush();

  assert.equal(releases, releasesBefore, 'old worker must not release the new job slot');
  assert.equal(statusWrites.length, statusWritesBefore, 'old worker must not write a status');
  assert.equal(jobQueue.isIdle(), false, 'new job still owns the slot');
  assert.equal(activeWorkers.get('job-a'), newInfo, 'new entry untouched');
  assert.equal(newInfo.status, 'running');
  assert.equal(newInfo.worker.terminateCalls, 0);
}

// 5. ghost entries: no entry survives a crash, and a pending force-terminate timer of a settled
//    worker cannot free the slot of another job (identity check, not just jobId)
reset();
jobQueue.tryReserve();
{
  const workerA = register('job-a');
  let timers;
  timers = captureTimers(() => assert.equal(lifecycle.forceTerminateWorker('job-a', 'test'), true));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 3000);
  assert.equal(workerA.worker.posted[0].type, 'cancelJob');

  // A crashes before the timer fires; job B takes over the slot
  workerA.worker.emit('exit', 1);
  await flush();
  assert.equal(activeWorkers.has('job-a'), false);
  assert.equal(releases, 1);
  assert.equal(lifecycle.forceTerminateWorker('job-a', 'again'), false, 'no ghost to terminate');

  assert.equal(jobQueue.tryReserve(), true);
  const workerB = register('job-b');
  timers[0].callback(); // the stale 3 s timer of A fires now
  await flush();
  assert.equal(releases, 1, 'stale timer must not release the slot of job B');
  assert.equal(jobQueue.isIdle(), false);
  assert.equal(workerB.worker.terminateCalls, 0);
  assert.equal(activeWorkers.get('job-b'), workerB);
  assert.equal(statusWrites.length, 0, 'stale timer must not mark anything force-terminated');

  // same jobId, newer worker (retry): the timer of the old worker must not kill it either
  reset();
  jobQueue.tryReserve();
  const first = register('job-c');
  timers = captureTimers(() => lifecycle.forceTerminateWorker('job-c', 'test'));
  await lifecycle.finishWorker(first, 'cancelled', async () => {});
  jobQueue.tryReserve();
  const second = register('job-c');
  timers[0].callback();
  await flush();
  assert.equal(second.worker.terminateCalls, 0);
  assert.equal(activeWorkers.get('job-c'), second);
  assert.equal(releases, 1);
  assert.equal(jobQueue.isIdle(), false);
  assert.equal(statusWrites.length, 0, 'must not mark the retried job as force-terminated');
  assert.equal(lockClears.length, 0, 'must not clear the lock of the retried job');
}

// 6. cancel answered by the worker (jobCancelled): terminated once, the 3 s fallback is a no-op
reset();
jobQueue.tryReserve();
{
  const info = register('job-a');
  const timers = captureTimers(() => lifecycle.forceTerminateWorker('job-a', 'user cancel'));
  await lifecycle.finishWorker(info, 'cancelled', async () => {});
  await flush();
  assert.equal(info.worker.terminateCalls, 1);
  timers[0].callback();
  await flush();
  assert.equal(info.worker.terminateCalls, 1, 'fallback must not terminate twice');
  assert.equal(releases, 1);
  assert.equal(statusWrites.length, 0, 'fallback must not mark the job force-terminated again');
}

// 7. worker ignores the cancel signal: after 3 s it is terminated, the slot released once
reset();
jobQueue.tryReserve();
{
  const info = register('job-a');
  const timers = captureTimers(() => lifecycle.forceTerminateWorker('job-a', 'stuck'));
  timers[0].callback();
  await flush();
  assert.equal(info.worker.terminateCalls, 1);
  assert.equal(releases, 1);
  assert.equal(pumps, 1);
  assert.equal(activeWorkers.has('job-a'), false);
  assert.equal(info.status, 'force_terminated');
  assert.deepEqual(statusWrites, [['job-a', 'error']], 'job marked as error once');
  assert.deepEqual(lockClears, ['job-a']);
  await flush(); // exit(1) from terminate()
  assert.equal(releases, 1);
  assert.equal(pumps, 1);
}

// 8. a real worker thread: terminate() really stops it, exits with code 1, and that exit is a no-op
reset();
jobQueue.tryReserve();
{
  const thread = new Worker(
    `const { parentPort } = require('node:worker_threads');
     setInterval(() => {}, 30000);
     parentPort.on('message', () => {});
     parentPort.postMessage('ready');`,
    { eval: true }
  );
  await new Promise((resolve) => thread.once('message', resolve));
  assert.ok(thread.threadId > 0, 'thread is alive while idle (this is what leaked before)');

  const exitCodes = [];
  thread.on('exit', (code) => exitCodes.push(code));
  const info = register('job-real', thread);

  await lifecycle.finishWorker(info, 'completed', async () => {});
  await new Promise((resolve) =>
    thread.threadId === -1 ? resolve() : thread.once('exit', resolve)
  );
  await flush();

  assert.deepEqual(exitCodes, [1], 'terminate() makes the thread exit with a non-zero code');
  assert.equal(thread.threadId, -1, 'thread is gone');
  assert.equal(releases, 1, 'non-zero exit caused by terminate() must not release the slot again');
  assert.equal(pumps, 1);
  assert.equal(lockClears.length, 0);
}

// 9. wiring pins (routes/index.js cannot be loaded offline: it spawns real workers and needs Supabase)
const read = (relativePath) => fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
const indexSource = read('routes/index.js');
const lifecycleSource = read('services/workerLifecycleService.js');
const startWorkerBody = indexSource.slice(
  indexSource.indexOf('function startWorker('),
  indexSource.indexOf('async function processQueue()')
);
const messageHandler = startWorkerBody.slice(
  startWorkerBody.indexOf("worker.on('message'"),
  startWorkerBody.indexOf("worker.on('error'")
);

assert.ok(startWorkerBody.length > 500, 'startWorker body located');
assert.ok(
  messageHandler.indexOf('if (!isActiveWorker(workerInfo)) return;') !== -1 &&
    messageHandler.indexOf('if (!isActiveWorker(workerInfo)) return;') <
      messageHandler.indexOf("msg.type === 'statusUpdate'"),
  'message handler must drop messages from a worker that is no longer registered, before anything else'
);
for (const [type, status] of [
  ['jobSuccess', 'completed'],
  ['jobError', 'error'],
  ['jobCancelled', 'cancelled'],
]) {
  const branch = messageHandler.slice(messageHandler.indexOf(`msg.type === '${type}'`));
  assert.match(
    branch.slice(0, branch.indexOf('} else if') === -1 ? undefined : branch.indexOf('} else if')),
    new RegExp(`finishWorker\\(workerInfo, '${status}'`),
    `${type} must settle through finishWorker`
  );
}
assert.match(
  startWorkerBody,
  /worker\.on\('error', async \(error\) => \{[\s\S]*?finishWorker\(workerInfo, 'error'/
);
assert.match(
  startWorkerBody,
  /worker\.on\('exit', \(code\) => handleWorkerExit\(workerInfo, code\)\)/
);
assert.doesNotMatch(
  startWorkerBody,
  /endProcessing\(|activeWorkers\.delete\(|activeWorkers\.get\(/,
  'startWorker must not release the slot or edit/lookup the registry itself'
);
assert.equal(
  lifecycleSource.split('activeWorkers.delete(').length - 1,
  1,
  'the registry entry is removed in exactly one place (finishWorker)'
);
assert.equal(lifecycleSource.split('jobQueue.endProcessing(').length - 1, 1, 'single slot release');
assert.doesNotMatch(lifecycleSource, /releaseQueueIfNeeded/);
assert.match(indexSource, /jobQueryService\.getJobLinksLight\(claimed\.id/);
assert.doesNotMatch(indexSource, /jobQueryService\.getJobLinks\(/);

console.log('Worker lifecycle settlement regressions passed.');
