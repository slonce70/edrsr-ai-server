#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
}

const portalSource = read('routes/portal.js');
const adminSource = read('routes/admin.js');
const indexSource = read('routes/index.js');
const authMiddlewareSource = read('middleware/auth.js');
const workerLifecycleSource = read('services/workerLifecycleService.js');
const dbSource = read('database/connection.js');
const envExampleSource = read('env.example');
const envDocsSource = fs.readFileSync(
  path.resolve(serverRoot, '../docs/ENVIRONMENT_VARIABLES.md'),
  'utf8'
);

const expectations = [
  {
    label: 'matters create requires owner/admin',
    ok: /router\.post\(\s*'\/matters',\s*requireWorkspaceRole\(\['owner', 'admin'\]\)/m.test(
      portalSource
    ),
  },
  {
    label: 'matters update requires owner/admin',
    ok: /router\.patch\(\s*'\/matters\/:matterId',\s*requireWorkspaceRole\(\['owner', 'admin'\]\)/m.test(
      portalSource
    ),
  },
  {
    label: 'share links create requires owner/admin',
    ok: /router\.post\(\s*'\/share-links',\s*requireWorkspaceRole\(\['owner', 'admin'\]\)/m.test(
      portalSource
    ),
  },
  {
    label: 'share links revoke requires owner/admin',
    ok: /router\.post\(\s*'\/share-links\/:id\/revoke',\s*requireWorkspaceRole\(\['owner', 'admin'\]\)/m.test(
      portalSource
    ),
  },
  {
    label: 'share link TTL capped at 30 days',
    ok:
      portalSource.includes('parseShareLinkDays') &&
      /MAX_SHARE_LINK_DAYS\s*=\s*30/.test(read('collaborationPolicy.js')),
  },
  {
    label: 'invalid workspace role rejected',
    ok: portalSource.includes('Invalid role'),
  },
  {
    label: 'second workspace owner promotion blocked',
    ok: portalSource.includes('Cannot promote a second workspace owner'),
  },
  {
    label: 'force terminate marks job as force terminated',
    ok:
      indexSource.includes('createWorkerLifecycleService') &&
      workerLifecycleSource.includes('markJobAsForceTerminated') &&
      workerLifecycleSource.includes("updateJobStatus(jobId, 'error'"),
  },
  {
    label: 'worker cleanup has no hardcoded top-level 30 minute killer',
    ok:
      !indexSource.includes('MAX_WORKER_AGE_MS') &&
      !indexSource.includes('Exceeded active worker tracking TTL'),
  },
  {
    label: 'worker healthcheck failure respects auto-terminate config',
    ok:
      indexSource.includes('ENABLE_WORKER_AUTO_TERMINATE') &&
      indexSource.includes('Auto‑terminate disabled') &&
      !/catch \(error\) \{[\s\S]{0,220}forceTerminateWorker\(jobId, 'Воркер не отвечает на health check'\)/m.test(
        indexSource
      ),
  },
  {
    label: 'postgres SSL examples verify certificates by default',
    ok:
      envExampleSource.includes('PG_SSL_REJECT_UNAUTHORIZED=true') &&
      envDocsSource.includes('PG_SSL_REJECT_UNAUTHORIZED=true') &&
      envExampleSource.includes('false only for explicit') &&
      envDocsSource.includes('false only for explicit'),
  },
  {
    label: 'delete user uses DB transaction helper',
    ok: adminSource.includes('database.withClientTransaction'),
  },
  {
    label: 'delete user preserves roles delegated to other users',
    ok:
      adminSource.includes('UPDATE user_roles SET granted_by = NULL WHERE granted_by = $1') &&
      adminSource.includes('DELETE FROM user_roles WHERE user_id = $1') &&
      !adminSource.includes('DELETE FROM user_roles WHERE user_id = $1 OR granted_by = $1'),
  },
  {
    label: 'delete user blocks workspace owners with 409',
    ok:
      adminSource.includes('DELETE_USER_PREFLIGHT_BLOCKED') &&
      adminSource.includes("type: 'workspace_owner'"),
  },
  {
    label: 'delete user reports partial failure after Supabase success',
    ok:
      adminSource.includes('DELETE_USER_PARTIAL_FAILURE') &&
      adminSource.includes('partial_failure: true') &&
      adminSource.includes('local_cleanup_pending: true'),
  },
  {
    label: 'workspace roles normalized by migration',
    ok: dbSource.includes('runMigration_normalizeWorkspaceRoles'),
  },
  {
    label: 'legacy share URLs scrubbed by migration',
    ok: dbSource.includes('runMigration_scrubShareLinkUrls'),
  },
  {
    label: 'workspace role check constraint exists',
    ok: dbSource.includes('workspace_members_role_valid'),
  },
  {
    label: 'extension processed-url bypass stays origin-scoped',
    ok:
      authMiddlewareSource.includes('shouldBypassProcessedUrlAuth') &&
      authMiddlewareSource.includes(
        "process.env.DISABLE_EXTENSION_PROCESSED_URL_FILTER !== 'true'"
      ) &&
      authMiddlewareSource.includes("origin.startsWith('chrome-extension://')") &&
      authMiddlewareSource.includes("req.path === '/processed-urls'") &&
      authMiddlewareSource.includes("req.path === '/urls/processed-check'"),
  },
];

const failures = expectations.filter((item) => !item.ok);

if (failures.length > 0) {
  console.error('Security regression check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.label}`);
  }
  process.exit(1);
}

console.log('OK: security regressions are covered by route, admin, and migration markers.');
