import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const output = execFileSync(process.execPath, ['server/scripts/run-db-integration.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/edrsr_live_guard_probe',
    EDRSR_DB_INTEGRATION_ALLOW_LIVE: '',
  },
  encoding: 'utf8',
});

assert.match(
  output,
  /SKIPPED live-db-guard:/,
  'DB integration wrapper should refuse to run against configured DBs without explicit opt-in'
);

console.log('DB integration safety regression passed.');
