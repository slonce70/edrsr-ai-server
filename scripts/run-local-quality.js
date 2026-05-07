#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'quality:check']],
  ['npm', ['run', 'lint:server']],
  ['npm', ['run', 'web:lint']],
  ['npm', ['run', 'web:build']],
  ['npm', ['run', 'build:extension']],
  ['npm', ['audit', '--omit=dev']],
  ['npm', ['--prefix', 'server', 'audit', '--omit=dev']],
  ['npm', ['--prefix', 'web', 'audit', '--omit=dev']],
  ['npm', ['run', 'test:selfcheck']],
  ['node', ['server/scripts/test-scraper-parsing.js']],
  ['node', ['server/scripts/test-scraper-fixtures.js']],
  ['node', ['server/scripts/test-prompts.js']],
  ['node', ['server/scripts/test-security-regressions.js']],
  ['node', ['server/scripts/test-delete-job-security-regression.js']],
  ['node', ['server/scripts/test-websocket-message-hardening.js']],
  ['node', ['server/scripts/test-websocket-subscription-auth.js']],
  ['node', ['server/scripts/test-proxy-ip-regression.js']],
  ['node', ['server/scripts/test-queue-cookie-cache.js']],
  ['node', ['server/scripts/test-job-link-decision-date-regression.js']],
  ['node', ['server/scripts/test-title-localization-regression.js']],
  ['node', ['server/scripts/test-ui-accessibility-regressions.js']],
  ['node', ['server/scripts/test-markdown-xss-regressions.js']],
  ['node', ['server/scripts/test-db-integration-safety.js']],
  ['node', ['server/scripts/test-provider-failover-regression.js']],
  ['node', ['server/scripts/test-gemini-retry-regression.js']],
  ['node', ['server/scripts/test-portal-contracts.js']],
  ['node', ['server/scripts/test-route-service-wiring.js']],
  ['node', ['server/scripts/test-service-contracts.js']],
];

for (const [command, args] of commands) {
  const label = [command, ...args].join(' ');
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label}`);
    process.exit(result.status || 1);
  }
}

console.log('\nAll local quality checks passed.');
