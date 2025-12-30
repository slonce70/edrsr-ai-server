#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';

// Ensure env is set BEFORE importing scraper.js (it initializes DB pool on import)
process.env.DATABASE_URL ||= 'postgres://user:pass@localhost:5432/edrsr_test';
process.env.MAX_SCRIPT_TAGS ||= '2';
process.env.MAX_HTML_BYTES ||= '1000000';
process.env.MAX_HTML_LINE_LENGTH ||= '1000000';
process.env.MAX_JS_KEYWORDS ||= '10000';

const { __test } = await import('../scraper.js');

const {
  analyzeRawHtmlForHazards,
  decodeHtmlBody,
  stripNonContentElements,
  extractAsMarkdown,
  extractMainContent,
  extractWithReadability,
  isAllowedContentType,
  containsCourtKeyword,
  extractDecisionHeader,
  structureCourtDecision,
  enhanceMetadataFromText,
  removeResidualScripts,
  looksLikeJavascriptLine,
  extractLegalMetadata,
} = __test;

function testHazardsScriptCount() {
  const html = '<script>1</script><script>2</script><script>3</script>';
  const hazard = analyzeRawHtmlForHazards(html);
  assert.equal(hazard.skip, true, 'hazard should skip when script tags exceed limit');
  assert.match(hazard.reason, /Too many <script>/);
}

function testDecodeHtmlBodyUtf8() {
  const html = '<meta charset="utf-8"><div>УХВАЛА</div>';
  const buf = Buffer.from(html, 'utf8');
  const decoded = decodeHtmlBody(buf, 'text/html; charset=utf-8');
  assert.match(decoded, /УХВАЛА/);
}

function testExtractMainContentSelector() {
  const html = `
    <html><body>
      <div id="divdocument">
        <p>УХВАЛА</p>
        <p>Текст рішення суду про спірні правовідносини, що містить достатньо символів для проходження порогу.</p>
      </div>
    </body></html>
  `;
  const $ = cheerio.load(html, { decodeEntities: false });
  stripNonContentElements($);
  const text = extractMainContent($);
  assert.match(text, /Текст рішення/);
}

function testExtractAsMarkdown() {
  const html = `
    <html><body>
      <div id="divdocument">
        <p>УХВАЛА</p>
        <p>Текст рішення суду про спірні правовідносини, що містить достатньо символів для проходження порогу.</p>
      </div>
    </body></html>
  `;
  const $ = cheerio.load(html, { decodeEntities: false });
  const md = extractAsMarkdown($, '#divdocument');
  assert.ok(md && md.length > 0, 'markdown should be produced');
  assert.match(md, /УХВАЛА/);
  assert.match(md, /Текст рішення/);
}

function testRemoveResidualScripts() {
  const input = [
    'function foo() { return 1; }',
    'Це текст рішення суду',
    '$(document).ready(function(){})',
  ].join('\n');
  const cleaned = removeResidualScripts(input);
  assert.ok(!/function foo/.test(cleaned), 'JS lines should be removed');
  assert.ok(!/\$\(document\)/.test(cleaned), 'JS lines should be removed');
  assert.match(cleaned, /Це текст рішення суду/);
}

function testContentTypeAllowlist() {
  assert.equal(isAllowedContentType('text/html; charset=utf-8'), true);
  assert.equal(isAllowedContentType('application/xhtml+xml'), true);
  assert.equal(isAllowedContentType('application/pdf'), false);
}

function testReadabilityFallback() {
  const longText = 'Текст рішення суду. '.repeat(40);
  const html = `<html><body><article><h1>Заголовок</h1><p>${longText}</p></article></body></html>`;
  const text = extractWithReadability(html, 'https://reyestr.court.gov.ua/Review/1');
  assert.ok(text && text.includes('Текст рішення'), 'readability should extract article text');
}

function testContainsCourtKeyword() {
  assert.equal(containsCourtKeyword('УХВАЛА суду'), true);
  assert.equal(containsCourtKeyword('ухвала суду'), true);
  assert.equal(containsCourtKeyword('постанова суду'), true);
  assert.equal(containsCourtKeyword('без ключових слів'), false);
}

function testExtractDecisionHeader() {
  const text = 'РІШЕННЯ ІМЕНЕМ УКРАЇНИ\\nСуд встановив...';
  const header = extractDecisionHeader(text);
  assert.equal(header, 'РІШЕННЯ ІМЕНЕМ УКРАЇНИ');
}

function testLooksLikeJavascriptLine() {
  assert.equal(looksLikeJavascriptLine('function foo() {'), true);
  assert.equal(looksLikeJavascriptLine('Це текст рішення суду'), false);
}

function testStructureCourtDecision() {
  const input = 'УХВАЛА\nВСТАНОВИВ: Суд встановив...';
  const out = structureCourtDecision(input);
  assert.match(out, /=== УХВАЛА ===/);
  assert.match(out, /ВСТАНОВИВ/);
}

function testEnhanceMetadataFromText() {
  const caseData = {
    id: '123',
    caseNumber: 'Не вказано',
    date: 'Дата не знайдена',
  };
  const text = 'справи № 123/45\nДата набрання законної сили: 01.01.2024';
  const updated = enhanceMetadataFromText(caseData, text);
  assert.equal(updated.caseNumber, '123/45');
  assert.equal(updated.date, '01.01.2024');
}

function testExtractLegalMetadata() {
  const caseData = { id: '1', body: 'text' };
  const text =
    'Позивач: Іваненко Іван Іванович\nВідповідач: Петров Петро\nстаття 185 Кримінального кодекса\nСума 10 000 грн';
  const updated = extractLegalMetadata(caseData, text);
  assert.ok(updated.metadata, 'metadata should exist');
  assert.ok(updated.metadata.lawArticles.length >= 1, 'law articles should be detected');
  assert.ok(updated.metadata.parties.plaintiffs.length >= 1, 'plaintiffs should be detected');
}

function run() {
  testHazardsScriptCount();
  testDecodeHtmlBodyUtf8();
  testExtractMainContentSelector();
  testExtractAsMarkdown();
  testRemoveResidualScripts();
  testContentTypeAllowlist();
  testReadabilityFallback();
  testContainsCourtKeyword();
  testExtractDecisionHeader();
  testLooksLikeJavascriptLine();
  testStructureCourtDecision();
  testEnhanceMetadataFromText();
  testExtractLegalMetadata();

  console.log('✅ Parser tests passed');
}

run();
