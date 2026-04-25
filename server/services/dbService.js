import database from '../database/connection.js';
import cacheService from './cacheService.js';
import chatService from './chatService.js';
import collaborationService from './collaborationService.js';
import jobQueryService from './jobQueryService.js';
import jobWriteService from './jobWriteService.js';
import promptService from './promptService.js';
import queueService from './queueService.js';

/*
  SQL to create the cache table:

  CREATE TABLE IF NOT EXISTS parsed_cases (
    url TEXT PRIMARY KEY,
    case_data JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TRIGGER IF NOT EXISTS update_parsed_cases_updated_at
  BEFORE UPDATE ON parsed_cases
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_set_timestamp(); -- Assumes this function exists from other tables
*/

class DatabaseService {
  // ---- JOB CREATION/READ ----
  async createJob(jobData, userId = null, workspaceId = null, matterId = null) {
    const { id, status, totalLinks, prompt, title, titleSource = 'heuristic' } = jobData;
    const autoTitleEnabled =
      typeof jobData.autoTitleEnabled === 'boolean' ? jobData.autoTitleEnabled : true;
    const sql = `
            INSERT INTO jobs (id, title, status, total_links, prompt, progress, processed_links, user_id, workspace_id, matter_id, title_source, user_edited, auto_title_enabled)
            VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7, $8, $9, false, $10)
        `;
    await database.run(sql, [
      id,
      title,
      status,
      totalLinks,
      prompt,
      userId,
      workspaceId,
      matterId,
      titleSource,
      autoTitleEnabled,
    ]);

    if (jobData.links && jobData.links.length > 0) {
      await jobWriteService.addJobLinks(id, jobData.links, userId);
    }
    return await jobQueryService.getJob(id, userId);
  }

  async getJob(jobId, userId = null) {
    return await jobQueryService.getJob(jobId, userId);
  }

  // ---- USER PROMPTS ----
  async getPromptsMeta(userId) {
    return await promptService.getPromptsMeta(userId);
  }

  async listPrompts(userId) {
    return await promptService.listPrompts(userId);
  }

  async createPrompt(userId, name, content) {
    return await promptService.createPrompt(userId, name, content);
  }

  async updatePrompt(userId, promptId, { name, content }) {
    return await promptService.updatePrompt(userId, promptId, { name, content });
  }

  async deletePrompt(userId, promptId) {
    return await promptService.deletePrompt(userId, promptId);
  }

  async importPrompts(userId, prompts) {
    return await promptService.importPrompts(userId, prompts);
  }

  // ---- PROMPT DEFINITIONS ----
  async getPromptDefinitionsMeta() {
    return await promptService.getPromptDefinitionsMeta();
  }

  async getPromptDefinitions() {
    return await promptService.getPromptDefinitions();
  }

  async ensurePromptDefinitionsSeeded() {
    return await promptService.ensurePromptDefinitionsSeeded();
  }

  // ---- WORKSPACE PROMPTS (SHARED) ----
  async listWorkspacePrompts(workspaceId) {
    return await promptService.listWorkspacePrompts(workspaceId);
  }

  async resolveUniqueWorkspacePromptName(workspaceId, desiredName, excludeId = null) {
    return await promptService.resolveUniqueWorkspacePromptName(
      workspaceId,
      desiredName,
      excludeId
    );
  }

  async createWorkspacePrompt(workspaceId, userId, name, content, action = 'create') {
    return await promptService.createWorkspacePrompt(workspaceId, userId, name, content, action);
  }

  async updateWorkspacePrompt(workspaceId, promptId, { name, content }, userId) {
    return await promptService.updateWorkspacePrompt(
      workspaceId,
      promptId,
      { name, content },
      userId
    );
  }

  async deleteWorkspacePrompt(workspaceId, promptId, userId) {
    return await promptService.deleteWorkspacePrompt(workspaceId, promptId, userId);
  }

  async shareUserPromptToWorkspace(workspaceId, userId, promptId) {
    return await promptService.shareUserPromptToWorkspace(workspaceId, userId, promptId);
  }

  // ---- PROMPT AUDIT LOG ----
  async logPromptAudit({ userId, workspaceId, promptId, scope, action, details = {} }) {
    return await promptService.logPromptAudit({
      userId,
      workspaceId,
      promptId,
      scope,
      action,
      details,
    });
  }

  async cleanupPromptAuditLogs(retentionDays = 90) {
    return await promptService.cleanupPromptAuditLogs(retentionDays);
  }

  async resolveUniquePromptName(userId, desiredName, excludeId = null) {
    return await promptService.resolveUniquePromptName(userId, desiredName, excludeId);
  }

  async getRecentJobs(limit = null, userId = null) {
    return await jobQueryService.getRecentJobs(limit, userId);
  }

