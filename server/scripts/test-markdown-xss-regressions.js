#!/usr/bin/env node

// Markdown-report XSS regression test.
//
// Two layers:
//  1) SOURCE PINS — assert the three independent report sanitizers
//     (React portal, admin page, Chrome extension) stay aligned to the one
//     unified DOMPurify policy and never regress to raw innerHTML.
//  2) BEHAVIOR — actually run the vendored DOMPurify (Cure53) under jsdom with
//     the unified policy + anchor-hardening hook and prove the security
//     guarantees on real markup. Reuses server/public/admin/vendor/purify.min.js
//     and the jsdom already in the repo — NO new npm dependency.
//
// Run:  node server/scripts/test-markdown-xss-regressions.js

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

// ---------------------------------------------------------------------------
// 1) SOURCE PINS — the three sanitizers stay on the unified policy.
// ---------------------------------------------------------------------------

// React portal (web/src/lib/markdown.ts)
assert.match(webMarkdown, /DOMPurify\.sanitize/, 'React markdown path should sanitize DOM output');
assert.match(webMarkdown, /ALLOWED_TAGS/, 'portal sanitizer should pin a tag allowlist');
assert.match(
  webMarkdown,
  /addHook\('afterSanitizeAttributes'/,
  'portal sanitizer should harden anchors via a DOMPurify hook'
);
assert.match(webMarkdown, /noopener noreferrer/, 'portal anchors should be forced rel=noopener');
assert.match(
  webMarkdown,
  /'h5'[\s\S]*'h6'/,
  'portal allowlist should include h5/h6 so the TOC + all heading levels survive'
);
assert.match(
  webMarkdown,
  /'id'/,
  'portal allowlist must keep id so heading anchors / TOC keep working'
);
assert.match(
  webMarkdown,
  /FORBID_TAGS:\s*\[[^\]]*'img'/,
  'portal sanitizer should forbid <img> (reports are text+tables+links)'
);

// Admin page (server/public/admin/report.js)
assert.match(adminReport, /function sanitizeReportHtml/, 'admin report should centralize sanitizer');
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
  /'h5'[\s\S]*'h6'/,
  'admin allowlist should now include h5/h6 so all three sanitizers match'
);
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
assert.match(adminReport, /renderer\.image = \(\) => ''/, 'admin should strip images at the renderer');
assert.match(adminReport, /renderer\.html = \(\) => ''/, 'admin should strip raw HTML at the renderer');

// Chrome extension (extension/results.js)
assert.match(extensionResults, /function sanitizeHtml/, 'extension should keep a sanitizeHtml entry');
assert.match(
  extensionResults,
  /DOMPurify\.sanitize/,
  'extension should now sanitize via the vendored DOMPurify (not the hand-rolled walker)'
);
assert.match(extensionResults, /ALLOWED_TAGS/, 'extension sanitizer should pin a tag allowlist');
assert.match(
  extensionResults,
  /'h5'[\s\S]*'h6'/,
  'extension allowlist should include h5/h6 to match the other two'
);
assert.match(
  extensionResults,
  /addHook\('afterSanitizeAttributes'/,
  'extension sanitizer should harden anchors via a DOMPurify hook'
);
assert.match(
  extensionResults,
  /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/,
  'extension sanitizer should block non-http links'
);
assert.match(extensionResults, /noopener noreferrer/, 'extension anchors should be forced rel=noopener');
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

// The vendored DOMPurify must actually ship inside the extension package.
assert.ok(
  fs.existsSync(path.join(root, 'extension/vendor/purify.min.js')),
  'extension must vendor purify.min.js so DOMPurify is available at runtime'
);
const resultsHtml = fs.readFileSync(path.join(root, 'extension/results.html'), 'utf8');
assert.match(
  resultsHtml,
  /<script src="vendor\/purify\.min\.js">/,
  'results.html must load the vendored purify.min.js before results.js'
);
assert.ok(
  resultsHtml.indexOf('vendor/purify.min.js') < resultsHtml.indexOf('results.js'),
  'purify.min.js must load BEFORE results.js'
);

// ---------------------------------------------------------------------------
// 2) BEHAVIOR — run the vendored DOMPurify under jsdom with the unified policy.
// ---------------------------------------------------------------------------

const { JSDOM } = await import('jsdom');
const purifySource = fs.readFileSync(
  path.join(root, 'server/public/admin/vendor/purify.min.js'),
  'utf8'
);

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://app.edrsr-ai-server.fun/',
  runScripts: 'outside-only',
});
const { window } = dom;
// Evaluate the vendored UMD bundle in the jsdom window, exactly as the browser
// would, so DOMPurify attaches to window.
window.eval(purifySource);
const DOMPurify = window.DOMPurify;
assert.ok(DOMPurify && DOMPurify.sanitize, 'vendored purify.min.js should expose DOMPurify');

