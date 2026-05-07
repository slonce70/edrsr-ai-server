#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  WS_MAX_FIELD_LENGTHS,
  parseWsClientMessage,
  sanitizeWsLogValue,
  validateWsClientMessage,
} from '../services/wsMessageValidator.js';

const heartbeat = parseWsClientMessage(JSON.stringify({ type: 'heartbeat' }));
assert.deepEqual(heartbeat, { ok: true, data: { type: 'heartbeat' } });

assert.equal(
  validateWsClientMessage({ type: 'auth', token: 'short' }).ok,
  false,
  'short auth tokens should be rejected'
);

assert.equal(
  validateWsClientMessage({ type: 'auth', token: 'x'.repeat(WS_MAX_FIELD_LENGTHS.token + 1) }).ok,
  false,
  'oversized auth tokens should be rejected'
);

assert.equal(
  validateWsClientMessage({
    type: 'subscribe',
    jobId: 'j'.repeat(WS_MAX_FIELD_LENGTHS.id + 1),
  }).ok,
  false,
  'oversized job ids should be rejected'
);

assert.equal(
  validateWsClientMessage({
    type: 'subscribe',
    jobId: 'job-1',
    workspaceId: 'w'.repeat(WS_MAX_FIELD_LENGTHS.id + 1),
  }).ok,
  false,
  'oversized workspace ids should be rejected'
);

const malformed = parseWsClientMessage('{'.repeat(512));
assert.equal(malformed.ok, false, 'malformed JSON should be rejected');
assert.ok(
  sanitizeWsLogValue('{'.repeat(512)).length < 160,
  'malformed payload logs should be truncated'
);

console.log('WebSocket message hardening regressions passed.');
