#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

// Avoid real DB usage in tests (scraper module initializes DB pool on import)
process.env.DATABASE_URL ||= 'postgres://user:pass@localhost:5432/edrsr_test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir =
  process.env.EDRSR_FIXTURES_DIR || path.resolve(__dirname, '..', 'tests', 'fixtures', 'edrsr');

const { __test } = await import('../scraper.js');
const { extractMainContent, stripNonContentElements, extractAsMarkdown, extractWithReadability } =
  __test;

function loadHtmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  return entries.filter((name) => name.endsWith('.html')).map((name) => path.join(dir, name));
}

function analyzeFixture(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });
  stripNonContentElements($);

  const text = extractMainContent($);
  const markdown = extractAsMarkdown($, '#divdocument');
  const readability = extractWithReadability(html, 'https://reyestr.court.gov.ua/Review/1');

  const best =
    [markdown, text, readability].filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';

  return { text, markdown, readability, best };
}

function run() {
  const files = loadHtmlFiles(fixturesDir);
  if (files.length === 0) {
    console.log(`ℹ️ No fixtures found in ${fixturesDir}. Skipping.`);
    return;
  }

  console.log(`🧪 Running scraper fixture tests on ${files.length} file(s)...`);
  for (const filePath of files) {
    const { best } = analyzeFixture(filePath);
    assert.ok(best.length > 200, `Fixture ${path.basename(filePath)} has too little content`);
  }

  console.log('✅ Fixture tests passed');
}

run();
