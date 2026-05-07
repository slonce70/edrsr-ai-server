#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const webHtml = read('web/index.html');
const localeContext = read('web/src/state/LocaleContext.tsx');
const adminHtml = read('server/public/admin/index.html');
const adminScript = read('server/public/admin/script.js');
const extensionResults = read('extension/results.js');
const portalCss = read('web/src/index.css');
const appLayout = read('web/src/components/AppLayout.tsx');

assert.match(webHtml, /<html lang="uk">/, 'web shell should default to Ukrainian lang');
assert.match(
  localeContext,
  /document\.documentElement\.lang\s*=\s*locale/,
  'LocaleProvider should keep html lang in sync with selected locale'
);

assert.match(
  adminHtml,
  /id="login-modal"[\s\S]*?class="modal"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="login-modal-title"/,
  'login modal should expose dialog semantics'
);
assert.match(
  adminHtml,
  /id="job-details-modal"[\s\S]*?class="modal"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="job-details-title"/,
  'job details modal should expose dialog semantics'
);
assert.match(adminScript, /trapFocusInModal/, 'admin modals should trap keyboard focus');
assert.match(adminScript, /lastFocusedBeforeModal/, 'admin modals should restore focus on close');
assert.match(adminScript, /e\.key === 'Escape'/, 'admin modals should close on Escape');
assert.match(
  adminHtml,
  /data-i18n-aria-label="common\.openMenu"/,
  'admin mobile menu accessible name should be localized'
);
assert.match(
  adminHtml,
  /data-i18n-aria-label="common\.searchUsers"/,
  'admin user search accessible name should be localized'
);
assert.match(
  adminHtml,
  /data-i18n-aria-label="common\.searchJobs"/,
  'admin job search accessible name should be localized'
);
assert.match(
  adminScript,
  /aria-label="\$\{t\('common\.previousPage'\)\}"/,
  'admin previous-page accessible name should be localized'
);
assert.match(
  adminScript,
  /aria-label="\$\{t\('common\.pageLabel', \{ page: i \}\)\}"/,
  'admin numbered-page accessible names should be localized'
);
assert.match(
  adminScript,
  /aria-label="\$\{t\('common\.nextPage'\)\}"/,
  'admin next-page accessible name should be localized'
);

assert.match(
  extensionResults,
  /document\.createElement\('button'\)/,
  'extension title edit control should be a real button'
);
assert.doesNotMatch(
  extensionResults,
  /const editIcon = document\.createElement\('span'\)/,
  'extension title edit control should not be a click-only span'
);
assert.match(
  extensionResults,
  /editIcon\.setAttribute\('aria-label', t\('results\.editTitle'\)\)/,
  'extension title edit button should have an accessible name'
);

assert.match(portalCss, /\.link\s*\{[\s\S]*overflow-wrap: anywhere;/, 'links should wrap');
assert.match(portalCss, /\.snippet\s*\{[\s\S]*overflow-wrap: anywhere;/, 'snippets should wrap');
assert.match(portalCss, /\.list__row\s*\{[\s\S]*min-width: 0;/, 'list rows should shrink');
assert.match(appLayout, /topbar__menu/, 'mobile portal layout should expose a menu button');
assert.match(
  appLayout,
  /drawer-backdrop/,
  'mobile portal layout should close the drawer by backdrop'
);
assert.match(appLayout, /sidebar--open/, 'mobile portal sidebar should have an open state');

console.log('UI accessibility regressions passed.');
