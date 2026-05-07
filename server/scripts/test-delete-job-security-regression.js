#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/job-mutations.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../routes/index.js'), 'utf8');

const routeMatch = routeSource.match(
  /router\.delete\('\/jobs\/:id', async \(req, res, next\) => \{([\s\S]*?)\n {2}\}\);/
);

assert.ok(routeMatch, 'DELETE /jobs/:id route should exist');

const routeBody = routeMatch[1];
const workspaceCheck = routeBody.indexOf('const workspace = await resolveWorkspaceFromQuery');
const workerLookup = routeBody.indexOf('hasActiveWorker(id)');
const workerTerminate = routeBody.indexOf('terminateWorker(id');

assert.notEqual(workspaceCheck, -1, 'delete route should resolve workspace/authz context');
assert.notEqual(workerLookup, -1, 'delete route should inspect active worker after authz');
assert.notEqual(workerTerminate, -1, 'delete route should terminate authorized active workers');
assert.ok(
  workspaceCheck < workerLookup,
  'delete route must resolve workspace/ownership before looking up active worker'
);
assert.ok(
  workspaceCheck < workerTerminate,
  'delete route must finish access checks before terminating active worker'
);

assert.match(
  routeBody,
  /await jobQueryService\.getJobLight\(id, req\.user\?\.id \|\| null\)/,
  'non-workspace delete should verify ownership before side effects'
);
assert.match(
  routeBody,
  /if \(!job\) return res\.status\(404\)\.json\(\{ error: 'Задание не найдено' \}\)/,
  'non-workspace delete should not report success for inaccessible jobs'
);
assert.match(
  indexSource,
  /hasActiveWorker: \(jobId\) => activeWorkers\.has\(jobId\)/,
  'route layer should provide active worker lookup without exposing the map to mutation routes'
);

console.log('Delete job security regression passed.');
