import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const [
  { default: dbService },
  { default: promptService },
  { default: collaborationService },
  { default: chatService },
  { default: jobQueryService },
  { default: jobWriteService },
  { default: queueService },
  { default: cacheService },
] = await Promise.all([
  import('../services/dbService.js'),
  import('../services/promptService.js'),
  import('../services/collaborationService.js'),
  import('../services/chatService.js'),
  import('../services/jobQueryService.js'),
  import('../services/jobWriteService.js'),
  import('../services/queueService.js'),
  import('../services/cacheService.js'),
]);

const serviceContracts = [
  [
    'promptService',
    promptService,
    [
      'getPromptsMeta',
      'listPrompts',
      'createPrompt',
      'updatePrompt',
      'deletePrompt',
      'importPrompts',
      'getPromptDefinitionsMeta',
      'getPromptDefinitions',
      'ensurePromptDefinitionsSeeded',
      'listWorkspacePrompts',
      'createWorkspacePrompt',
      'updateWorkspacePrompt',
      'deleteWorkspacePrompt',
      'shareUserPromptToWorkspace',
      'cleanupPromptAuditLogs',
    ],
  ],
  [
    'collaborationService',
    collaborationService,
    [
      'ensureWorkspaceForUser',
      'listWorkspaces',
      'createWorkspace',
      'getWorkspaceRole',
      'getWorkspaceOwnerId',
      'listWorkspaceMembers',
      'addWorkspaceMember',
      'updateWorkspaceMemberRole',
      'removeWorkspaceMember',
      'listMatters',
      'createMatter',
      'getMatter',
      'updateMatter',
      'deleteMatter',
      'listMatterJobs',
      'assignJobToMatter',
      'removeJobFromMatter',
      'createShareLink',
      'listShareLinksForWorkspace',
      'revokeShareLink',
      'getShareLinkByToken',
      'getSharePayloadByToken',
    ],
  ],
  ['chatService', chatService, ['addChatMessage', 'getChatHistory', 'getChatHistoryForWorkspace']],
  [
    'jobQueryService',
    jobQueryService,
    [
      'getJob',
      'getRecentJobs',
      'getRecentJobsForWorkspace',
      'getJobsPage',
      'getJobLight',
      'getJobLightForWorkspace',
      'getJobOwnerId',
      'getJobStatus',
      'summarizeJobForTitle',
      'getJobLinks',
      'getJobLinksLight',
      'getJobLinksLightForWorkspace',
      'getJobResult',
      'getJobResultForWorkspace',
      'getLinksContent',
      'getLinksContentForWorkspace',
      'getActiveJobsCount',
      'getLastRelevantJob',
      'getProcessedUrls',
      'getProcessedMembership',
    ],
  ],
  [
    'jobWriteService',
    jobWriteService,
    [
      'updateJobTitle',
      'updateJobTitleForWorkspace',
      'updateJobStatus',
      'updateAutoTitleIfAllowed',
      'addJobLinks',
      'updateLinkStatus',
      'saveJobResult',
      'deleteJob',
      'deleteJobForWorkspace',
    ],
  ],
  [
    'queueService',
    queueService,
    [
      'recoverStuckJobs',
      'recoverJobsAfterServerRestart',
      'recoverJobsWithStaleHeartbeat',
      'retryFailedJobs',
      'getJobsWithErrors',
      'manualRetryJob',
      'claimNextJob',
      'lockJob',
      'heartbeatJob',
      'clearJobLock',
      'requeueJob',
    ],
  ],
  [
    'cacheService',
    cacheService,
    ['getCachedCaseByUrl', 'saveCaseToCache', 'cleanupOldCacheEntriesOptimized'],
  ],
];

const facadeMethods = [
  'getPromptDefinitions',
  'createPrompt',
  'listWorkspacePrompts',
  'getSharePayloadByToken',
  'getWorkspaceRole',
  'getMatter',
  'getJobResult',
  'getJobLight',
  'updateJobStatus',
  'saveJobResult',
  'claimNextJob',
  'cleanupOldCacheEntriesOptimized',
];

const filesThatShouldNotImportDbService = [
  'server/routes/prompts.js',
  'server/routes/chat.js',
  'server/routes/job-queries.js',
  'server/routes/portal.js',
  'server/routes/admin.js',
  'server/middleware/workspace.js',
  'server/services/maintenance.js',
  'server/index.js',
];

const failures = [];

for (const [name, service, methods] of serviceContracts) {
  for (const method of methods) {
    if (typeof service?.[method] !== 'function') {
      failures.push(`${name}.${method} is missing`);
    }
  }
}

for (const method of facadeMethods) {
  if (typeof dbService?.[method] !== 'function') {
    failures.push(`dbService.${method} facade method is missing`);
  }
}

for (const relativePath of filesThatShouldNotImportDbService) {
  const absolutePath = path.resolve(__dirname, '..', relativePath.replace(/^server\//, ''));
  const source = fs.readFileSync(absolutePath, 'utf8');
  if (
    source.includes("from '../services/dbService.js'") ||
    source.includes("from './dbService.js'")
  ) {
    failures.push(`${relativePath} still imports dbService`);
  }
}

if (failures.length > 0) {
  console.error('Service contract regression check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('OK: service contracts and direct-service imports look consistent.');
