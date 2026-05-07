#!/usr/bin/env node

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

process.env.JOB_COOKIE_CACHE_TTL_MS = '25';

const { default: jobQueue } = await import('../queue.js');

jobQueue.clearAllCookies();
jobQueue.enqueue({ jobId: 'ttl-job', cookie: 'court-session=secret' });

assert.equal(jobQueue.getCachedCookie('ttl-job'), 'court-session=secret');
assert.equal(jobQueue.getCachedJobsCount(), 1);

await delay(60);

assert.equal(jobQueue.getCachedCookie('ttl-job'), null, 'expired cookies should not be returned');
assert.equal(jobQueue.getCachedJobsCount(), 0, 'expired cookies should be removed from cache');

jobQueue.clearAllCookies();
console.log('Queue cookie cache regressions passed.');