  async getRecentJobsForWorkspace(workspaceId, limit = null) {
    return await jobQueryService.getRecentJobsForWorkspace(workspaceId, limit);
  }

  async getJobsPage({
    page = 1,
    limit = 20,
    status = '',
    search = '',
    userId = null,
    workspaceId = null,
  } = {}) {
    return await jobQueryService.getJobsPage({
      page,
      limit,
      status,
      search,
      userId,
      workspaceId,
    });
  }

  async getJobLight(jobId, userId = null) {
    return await jobQueryService.getJobLight(jobId, userId);
  }

  async getJobLightForWorkspace(jobId, workspaceId) {
    return await jobQueryService.getJobLightForWorkspace(jobId, workspaceId);
  }

  async updateJobTitle(jobId, title, userId = null) {
    return await jobWriteService.updateJobTitle(jobId, title, userId);
  }

  async updateJobTitleForWorkspace(jobId, title, workspaceId) {
    return await jobWriteService.updateJobTitleForWorkspace(jobId, title, workspaceId);
  }

  async updateJobStatus(jobId, status, additionalData = {}) {
    return await jobWriteService.updateJobStatus(jobId, status, additionalData);
  }

  async updateAutoTitleIfAllowed(jobId, newTitle, source = 'heuristic') {
    return await jobWriteService.updateAutoTitleIfAllowed(jobId, newTitle, source);
  }

  async getJobOwnerId(jobId) {
    return await jobQueryService.getJobOwnerId(jobId);
  }

  async getJobStatus(jobId) {
    return await jobQueryService.getJobStatus(jobId);
  }

  async summarizeJobForTitle(jobId, userId = null) {
    return await jobQueryService.summarizeJobForTitle(jobId, userId);
  }

  async addJobLinks(jobId, links, userId = null) {
    return await jobWriteService.addJobLinks(jobId, links, userId);
  }

  async getJobLinks(jobId, userId = null) {
    return await jobQueryService.getJobLinks(jobId, userId);
  }

  async getJobLinksLight(jobId, userId = null) {
    return await jobQueryService.getJobLinksLight(jobId, userId);
  }

  async getJobLinksLightForWorkspace(jobId, workspaceId) {
    return await jobQueryService.getJobLinksLightForWorkspace(jobId, workspaceId);
  }

  async updateLinkStatus(jobId, url, status, content = null, errorMessage = null, metadata = null) {
    return await jobWriteService.updateLinkStatus(
      jobId,
      url,
      status,
      content,
      errorMessage,
      metadata
    );
  }

  async saveJobResult(jobId, analysisText) {
    return await jobWriteService.saveJobResult(jobId, analysisText);
  }

  async getJobResult(jobId, userId = null) {
    return await jobQueryService.getJobResult(jobId, userId);
  }

  async getJobResultForWorkspace(jobId, workspaceId) {
    return await jobQueryService.getJobResultForWorkspace(jobId, workspaceId);
  }

  async getLinksContent(jobId, userId = null) {
    return await jobQueryService.getLinksContent(jobId, userId);
  }

  async getLinksContentForWorkspace(jobId, workspaceId) {
    return await jobQueryService.getLinksContentForWorkspace(jobId, workspaceId);
  }

  async addChatMessage(jobId, role, content, userId = null) {
    return await chatService.addChatMessage(jobId, role, content, userId);
  }

  async getChatHistory(jobId, userId = null, limit = 50) {
    return await chatService.getChatHistory(jobId, userId, limit);
  }

  async getChatHistoryForWorkspace(jobId, workspaceId, limit = 50) {
    return await chatService.getChatHistoryForWorkspace(jobId, workspaceId, limit);
  }

  // --- Caching Methods ---

  async getCachedCaseByUrl(url, userId = null) {
    return await cacheService.getCachedCaseByUrl(url, userId);
  }

  async saveCaseToCache(caseData, userId = null) {
    return await cacheService.saveCaseToCache(caseData, userId);
  }

  // Optimized cleanup using a cutoff timestamp to avoid large NOT IN subqueries
  async cleanupOldCacheEntriesOptimized(maxEntries = null) {
    return await cacheService.cleanupOldCacheEntriesOptimized(maxEntries);
  }

  // --- End Caching Methods ---

  async getActiveJobsCount(userId = null) {
    return await jobQueryService.getActiveJobsCount(userId);
  }

  async getLastRelevantJob(userId = null) {
    return await jobQueryService.getLastRelevantJob(userId);
  }

  async deleteJob(jobId, userId = null) {
    return await jobWriteService.deleteJob(jobId, userId);
  }

  async deleteJobForWorkspace(jobId, workspaceId) {
    return await jobWriteService.deleteJobForWorkspace(jobId, workspaceId);
  }

  async getProcessedUrls(userId = null) {
    return await jobQueryService.getProcessedUrls(userId);
  }

