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

const workerSource = read('server/worker.js');
const jobWriteServiceSource = read('server/services/jobWriteService.js');

assert.match(
  workerSource,
  /originalLinkData\?\.decision_date\s*\|\|\s*caseData\.decisionDate\s*\|\|\s*caseData\.date/,
  'worker should fall back to scraper-extracted caseData.date when link input has no decision_date'
);

assert.match(
  workerSource,
  /decisionDate:\s*caseData\.decisionDate\s*\|\|\s*null/,
  'worker should pass extracted decisionDate into link metadata persistence'
);

assert.match(
  jobWriteServiceSource,
  /decision_date\s*=\s*COALESCE\(\$10,\s*decision_date\)/,
  'processed link metadata updates should persist decision_date without clearing existing values'
);

assert.match(
  jobWriteServiceSource,
  /metadata\.decisionDate\s*\|\|\s*null/,
  'jobWriteService should bind metadata.decisionDate'
);

console.log('Job link decision date regression passed.');
