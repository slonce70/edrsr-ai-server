#!/usr/bin/env node

// SCRAPER_PROXY_URL routes requests to the court registry through an HTTP proxy and is a no-op when unset.
// Offline: a local fake proxy records what it receives.

import assert from 'node:assert/strict';
import http from 'node:http';
import got from 'got';
import { getScraperAgent } from '../scraperProxy.js';

// 1. unset / blank -> no agent (default behaviour is unchanged)
assert.equal(getScraperAgent({}), undefined);
assert.equal(getScraperAgent({ SCRAPER_PROXY_URL: '   ' }), undefined);

// 2. only http(s) proxy URLs are accepted
assert.throws(() => getScraperAgent({ SCRAPER_PROXY_URL: 'socks5://127.0.0.1:1080' }), /http/);

// 3. a configured proxy gives both agents, reused for the same URL
const env = { SCRAPER_PROXY_URL: 'http://127.0.0.1:9' };
const agent = getScraperAgent(env);
assert.ok(agent.http && agent.https);
assert.equal(getScraperAgent(env), agent, 'agent is reused');

// 4. plain HTTP request goes to the proxy with the absolute target URL
const seen = { requests: [], connects: [] };
const proxy = http.createServer((req, res) => {
  seen.requests.push(`${req.method} ${req.url}`);
  res.end('via proxy');
});
proxy.on('connect', (req, socket) => {
  seen.connects.push(req.url);
  socket.destroy();
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
const viaProxy = getScraperAgent({ SCRAPER_PROXY_URL: proxyUrl });

const plain = await got('http://registry.test/Review/1', {
  agent: viaProxy,
  retry: { limit: 0 },
  timeout: { request: 3000 },
});
assert.equal(plain.body, 'via proxy');
assert.deepEqual(seen.requests, ['GET http://registry.test/Review/1']);

// 5. HTTPS goes through CONNECT to host:443 (the fake proxy then drops it, which is fine here)
await assert.rejects(
  got('https://reyestr.court.gov.ua/Review/1', {
    agent: viaProxy,
    retry: { limit: 0 },
    timeout: { request: 3000 },
  })
);
assert.deepEqual(seen.connects, ['reyestr.court.gov.ua:443']);

proxy.close();
console.log('Scraper proxy regressions passed.');
process.exit(0);
