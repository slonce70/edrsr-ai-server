#!/usr/bin/env node

import assert from 'node:assert/strict';
import database from '../database/connection.js';
import { fetchCase } from '../scraper.js';
import { isValidEDRSRUrl } from '../utils.js';

const LIMIT = parseInt(process.env.SAMPLE_LINKS_LIMIT || '5', 10);
const SKIP_CACHE = process.env.SCRAPER_SKIP_CACHE === 'true';

async function getSampleUrls() {
  const rows = await database.all(
    `SELECT url
     FROM job_links
     WHERE url IS NOT NULL AND url <> ''
     ORDER BY processed_at DESC NULLS LAST, id DESC
     LIMIT $1`,
    [LIMIT]
  );
  return rows.map((r) => r.url).filter(Boolean);
}

function summarizeResult(url, result) {
  const bodyLen = result?.body ? result.body.length : 0;
  const hasDecisionKeywords = /(ухвала|рішення|постанова|визначення)/i.test(result?.body || '');
  const limitedAccess = /ОБМЕЖЕН.*ДОСТУП|обмежен.*доступ/i.test(result?.body || '');

  return {
    url,
    ok: !result?.errorType,
    errorType: result?.errorType || null,
    fromCache: !!result?.fromCache,
    bodyLen,
    hasDecisionKeywords,
    limitedAccess,
  };
}

async function run() {
  const urls = await getSampleUrls();
  if (urls.length === 0) {
    console.log('ℹ️ No URLs found in job_links. Skipping live parse test.');
    return;
  }

  const validUrls = urls.filter((u) => isValidEDRSRUrl(u));
  if (validUrls.length === 0) {
    console.log('ℹ️ No valid EDRSR URLs found. Skipping.');
    return;
  }

  console.log(`🧪 Testing parser on ${validUrls.length} URL(s)...`);

  const results = [];
  for (const url of validUrls) {
    // Note: no cookie available from DB, expect limited access for some pages
    const parsed = await fetchCase(url, '', null, { skipCache: SKIP_CACHE });
    results.push(summarizeResult(url, parsed));
  }

  for (const r of results) {
    console.log(
      `- ${r.url} | ok=${r.ok} error=${r.errorType || '-'} cache=${r.fromCache} ` +
        `len=${r.bodyLen} keywords=${r.hasDecisionKeywords} limited=${r.limitedAccess}`
    );
  }

  // Minimal assertions: at least one result should return a body
  assert.ok(
    results.some((r) => r.bodyLen > 0),
    'Expected at least one parsed body'
  );

  console.log('✅ Sample link parsing test completed');
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Sample link parsing test failed:', error.message);
    process.exit(1);
  });
