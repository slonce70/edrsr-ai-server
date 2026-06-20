#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

const webMarkdown = fs.readFileSync(path.join(root, 'web/src/lib/markdown.ts'), 'utf8');
const adminReport = fs.readFileSync(path.join(root, 'server/public/admin/report.js'), 'utf8');
const extensionResults = fs.readFileSync(path.join(root, 'extension/results.js'), 'utf8');

assert.match(webMarkdown, /DOMPurify\.sanitize/, 'React markdown path should sanitize DOM output');
assert.match(
  adminReport,
  /function sanitizeReportHtml/,
  'admin report should centralize sanitizer'
);
assert.match(adminReport, /sanitizeReportHtml\(marked\.parse\(analysisContent\)\)/);
assert.doesNotMatch(
  adminReport,
  /analysisResult\.innerHTML\s*=\s*marked\.parse\(analysisContent\)/,
  'admin report should not write raw marked output into innerHTML'
);

assert.match(adminReport, /DOMPurify\.sanitize/, 'admin report should sanitize via DOMPurify');
assert.match(adminReport, /ALLOWED_TAGS/, 'admin sanitizer should pin a tag allowlist');
assert.match(
  adminReport,
  /addHook\('afterSanitizeAttributes'/,
  'admin sanitizer should harden anchors via a DOMPurify hook'
);
assert.match(adminReport, /noopener noreferrer/, 'admin anchors should be forced rel=noopener');
assert.match(
  adminReport,
  /parsed\.protocol !== 'http:'/,
  'admin should restrict link protocols to http/https'
);

assert.match(extensionResults, /function sanitizeHtml/, 'extension should keep MV3 sanitizer');
assert.match(
  extensionResults,
  /u\.protocol !== 'http:' && u\.protocol !== 'https:'/,
  'extension sanitizer should block non-http links'
);
assert.match(
  extensionResults,
  /escapeHtml\(getStatusLabel\(job\.status\)\)/,
  'extension metadata status should be escaped before innerHTML'
);
assert.match(
  extensionResults,
  /escapeHtml\(job\.total_links\)/,
  'extension metadata counts should be escaped before innerHTML'
);

console.log('Markdown/XSS regressions passed.');
