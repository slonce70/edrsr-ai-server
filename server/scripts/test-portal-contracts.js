#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const portalRoutePath = path.resolve(__dirname, '../routes/portal.js');
const source = fs.readFileSync(portalRoutePath, 'utf8');

const expectations = [
  { label: 'public share route', pattern: /router\.get\('\/share\/:token'/ },
  { label: 'share not found', pattern: /Share link not found/ },
  { label: 'share revoked', pattern: /Share link revoked/ },
  { label: 'share expired', pattern: /Share link expired/ },
  { label: 'shared prompts list', pattern: /router\.get\('\/prompts\/shared'/ },
  { label: 'shared prompts create', pattern: /router\.post\(\s*'\/prompts\/shared'/m },
  { label: 'shared prompts update', pattern: /router\.patch\(\s*'\/prompts\/shared\/:id'/m },
  { label: 'shared prompts delete', pattern: /router\.delete\(\s*'\/prompts\/shared\/:id'/m },
  {
    label: 'share user prompt to workspace',
    pattern: /router\.post\(\s*'\/prompts\/shared\/from-user'/m,
  },
  { label: 'workspaces list', pattern: /router\.get\('\/workspaces'/ },
  { label: 'workspaces create', pattern: /router\.post\('\/workspaces'/ },
  {
    label: 'workspace members list',
    pattern: /router\.get\('\/workspaces\/:workspaceId\/members'/,
  },
  {
    label: 'workspace members create',
    pattern: /router\.post\(\s*'\/workspaces\/:workspaceId\/members'/m,
  },
  {
    label: 'workspace members update',
    pattern: /router\.patch\(\s*'\/workspaces\/:workspaceId\/members\/:memberId'/m,
  },
  {
    label: 'workspace members delete',
    pattern: /router\.delete\(\s*'\/workspaces\/:workspaceId\/members\/:memberId'/m,
  },
  { label: 'owner role protection', pattern: /Cannot change owner role/ },
  { label: 'owner removal protection', pattern: /Cannot remove workspace owner/ },
  { label: 'matters list', pattern: /router\.get\('\/matters'/ },
  { label: 'matters create', pattern: /router\.post\('\/matters'/ },
  { label: 'matter detail', pattern: /router\.get\('\/matters\/:matterId'/ },
  { label: 'matter update', pattern: /router\.patch\('\/matters\/:matterId'/ },
  { label: 'matter delete', pattern: /router\.delete\('\/matters\/:matterId'/ },
  { label: 'assign job to matter', pattern: /router\.post\('\/matters\/:matterId\/jobs'/ },
  {
    label: 'remove job from matter',
    pattern: /router\.delete\('\/matters\/:matterId\/jobs\/:jobId'/,
  },
  { label: 'share links list', pattern: /router\.get\('\/share-links'/ },
  { label: 'share links create', pattern: /router\.post\('\/share-links'/ },
  { label: 'share links revoke', pattern: /router\.post\('\/share-links\/:id\/revoke'/ },
  {
    label: 'portal collaboration service import',
    pattern: /from '\.\.\/services\/collaborationService\.js'/,
  },
  { label: 'portal prompt service import', pattern: /from '\.\.\/services\/promptService\.js'/ },
  {
    label: 'portal job query service import',
    pattern: /from '\.\.\/services\/jobQueryService\.js'/,
  },
];

const failures = expectations
  .filter((item) => !item.pattern.test(source))
  .map((item) => `Missing portal contract marker: ${item.label}`);

if (source.includes("from '../services/dbService.js'")) {
  failures.push('portal routes still import dbService');
}

if (failures.length > 0) {
  console.error('Portal contract regression check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('OK: portal routes cover shared prompts, workspace members, matters, and share links.');
