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
const dbSource = read('database/connection.js');

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
      indexSource.includes('markJobAsForceTerminated') &&
      indexSource.includes("updateJobStatus(jobId, 'error'"),
  },
  {
    label: 'delete user uses DB transaction helper',
    ok: adminSource.includes('database.withClientTransaction'),
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