  async getProcessedMembership(urls = [], userId = null) {
    return await jobQueryService.getProcessedMembership(urls, userId);
  }

  // ---- QUEUE/LEASING OPERATIONS ----

  async recoverStuckJobs() {
    return await queueService.recoverStuckJobs();
  }

  async recoverJobsAfterServerRestart(serverStartedAtIso) {
    return await queueService.recoverJobsAfterServerRestart(serverStartedAtIso);
  }

  async recoverJobsWithStaleHeartbeat(graceMinutes = 5) {
    return await queueService.recoverJobsWithStaleHeartbeat(graceMinutes);
  }

  async retryFailedJobs() {
    return await queueService.retryFailedJobs();
  }

  async getJobsWithErrors(limit = 10) {
    return await queueService.getJobsWithErrors(limit);
  }

  async manualRetryJob(jobId) {
    return await queueService.manualRetryJob(jobId);
  }

  async claimNextJob(workerId) {
    return await queueService.claimNextJob(workerId);
  }

  async lockJob(jobId, workerId) {
    return await queueService.lockJob(jobId, workerId);
  }

  async heartbeatJob(jobId, workerId) {
    return await queueService.heartbeatJob(jobId, workerId);
  }

  async clearJobLock(jobId) {
    return await queueService.clearJobLock(jobId);
  }

  // ---- WORKSPACES & MEMBERS ----
  async ensureWorkspaceForUser(userId, email = null) {
    return await collaborationService.ensureWorkspaceForUser(userId, email);
  }

  async listWorkspaces(userId) {
    return await collaborationService.listWorkspaces(userId);
  }

  async createWorkspace(userId, name) {
    return await collaborationService.createWorkspace(userId, name);
  }

  async getWorkspaceRole(userId, workspaceId) {
    return await collaborationService.getWorkspaceRole(userId, workspaceId);
  }

  async listWorkspaceMembers(workspaceId) {
    return await collaborationService.listWorkspaceMembers(workspaceId);
  }

  async addWorkspaceMember(workspaceId, email, role = 'member', invitedBy = null) {
    return await collaborationService.addWorkspaceMember(workspaceId, email, role, invitedBy);
  }

  async updateWorkspaceMemberRole(workspaceId, userId, role) {
    return await collaborationService.updateWorkspaceMemberRole(workspaceId, userId, role);
  }

  async removeWorkspaceMember(workspaceId, userId) {
    return await collaborationService.removeWorkspaceMember(workspaceId, userId);
  }

  // ---- MATTERS ----
  async listMatters(workspaceId) {
    return await collaborationService.listMatters(workspaceId);
  }

  async createMatter(
    { workspaceId, title, description = null, clientName = null, tags = [] },
    userId
  ) {
    return await collaborationService.createMatter(
      { workspaceId, title, description, clientName, tags },
      userId
    );
  }

  async getMatter(matterId, workspaceId) {
    return await collaborationService.getMatter(matterId, workspaceId);
  }

  async updateMatter(matterId, workspaceId, updates = {}) {
    return await collaborationService.updateMatter(matterId, workspaceId, updates);
  }

  async deleteMatter(matterId, workspaceId) {
    return await collaborationService.deleteMatter(matterId, workspaceId);
  }

  async listMatterJobs(matterId, workspaceId) {
    return await collaborationService.listMatterJobs(matterId, workspaceId);
  }

  async assignJobToMatter(jobId, matterId, workspaceId) {
    return await collaborationService.assignJobToMatter(jobId, matterId, workspaceId);
  }

  async removeJobFromMatter(jobId, matterId, workspaceId) {
    return await collaborationService.removeJobFromMatter(jobId, matterId, workspaceId);
  }

  // ---- SHARE LINKS ----
  async createShareLink(jobId, createdBy, expiresAt) {
    return await collaborationService.createShareLink(jobId, createdBy, expiresAt);
  }

  async listShareLinksForWorkspace(workspaceId) {
    return await collaborationService.listShareLinksForWorkspace(workspaceId);
  }

  async revokeShareLink(id, workspaceId = null) {
    return await collaborationService.revokeShareLink(id, workspaceId);
  }

  async getShareLinkByToken(token) {
    return await collaborationService.getShareLinkByToken(token);
  }

  async getSharePayloadByToken(token) {
    return await collaborationService.getSharePayloadByToken(token);
  }

  async requeueJob(jobId, { resetLinks = false } = {}) {
    return await queueService.requeueJob(jobId, { resetLinks });
  }
}

export default new DatabaseService();

class SearchService {
  async search(query) {
    const sql = `SELECT * FROM edrsr WHERE name LIKE $1`;
    const params = [`%${query}%`];
    return await database.all(sql, params);
  }
}

export const searchService = new SearchService();
