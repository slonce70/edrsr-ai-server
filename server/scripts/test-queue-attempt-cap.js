#!/usr/bin/env node

// A job that keeps coming back (crash loop -> recovery -> re-queue) must stop after the same
// claim limit (5), be marked 'error' and not be claimed again. Offline: the
// database singleton is replaced by a tiny in-memory fake that understands the queue statements.

import assert from 'node:assert/strict';

// connection.js needs DATABASE_URL at import time; the pool never connects in this test.
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/edrsr_test_attempt_cap';

const database = (await import('../database/connection.js')).default;
const queueService = (await import('../services/queueService.js')).default;

let jobs = [];
const statements = [];

database.run = async (sql, params = []) => {
  statements.push({ sql, params });
  if (/SET status = 'error'/.test(sql) && /attempt, 0\) >= \$1/.test(sql)) {
    const [limit, message] = params;
    let changes = 0;
    for (const job of jobs) {
      if (['queued', 'retrying'].includes(job.status) && (job.attempt ?? 0) >= limit) {
        Object.assign(job, { status: 'error', error_message: message, locked_by: null });
        changes += 1;
      }
    }
    return { changes };
  }
  if (
    /SET status = 'retrying'/.test(sql) &&
    /WHERE status = 'error'/.test(sql) &&
    /attempt, 0\) < \$1/.test(sql)
  ) {
    let changes = 0;
    for (const job of jobs) {
      if (
        job.status === 'error' &&
        (job.attempt ?? 0) < params[0] &&
        /timeout/.test(job.error_message || '')
      ) {
        job.status = 'retrying';
        changes += 1;
      }
    }
    return { changes };
  }
  throw new Error(`unexpected run(): ${sql}`);
};

database.get = async (sql, params = []) => {
  statements.push({ sql, params });
  if (/pg_try_advisory_xact_lock/.test(sql)) {
    assert.match(sql, /COALESCE\(attempt, 0\) < \$2/, 'claim must skip jobs at the attempt limit');
    const [workerId, limit] = params;
    const job = jobs.find(
      (j) => ['queued', 'retrying'].includes(j.status) && (j.attempt ?? 0) < limit
    );
    if (!job) return undefined;
    Object.assign(job, {
      status: 'processing',
      locked_by: workerId,
      attempt: (job.attempt ?? 0) + 1,
    });
    return { id: job.id, prompt: 'p', user_id: 'u1' };
  }
  if (/SET status = 'retrying'/.test(sql)) {
    const job = jobs.find((j) => j.id === params[0]);
    if (!job) return undefined;
    // manualRetryJob only touches errored jobs; requeueJob touches any
    if (/status = 'error'/.test(sql) && job.status !== 'error') return undefined;
    Object.assign(job, { status: 'retrying' });
    if (/attempt = 0/.test(sql)) job.attempt = 0;
    return { id: job.id };
  }
  throw new Error(`unexpected get(): ${sql}`);
};

// 1. normal flow: a fresh job is claimed and its attempt counter goes up
jobs = [{ id: 'fresh', status: 'queued', attempt: 0 }];
let claimed = await queueService.claimNextJob('w1');
assert.equal(claimed?.id, 'fresh');
assert.equal(jobs[0].status, 'processing');
assert.equal(jobs[0].attempt, 1);

// 2. crash loop: the job is re-queued by recovery each time; it gets exactly 5 runs in total
jobs = [{ id: 'crasher', status: 'queued', attempt: 0 }];
let runs = 0;
for (let i = 0; i < 10; i += 1) {
  claimed = await queueService.claimNextJob('w1');
  if (!claimed) break;
  runs += 1;
  jobs[0].status = 'retrying'; // what recoverStuckJobs / recoverJobsAfterServerRestart do
}
assert.equal(runs, 5, 'job must be claimed at most 5 times');
assert.equal(jobs[0].status, 'error', 'job past the limit must be marked error, not left retrying');
assert.equal(jobs[0].attempt, 5);
assert.match(jobs[0].error_message, /Завдання зупинено/);
assert.match(jobs[0].error_message, /\(5\)/);
assert.equal(await queueService.claimNextJob('w1'), null, 'never claimed again');
assert.equal(jobs[0].status, 'error');

// 3. an exhausted job does not block the queue: the next job is still claimed in the same call
jobs = [
  { id: 'exhausted', status: 'retrying', attempt: 5, created_at: 1 },
  { id: 'next', status: 'queued', attempt: 0, created_at: 2 },
];
claimed = await queueService.claimNextJob('w1');
assert.equal(claimed?.id, 'next');
assert.equal(jobs[0].status, 'error');
assert.equal(jobs[1].status, 'processing');

// 4. the cap message does not match the auto-retry error patterns, and auto-retry keeps its own, lower limit
const capMessage = jobs[0].error_message;
for (const pattern of [
  /timeout/,
  /зависла/,
  /превысил/,
  /network/,
  /ECONN/,
  /ENET/,
  /50[23]/,
  /fetch failed/,
]) {
  assert.doesNotMatch(capMessage, pattern, `cap message must not look like a transient error`);
}
jobs = [
  { id: 'transient-2', status: 'error', attempt: 2, error_message: 'timeout' },
  { id: 'transient-3', status: 'error', attempt: 3, error_message: 'timeout' },
];
assert.equal(await queueService.retryFailedJobs(), 1, 'retryFailedJobs keeps its limit of 3');
assert.equal(jobs[0].status, 'retrying');
assert.equal(jobs[1].status, 'error');
const retrySql = statements.filter((s) => /WHERE status = 'error'/.test(s.sql)).at(-1);
assert.deepEqual(retrySql.params, [3], 'retryFailedJobs limit comes from its own constant');

// 5. explicit operator retries get a fresh budget instead of being failed again immediately
jobs = [{ id: 'manual', status: 'error', attempt: 3, error_message: 'x' }];
assert.equal(await queueService.manualRetryJob('manual'), true);
assert.equal(jobs[0].attempt, 0);
claimed = await queueService.claimNextJob('w1');
assert.equal(claimed?.id, 'manual', 'manual retry of a capped job must be claimable again');

jobs = [{ id: 'requeued', status: 'error', attempt: 3, error_message: 'x' }];
assert.equal(await queueService.requeueJob('requeued'), true);
assert.equal(jobs[0].attempt, 0);
claimed = await queueService.claimNextJob('w1');
assert.equal(claimed?.id, 'requeued');

// 6. a failing sweep must not stop claiming
{
  const realRun = database.run;
  jobs = [{ id: 'ok', status: 'queued', attempt: 0 }];
  database.run = async () => {
    throw new Error('db hiccup');
  };
  claimed = await queueService.claimNextJob('w1');
  assert.equal(claimed?.id, 'ok');
  database.run = realRun;
}

console.log('Queue attempt cap regressions passed.');
