#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const checks = [
  {
    file: 'routes/prompts.js',
    mustInclude: ["from '../services/promptService.js'"],
    mustExclude: ["from '../services/dbService.js'"],
  },
  {
    file: 'routes/chat.js',
    mustInclude: ["from '../services/chatService.js'", "from '../services/jobQueryService.js'"],
    mustExclude: ["from '../services/dbService.js'"],
  },
  {
    file: 'routes/job-queries.js',
    mustInclude: ["from '../services/jobQueryService.js'"],
    mustExclude: ["from '../services/dbService.js'"],
  },
  {
    file: 'routes/portal.js',
    mustInclude: [
      "from '../services/collaborationService.js'",
      "from '../services/promptService.js'",
      "from '../services/jobQueryService.js'",
    ],
    mustExclude: ["from '../services/dbService.js'"],
  },
  {
    file: 'middleware/workspace.js',
    mustInclude: ["from '../services/collaborationService.js'"],
    mustExclude: ["from '../services/dbService.js'"],
  },
  {
    file: 'services/maintenance.js',
    mustInclude: ["from './cacheService.js'", "from './promptService.js'"],
    mustExclude: ["from './dbService.js'"],
  },
  {
    file: 'index.js',
    mustInclude: ["from './services/promptService.js'"],
    mustExclude: ["from './services/dbService.js'"],
  },
  {
    file: 'routes/admin.js',
    mustInclude: ["from '../services/queueService.js'", "from '../services/jobWriteService.js'"],
    mustExclude: ["from '../services/dbService.js'"],
  },
  {
    file: 'routes/index.js',
    mustInclude: [
      "from '../services/collaborationService.js'",
      "from '../services/jobQueryService.js'",
      "from '../services/jobWriteService.js'",
      "from '../services/queueService.js'",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const absolutePath = path.join(serverRoot, check.file);
  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const text of check.mustInclude || []) {
    if (!source.includes(text)) {
      failures.push(`${check.file} is missing expected import: ${text}`);
    }
  }

  for (const text of check.mustExclude || []) {
    if (source.includes(text)) {
      failures.push(`${check.file} still contains forbidden import: ${text}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Route/service wiring regression check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('OK: migrated routes and middleware use direct services as expected.');
