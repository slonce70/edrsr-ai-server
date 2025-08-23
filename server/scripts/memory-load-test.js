#!/usr/bin/env node

// Memory load test: simulate processing 25 HTML files in batches of 5
// This test does not hit the network. It constructs synthetic HTML payloads
// of ~100-500KB, parses them with cheerio, extracts text, and clears memory
// between batches, forcing GC when available. The script exits with code 0 on PASS (<500MB peak), 1 otherwise.

import * as cheerio from 'cheerio';

function kbToString(kb) {
  return `${Math.round(kb)}KB`;
}

function generateHtmlPayload(targetKb) {
  const base =
    '<div class="WordSection1"><p>УХВАЛА РІШЕННЯ ПОСТАНОВА ВИРІШИВ ВСТАНОВИВ Суддя Суд</p></div>';
  const filler = ' Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);
  let html = '<html><body>' + base;
  while (html.length / 1024 < targetKb) {
    html += `<div>${filler}</div>`;
  }
  html += '</body></html>';
  return html;
}

function extractMainText($) {
  const selectors = [
    '#divdocument',
    '.WordSection1',
    '#doc_text',
    '.decision-content',
    '.document-content',
  ];
  let combined = '';
  for (const sel of selectors) {
    const nodes = $(sel);
    if (nodes.length > 0) {
      nodes.each((_, el) => {
        const t = $(el).text().trim();
        if (t.length > 50) combined += '\n' + t;
      });
    }
  }
  if (combined.length < 200) {
    const bodyText = $('body').text().trim();
    if (bodyText.length > 200) combined = bodyText;
  }
  return combined.slice(0, 2000);
}

function mem() {
  const mu = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mu.heapUsed / 1024 / 1024),
    rssMB: Math.round(mu.rss / 1024 / 1024),
  };
}

async function run() {
  const TOTAL = 25;
  const BATCH = parseInt(process.env.BATCH_SIZE, 10) || 5;
  const htmlSizesKB = Array.from({ length: TOTAL }, (_, i) => 100 + ((i * 17) % 400));
  const batches = [];
  for (let i = 0; i < TOTAL; i += BATCH) {
    batches.push(htmlSizesKB.slice(i, i + BATCH));
  }

  console.log(`🚀 Memory load test: ${TOTAL} synthetic HTMLs, batches of ${BATCH}`);
  let peak = 0;

  for (let bi = 0; bi < batches.length; bi++) {
    const sizes = batches[bi];
    console.log(
      `\n🔄 Batch ${bi + 1}/${batches.length} – sizes: ${sizes.map(kbToString).join(', ')}`
    );
    const parsed = [];

    for (const kb of sizes) {
      const html = generateHtmlPayload(kb);
      let $ = cheerio.load(html);
      const text = extractMainText($);
      // Release per-item memory ASAP
      $ = null;
      parsed.push(text);
      const { heapUsedMB } = mem();
      peak = Math.max(peak, heapUsedMB);
    }

    // Simulate DB save and keep only what is needed for AI (the text)
    // Immediately drop references to large arrays after batch
    parsed.length = 0;

    if (global.gc) {
      global.gc();
    }
    const after = mem();
    peak = Math.max(peak, after.heapUsedMB);
    console.log(
      `🗑️ After GC: heap=${after.heapUsedMB}MB rss=${after.rssMB}MB (peak so far=${peak}MB)`
    );
  }

  const limit = parseInt(process.env.MEMORY_LIMIT_MB, 10) || 500;
  console.log(`\n📊 Peak heap used: ${peak}MB (limit ${limit}MB)`);
  if (peak < limit) {
    console.log('✅ PASS: Peak memory within limit');
    process.exit(0);
  } else {
    console.error('❌ FAIL: Peak memory exceeds limit');
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
