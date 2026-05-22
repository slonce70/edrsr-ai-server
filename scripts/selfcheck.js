// Lightweight self-checks for Stage 6 (no DB/network needed)
// Run with: node scripts/selfcheck.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidEDRSRUrl } from '../server/utils.js';
import {
  buildShareUrl,
  isValidWorkspaceRole,
  parseShareLinkDays,
} from '../server/collaborationPolicy.js';
import { validateCollectRequest, validateChatMessage } from '../server/middleware/validators.js';
import {
  allowMissingOrigin,
  getAllowedChromeExtensionIds,
  getAllowedHttpOrigins,
  isAllowedChromeExtensionOrigin,
} from '../server/originPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // --- collaboration policy tests ---
  try {
    assert.equal(isValidWorkspaceRole('owner'), true);
    assert.equal(isValidWorkspaceRole('admin'), true);
    assert.equal(isValidWorkspaceRole('member'), true);
    assert.equal(isValidWorkspaceRole('viewer'), false);

    assert.deepEqual(parseShareLinkDays(undefined), { ok: true, value: 14 });
    assert.deepEqual(parseShareLinkDays('7'), { ok: true, value: 7 });
    assert.equal(parseShareLinkDays('31').ok, false);
    assert.equal(parseShareLinkDays('0').ok, false);

    assert.equal(
      buildShareUrl('https://example.com/', 'token123'),
      'https://example.com/share/token123'
    );
    assert.equal(buildShareUrl('', 'token123'), null);
    pass('collaborationPolicy');
  } catch (e) {
    fail('collaborationPolicy', e);
  }

  // --- origin policy tests ---
  try {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../server/server.js'), 'utf8');
    const prodEnv = {
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://portal.example.com',
      CHROME_EXTENSION_IDS: 'abc123',
    };
    const devEnv = {
      NODE_ENV: 'development',
    };

    assert.equal(allowMissingOrigin(devEnv), true);
    assert.equal(allowMissingOrigin(prodEnv), true);
    assert.equal(isAllowedChromeExtensionOrigin('chrome-extension://abc123', prodEnv), true);
    assert.equal(isAllowedChromeExtensionOrigin('chrome-extension://zzz999', prodEnv), false);
    assert.equal(getAllowedChromeExtensionIds(prodEnv).length, 1);
    assert.deepEqual(getAllowedHttpOrigins(devEnv).includes('http://localhost:3000'), true);
    assert.deepEqual(getAllowedHttpOrigins(prodEnv), ['https://portal.example.com']);
    assert.deepEqual(getAllowedHttpOrigins({ NODE_ENV: 'production' }), [
      'https://edrsr-ai-server.fun',
      'https://www.edrsr-ai-server.fun',
      'https://app.edrsr-ai-server.fun',
    ]);
    assert.match(serverSource, /error\.status = 403;/);
    pass('originPolicy');
  } catch (e) {
    fail('originPolicy', e);
  }

  // --- extension/web contract tests ---
  try {
    const popupSource = fs.readFileSync(path.resolve(__dirname, '../extension/popup.js'), 'utf8');
    const resultsSource = fs.readFileSync(
      path.resolve(__dirname, '../extension/results.js'),
      'utf8'
    );
    const bgSource = fs.readFileSync(path.resolve(__dirname, '../extension/bg.js'), 'utf8');
    const contentSource = fs.readFileSync(
      path.resolve(__dirname, '../extension/content.js'),
      'utf8'
    );
    const shareLinksSource = fs.readFileSync(
      path.resolve(__dirname, '../web/src/pages/ShareLinksPage.tsx'),
      'utf8'
    );

    assert.equal((popupSource.match(/API_CHECK_PROCESSED/g) || []).length, 1);
    assert.match(contentSource, /async function markProcessedLinksAsVisited\(\)/);
    assert.match(contentSource, /data-edrsr-processed/);
    assert.match(contentSource, /edrsr-processed-links-style/);
    assert.match(contentSource, /type: 'API_CHECK_PROCESSED'/);
    assert.match(resultsSource, /document\.createTextNode\(job\.error_message/);
    assert.doesNotMatch(resultsSource, /innerHTML\s*=\s*.*error_message/s);
    assert.match(bgSource, /const resultsPorts = new Map\(\);/);
    assert.match(bgSource, /broadcastToResultsPorts\(jobData\.id/);
    assert.match(bgSource, /redirectResultsPortsForJob\(jobId, result\.jobId\)/);
    assert.match(bgSource, /port\.jobId = jobId;/);
    assert.match(bgSource, /async function getCurrentWebSocketStatus\(\)/);
    assert.match(
      bgSource,
      /return \(await isAuthenticated\(\)\) \? 'disconnected' : 'auth_required';/
    );
    assert.match(popupSource, /case 'auth_required':/);
    assert.match(popupSource, /popup\.messages\.authRequired/);
    assert.match(popupSource, /case 'error':/);
    assert.match(popupSource, /popup\.messages\.serverConnectionError/);
    assert.doesNotMatch(shareLinksSource, /navigator\.clipboard\.writeText\(link\.share_url\)/);
    pass('extensionWebContracts');
  } catch (e) {
    fail('extensionWebContracts', e);
  }

  // --- extension build policy tests ---
  try {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
    );
    const buildScriptSource = fs.readFileSync(
      path.resolve(__dirname, '../scripts/build-extension.js'),
      'utf8'
    );

    assert.equal(
      rootPackage.scripts['build:extension:release'],
      'EXTENSION_BUILD_ENV=production PACKAGE_EXTENSION_ZIP=true node scripts/build-extension.js'
    );
    assert.match(buildScriptSource, /const SHOULD_PACKAGE_ZIP =/);
    assert.match(buildScriptSource, /shouldCopyExtensionFile/);
    assert.match(buildScriptSource, /basename !== 'AGENTS\.md'/);
    assert.match(buildScriptSource, /Skipping zip packaging for non-release build/);
    assert.match(
      buildScriptSource,
      /Release zip packaging is only allowed for production\/staging builds/
    );
    const i18nSource = fs.readFileSync(path.resolve(__dirname, '../extension/i18n.js'), 'utf8');
    const popupSource = fs.readFileSync(path.resolve(__dirname, '../extension/popup.js'), 'utf8');
    const docsSource = fs.readFileSync(
      path.resolve(__dirname, '../docs/ENVIRONMENT_VARIABLES.md'),
      'utf8'
    );
    assert.doesNotMatch(
      i18nSource,
      /Требуется запущенный сервер API|Потрібен запущений сервер API/
    );
    assert.match(popupSource, /API_BASE_URL/);
    assert.match(popupSource, /apiHost/);
    assert.match(docsSource, /CHROME_EXTENSION_IDS=__CHROME_STORE_EXTENSION_ID__/);
    assert.match(docsSource, /chrome-extension:\/\/__CHROME_STORE_EXTENSION_ID__/);
    pass('extensionBuildPolicy');
  } catch (e) {
    fail('extensionBuildPolicy', e);
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
