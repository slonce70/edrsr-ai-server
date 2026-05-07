#!/usr/bin/env node

import assert from 'node:assert/strict';

import { getClientIp, getTrustProxySetting } from '../utils.js';

delete process.env.TRUST_PROXY_HOPS;
delete process.env.TRUST_PROXY_CIDRS;

assert.equal(
  getTrustProxySetting(),
  false,
  'proxy trust should default to false unless explicitly configured'
);

assert.equal(
  getClientIp({
    headers: {
      'x-forwarded-for': '203.0.113.10',
      'x-real-ip': '203.0.113.11',
    },
    ip: '10.0.0.5',
    socket: { remoteAddress: '10.0.0.6' },
  }),
  '10.0.0.5',
  'untrusted forwarded headers should not override req.ip'
);

process.env.TRUST_PROXY_HOPS = '1';
assert.equal(getTrustProxySetting(), 1, 'numeric proxy hop setting should be supported');
assert.equal(
  getClientIp({
    headers: { 'x-forwarded-for': '198.51.100.200, 203.0.113.10' },
    ip: '10.0.0.5',
  }),
  '10.0.0.5',
  'trusted proxy mode should use Express-computed req.ip instead of parsing spoofable header values'
);

delete process.env.TRUST_PROXY_HOPS;
process.env.TRUST_PROXY_CIDRS = 'loopback, linklocal, uniquelocal';
assert.equal(
  getTrustProxySetting(),
  'loopback, linklocal, uniquelocal',
  'CIDR proxy trust setting should be supported'
);

console.log('Proxy IP regressions passed.');