// The unified policy (identical across all three surfaces).
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'id'];

function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new window.URL(url, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A') {
    const safeHref = safeUrl(node.getAttribute('href') || '');
    if (!safeHref) {
      node.removeAttribute('href');
    } else {
      node.setAttribute('href', safeHref);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

const sanitize = (html) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['img', 'style', 'iframe', 'script'],
    ALLOW_DATA_ATTR: false,
  });

// <script> is stripped.
{
  const out = sanitize('<p>hi</p><script>window.__x=1</script>');
  assert.doesNotMatch(out, /<script/i, '<script> must be stripped');
  assert.doesNotMatch(out, /window\.__x/, 'script body must not survive');
  assert.match(out, /<p>hi<\/p>/, 'safe surrounding markup must survive');
}

// <img onerror=...> is stripped (no img allowed at all).
{
  const out = sanitize('<p>x</p><img src=x onerror="alert(1)">');
  assert.doesNotMatch(out, /<img/i, '<img> must be stripped');
  assert.doesNotMatch(out, /onerror/i, 'onerror handler must not survive');
}

// javascript: href is dropped, link text preserved.
{
  const out = sanitize('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(out, /href="javascript:/i, 'javascript: href must be dropped');
  assert.doesNotMatch(out, /alert\(1\)/, 'javascript payload must not survive');
  assert.match(out, /click/, 'link text must be preserved');
}

// A valid https link keeps its href and gains target + rel=noopener noreferrer.
{
  const out = sanitize('<a href="https://example.com/case/42">case</a>');
  assert.match(out, /href="https:\/\/example\.com\/case\/42"/, 'https href must survive');
  assert.match(out, /target="_blank"/, 'https link must gain target=_blank');
  assert.match(out, /rel="noopener noreferrer"/, 'https link must gain rel=noopener noreferrer');
}

// h5/h6 now survive (newly allowed). Headings with an id keep the id (this is
// what the admin/portal produce; the admin path may not inject ids, so we only
// assert that an id IS preserved when present, which is the portal TOC contract).
{
  const out = sanitize('<h5>five</h5><h6>six</h6>');
  assert.match(out, /<h5>five<\/h5>/, 'h5 must survive the unified policy');
  assert.match(out, /<h6>six<\/h6>/, 'h6 must survive the unified policy');

  const withId = sanitize('<h2 id="section">Section</h2>');
  assert.match(withId, /<h2 id="section">/, 'heading id must survive (portal TOC contract)');
}

// Core report markup (tables, code, lists, blockquote) survives unchanged.
{
  const out = sanitize(
    '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>' +
      '<pre><code>const x=1;</code></pre><ul><li>i</li></ul><blockquote>q</blockquote>'
  );
  assert.match(out, /<table>/, 'tables must survive');
  assert.match(out, /<th>A<\/th>/, 'table headers must survive');
  assert.match(out, /<pre><code>/, 'code blocks must survive');
  assert.match(out, /<li>i<\/li>/, 'lists must survive');
  assert.match(out, /<blockquote>q<\/blockquote>/, 'blockquotes must survive');
}

console.log('Markdown/XSS regressions passed.');
