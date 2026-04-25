import assert from 'node:assert/strict';

import { canSubscribeToJob } from '../services/wsSubscriptionService.js';

async function run() {
  const calls = [];
  const deps = {
    async getJob(jobId, userId) {
      calls.push(['getJob', jobId, userId]);
      return jobId === 'own-job' && userId === 'user-1' ? { id: jobId } : null;
    },
    async getWorkspaceRole(userId, workspaceId) {
      calls.push(['getWorkspaceRole', userId, workspaceId]);
      if (userId === 'user-1' && workspaceId === 'workspace-1') return 'member';
      return null;
    },
    async getJobLightForWorkspace(jobId, workspaceId) {
      calls.push(['getJobLightForWorkspace', jobId, workspaceId]);
      if (jobId === 'shared-job' && workspaceId === 'workspace-1') return { id: jobId };
      return null;
    },
  };

  assert.equal(
    await canSubscribeToJob({
      jobId: 'own-job',
      userId: 'user-1',
      deps,
    }),
    true,
    'owner should subscribe by job ownership'
  );

  assert.equal(
    await canSubscribeToJob({
      jobId: 'shared-job',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      deps,
    }),
    true,
    'workspace member should subscribe to shared workspace job'
  );

  assert.equal(
    await canSubscribeToJob({
      jobId: 'shared-job',
      userId: 'user-2',
      workspaceId: 'workspace-1',
      deps,
    }),
    false,
    'non-member should not subscribe to workspace job'
  );

  assert.deepEqual(
    calls.filter(([name]) => name === 'getJobLightForWorkspace'),
    [['getJobLightForWorkspace', 'shared-job', 'workspace-1']],
    'authorized workspace subscriptions should verify job membership through the workspace query'
  );

  console.log('WebSocket subscription authorization regressions passed.');
}

run().catch((error) => {
  console.error('WebSocket subscription authorization regression failed:', error);
  process.exit(1);
});
