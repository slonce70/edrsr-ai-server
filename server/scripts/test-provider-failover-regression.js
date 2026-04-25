import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CLIProxyClient } from '../cliProxyClient.js';

async function testCliProxyAuthUnavailableCooldown() {
  const client = new CLIProxyClient('https://example.test', ['token-1'], 2);
  let fetchCalls = 0;

  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 503,
      async text() {
        return '{"error":{"message":"auth_unavailable: no auth available"}}';
      },
    };
  };

  try {
    await assert.rejects(
      client.generateContent({
        model: 'gemini-3-pro-preview',
        contents: 'ping',
        config: { maxOutputTokens: 8 },
      }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.providerUnavailable, true);
        return true;
      }
    );

    await assert.rejects(
      client.generateContent({
        model: 'gemini-3-pro-preview',
        contents: 'ping',
        config: { maxOutputTokens: 8 },
      }),
      (error) => {
        assert.equal(error.providerUnavailable, true);
        assert.match(error.message, /provider unavailable/i);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 1, 'provider cooldown should prevent repeated proxy fetches');
}

function testBlankFallbackDisablesFallback() {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const probe = [
    "process.env.GEMINI_API_KEY='AIzaSyRegressionFallbackabcdefghijklmnopqrstu';",
    "process.env.MODEL_NAME='gemini-2.5-flash';",
    "process.env.FALLBACK_MODEL_NAME='';",
    "const config = await import('./config.js');",
    'console.log(JSON.stringify({ fallback: config.FALLBACK_MODEL_NAME }));',
  ].join('');

  const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd,
    env: { ...process.env },
  })
    .toString()
    .trim()
    .split('\n')
    .pop();

  const parsed = JSON.parse(output);
  assert.equal(parsed.fallback, '', 'blank FALLBACK_MODEL_NAME should disable fallback');
}

await testCliProxyAuthUnavailableCooldown();
testBlankFallbackDisablesFallback();
console.log('Provider failover regressions passed.');
