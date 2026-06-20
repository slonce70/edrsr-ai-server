import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const serviceContracts = [
  [
    'promptService',
    'services/promptService.js',
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
    'services/collaborationService.js',
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
  [
    'chatService',
    'services/chatService.js',
    ['addChatMessage', 'getChatHistory', 'getChatHistoryForWorkspace'],
  ],
  [
    'jobQueryService',
    'services/jobQueryService.js',
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
      'getOverview',
    ],
  ],
  [
    'jobWriteService',
    'services/jobWriteService.js',
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
    'jobTitleService',
    'services/jobTitleService.js',
    ['generateInitialTitle', 'refreshHeuristicTitle'],
  ],
  [
    'workerLifecycleService',
    'services/workerLifecycleService.js',
    ['createWorkerLifecycleService'],
  ],
  [
    'queueService',
    'services/queueService.js',
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
    'services/cacheService.js',
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

function read(relativePath) {
  return fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
}

function hasFunction(source, method) {
  const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\basync\\s+${escaped}\\s*\\(`),
    new RegExp(`\\b${escaped}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`\\bexport\\s+(async\\s+)?function\\s+${escaped}\\s*\\(`),
    new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*(async\\s*)?\\(`),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

for (const [name, relativePath, methods] of serviceContracts) {
  const source = read(relativePath);
  for (const method of methods) {
    if (!hasFunction(source, method)) {
      failures.push(`${name}.${method} is missing`);
    }
  }
}

const dbServiceSource = read('services/dbService.js');
for (const method of facadeMethods) {
  if (!hasFunction(dbServiceSource, method)) {
    failures.push(`dbService.${method} facade method is missing`);
  }
}

for (const relativePath of filesThatShouldNotImportDbService) {
  const source = read(relativePath.replace(/^server\//, ''));
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
