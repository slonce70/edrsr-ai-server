#!/usr/bin/env node
import assert from 'node:assert/strict';

import { computeReportCoverage } from '../quality/coverage.js';

// 1) No text, with URLs -> not analyzed, coverage null, not partial.
{
  const r = computeReportCoverage(null, ['https://a', 'https://b']);
  assert.equal(r.analyzed, false, 'no text => analyzed false');
  assert.equal(r.total, 2, 'no text => total reflects url count');
  assert.equal(r.cited, 0, 'no text => cited 0');
  assert.equal(r.coverage, null, 'no text => coverage null');
  assert.equal(r.partial, false, 'no text => not partial');
}

// 1b) No text, no URLs -> total 0, coverage null.
{
  const r = computeReportCoverage('', []);
  assert.equal(r.analyzed, false);
  assert.equal(r.total, 0);
  assert.equal(r.coverage, null);
  assert.equal(r.partial, false);
}

// 2) All cited -> coverage 100, not partial.
{
  const text = 'Report cites https://a and https://b fully.';
  const r = computeReportCoverage(text, ['https://a', 'https://b']);
  assert.equal(r.analyzed, true);
  assert.equal(r.total, 2);
  assert.equal(r.cited, 2);
  assert.equal(r.coverage, 100);
  assert.equal(r.partial, false, 'full coverage no marker => not partial');
}

// 3) Some cited -> coverage < 100, partial true.
{
  const text = 'Report cites only https://a here.';
  const r = computeReportCoverage(text, ['https://a', 'https://b', 'https://c', 'https://d']);
  assert.equal(r.cited, 1);
  assert.equal(r.coverage, 25);
  assert.ok(r.coverage < 100, 'partial citation => coverage < 100');
  assert.equal(r.partial, true, 'partial citation => partial true');
}

// 4) Failure marker present even at 100% cited -> partial true.
{
  const text = 'Report cites https://a and https://b. Виявлені проблеми у деяких справах.';
  const r = computeReportCoverage(text, ['https://a', 'https://b']);
  assert.equal(r.coverage, 100, 'all cited => coverage 100');
  assert.equal(r.partial, true, 'failure marker forces partial even at 100%');
}

// 4b) Other failure marker variant.
{
  const text = 'https://a https://b Частина справ не була проаналізована.';
  const r = computeReportCoverage(text, ['https://a', 'https://b']);
  assert.equal(r.coverage, 100);
  assert.equal(r.partial, true);
}

// 5) Empty urls but text present -> total 0, coverage null, analyzed true.
{
  const r = computeReportCoverage('Some analysis text.', []);
  assert.equal(r.analyzed, true, 'text present => analyzed true');
  assert.equal(r.total, 0);
  assert.equal(r.cited, 0);
  assert.equal(r.coverage, null);
  assert.equal(r.partial, false);
}

// 6) Non-array urls and non-string entries are tolerated.
{
  const r = computeReportCoverage('https://a', ['https://a', null, 123, '', 'https://z']);
  assert.equal(r.total, 2, 'only valid string urls counted');
  assert.equal(r.cited, 1);
  assert.equal(r.coverage, 50);
  assert.equal(r.partial, true);
}

console.log('OK: report coverage helper contract holds.');
