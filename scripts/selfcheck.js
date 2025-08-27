// Lightweight self-checks for Stage 6 (no DB/network needed)
// Run with: node scripts/selfcheck.js

import assert from 'node:assert/strict';
import { isValidEDRSRUrl } from '../server/utils.js';
import { validateCollectRequest, validateChatMessage } from '../server/middleware/validators.js';

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => {
    res.statusCode = code;
    return {
      json: (obj) => {
        res.body = obj;
        return res;
      },
    };
  };
  return res;
}

async function run() {
  const results = [];
  const pass = (name) => results.push({ name, ok: true });
  const fail = (name, err) => results.push({ name, ok: false, err: err?.message || String(err) });

  // --- isValidEDRSRUrl tests ---
  try {
    assert.equal(isValidEDRSRUrl('https://reyestr.court.gov.ua/Review/12345678'), true);
    assert.equal(isValidEDRSRUrl('http://reyestr.court.gov.ua/Review/1'), true);
    assert.equal(isValidEDRSRUrl('https://reyestr.court.gov.ua/Review/abc'), false);
    assert.equal(isValidEDRSRUrl('https://sub.reyestr.court.gov.ua/Review/123'), false);
    assert.equal(isValidEDRSRUrl('https://reyestr.court.gov.ua/Other/123'), false);
    pass('isValidEDRSRUrl');
  } catch (e) {
    fail('isValidEDRSRUrl', e);
  }

  // --- validateCollectRequest tests ---
  try {
    // invalid: no links
    {
      const req = { body: { links: [], clientId: 'abc' } };
      const res = mockRes();
      await validateCollectRequest(req, res, () => {});
      assert.equal(res.statusCode, 400);
    }
    // invalid: malformed element
    {
      const req = { body: { links: [{ foo: 'bar' }], clientId: 'abc' } };
      const res = mockRes();
      await validateCollectRequest(req, res, () => {});
      assert.equal(res.statusCode, 422);
    }
    // invalid: long url (>2048)
    {
      const longParam = 'a'.repeat(2050);
      const longUrl = `https://reyestr.court.gov.ua/Review/1?q=${longParam}`;
      const req = { body: { links: [{ url: longUrl }], clientId: 'abc' } };
      const res = mockRes();
      await validateCollectRequest(req, res, () => {});
      assert.equal(res.statusCode, 422);
    }
    // valid minimal
    {
      const req = {
        body: { links: [{ url: 'https://reyestr.court.gov.ua/Review/1' }], clientId: 'abc' },
      };
      const res = mockRes();
      let nextCalled = false;
      await validateCollectRequest(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, 200);
    }
    pass('validateCollectRequest');
  } catch (e) {
    fail('validateCollectRequest', e);
  }

  // --- validateChatMessage tests ---
  try {
    {
      const req = { body: { message: '' } };
      const res = mockRes();
      await validateChatMessage(req, res, () => {});
      assert.equal(res.statusCode, 400);
    }
    {
      const req = { body: { message: 'ok' } };
      const res = mockRes();
      let nextCalled = false;
      await validateChatMessage(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
    }
    pass('validateChatMessage');
  } catch (e) {
    fail('validateChatMessage', e);
  }

  // Report
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.ok) console.log(`✔ ${r.name}`);
    else console.error(`✖ ${r.name}: ${r.err}`);
  }
  if (failed.length > 0) {
    process.exit(1);
  }
  console.log('\nAll self-checks passed.');
}

run();
