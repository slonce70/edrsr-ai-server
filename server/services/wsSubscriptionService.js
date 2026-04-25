export async function canSubscribeToJob({ jobId, userId, workspaceId = null, deps }) {
  if (!jobId || !userId || !deps) return false;

  const ownedJob = await deps.getJob(jobId, userId);
  if (ownedJob) return true;

  if (!workspaceId) return false;

  const role = await deps.getWorkspaceRole(userId, workspaceId);
  if (!role) return false;

  const workspaceJob = await deps.getJobLightForWorkspace(jobId, workspaceId);
  return Boolean(workspaceJob);
}
