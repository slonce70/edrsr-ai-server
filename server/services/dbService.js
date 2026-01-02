import crypto from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import database from '../database/connection.js';
import { v4 as uuid } from 'uuid';
import { logger } from '../utils.js';
import { extractEvidenceSnippet } from './evidenceService.js';
import { getDefaultPromptDefinitions } from '../prompt-definitions.js';

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeLike = (value) => String(value || '').replace(/[\\%_]/g, '\\$&');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

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
      await this.addJobLinks(id, jobData.links, userId);
    }
    return await this.getJob(id, userId);
  }

  async getJob(jobId, userId = null) {
    // Один запрос с JOIN'ами для получения всех данных
    const jobSql = userId
      ? `SELECT * FROM jobs WHERE id = $1 AND user_id = $2`
      : `SELECT * FROM jobs WHERE id = $1`;
    const jobParams = userId ? [jobId, userId] : [jobId];
    const job = await database.get(jobSql, jobParams);

    if (!job) return null;

    const [links, analysis] = await Promise.all([
      this.getJobLinks(jobId, userId),
      this.getJobResult(jobId, userId),
    ]);

    if (job) {
      job.links = links;
      job.analysis = analysis;
    }
    return job;
  }

  // ---- USER PROMPTS ----
  async getPromptsMeta(userId) {
    const row = await database.get(
      'SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_updated FROM user_prompts WHERE user_id = $1',
      [userId]
    );
    return {
      count: row?.count || 0,
      lastUpdated: row?.last_updated || null,
    };
  }

  async listPrompts(userId) {
    return await database.all(
      `SELECT id, name, content, created_at, updated_at
       FROM user_prompts
       WHERE user_id = $1
       ORDER BY updated_at DESC, name ASC`,
      [userId]
    );
  }

  async createPrompt(userId, name, content) {
    const { name: finalName, renamed } = await this.resolveUniquePromptName(userId, name);
    const id = uuid();
    const row = await database.get(
      `INSERT INTO user_prompts (id, user_id, name, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, content, created_at, updated_at`,
      [id, userId, finalName, content]
    );
    this.logPromptAudit({
      userId,
      workspaceId: null,
      promptId: row?.id || id,
      scope: 'user',
      action: 'create',
      details: { renamed },
    });
    return { prompt: row, renamed };
  }

  async updatePrompt(userId, promptId, { name, content }) {
    const current = await database.get(
      'SELECT id, name, content FROM user_prompts WHERE id = $1 AND user_id = $2',
      [promptId, userId]
    );
    if (!current) return null;

    let finalName = current.name;
    let renamed = false;
    if (typeof name === 'string' && name.trim() && name.trim() !== current.name) {
      const resolved = await this.resolveUniquePromptName(userId, name, promptId);
      finalName = resolved.name;
      renamed = resolved.renamed;
    }

    const finalContent =
      typeof content === 'string' && content.trim() ? content.trim() : current.content;

    const row = await database.get(
      `UPDATE user_prompts
       SET name = $1, content = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4
       RETURNING id, name, content, created_at, updated_at`,
      [finalName, finalContent, promptId, userId]
    );
    this.logPromptAudit({
      userId,
      workspaceId: null,
      promptId: row?.id || promptId,
      scope: 'user',
      action: 'update',
      details: { renamed },
    });
    return { prompt: row, renamed };
  }

  async deletePrompt(userId, promptId) {
    const row = await database.get(
      'DELETE FROM user_prompts WHERE id = $1 AND user_id = $2 RETURNING id',
      [promptId, userId]
    );
    if (row?.id) {
      this.logPromptAudit({
        userId,
        workspaceId: null,
        promptId: row.id,
        scope: 'user',
        action: 'delete',
      });
    }
    return !!row?.id;
  }

  async importPrompts(userId, prompts) {
    const imported = [];
    let renamedCount = 0;
    for (const prompt of prompts) {
      try {
        const result = await this.createPrompt(userId, prompt.name, prompt.content);
        if (result?.prompt) {
          imported.push(result.prompt);
          if (result.renamed) renamedCount += 1;
        }
      } catch (e) {
        logger.warn('[DB] importPrompts skipped item:', e.message);
      }
    }
    if (imported.length > 0) {
      this.logPromptAudit({
        userId,
        workspaceId: null,
        promptId: null,
        scope: 'user',
        action: 'import',
        details: { imported: imported.length, renamedCount },
      });
    }
    return { imported, renamedCount };
  }

  // ---- PROMPT DEFINITIONS ----
  async getPromptDefinitionsMeta() {
    const row = await database.get(
      'SELECT version, updated_at FROM prompt_definitions ORDER BY updated_at DESC LIMIT 1'
    );
    return {
      version: row?.version || 1,
      lastUpdated: row?.updated_at || null,
    };
  }

  async getPromptDefinitions() {
    const row = await database.get(
      'SELECT payload, version, updated_at FROM prompt_definitions ORDER BY updated_at DESC LIMIT 1'
    );
    if (!row) return null;
    return {
      payload: row.payload,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async ensurePromptDefinitionsSeeded() {
    const defaults = getDefaultPromptDefinitions();
    const defaultVersion = Number.isFinite(defaults?.version) ? defaults.version : 1;

    const latest = await database.get(
      'SELECT id, version, payload FROM prompt_definitions ORDER BY updated_at DESC LIMIT 1'
    );

    if (latest?.payload && isDeepStrictEqual(latest.payload, defaults)) {
      return false;
    }

    const currentVersion = Number.isFinite(latest?.version) ? latest.version : 0;
    const nextVersion = latest ? Math.max(currentVersion + 1, defaultVersion) : defaultVersion;

    await database.run(
      `INSERT INTO prompt_definitions (version, payload, created_at, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [nextVersion, defaults]
    );
    this.logPromptAudit({
      userId: null,
      workspaceId: null,
      promptId: null,
      scope: 'definitions',
      action: latest ? 'update' : 'seed',
      details: latest
        ? { fromVersion: currentVersion, toVersion: nextVersion }
        : { version: nextVersion },
    });
    return true;
  }

  // ---- WORKSPACE PROMPTS (SHARED) ----
  async listWorkspacePrompts(workspaceId) {
    return await database.all(
      `SELECT id, name, content, created_at, updated_at, created_by, updated_by
       FROM workspace_prompts
       WHERE workspace_id = $1
       ORDER BY updated_at DESC, name ASC`,
      [workspaceId]
    );
  }

  async resolveUniqueWorkspacePromptName(workspaceId, desiredName, excludeId = null) {
    const base = String(desiredName || '').trim();
    const likePattern = `${escapeLike(base)} (%)`;
    const params = [workspaceId, base, likePattern];
    let sql = `
      SELECT name FROM workspace_prompts
      WHERE workspace_id = $1 AND (name = $2 OR name LIKE $3 ESCAPE '\\')
    `;
    if (excludeId) {
      sql += ' AND id <> $4';
      params.push(excludeId);
    }
    const rows = await database.all(sql, params);
    if (!rows || rows.length === 0) return { name: base, renamed: false };

    const regex = new RegExp(`^${escapeRegExp(base)}(?: \\((\\d+)\\))?$`);
    let hasBase = false;
    let maxSuffix = 1;
    for (const row of rows) {
      const match = regex.exec(row.name);
      if (!match) continue;
      if (!match[1]) {
        hasBase = true;
        continue;
      }
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num)) maxSuffix = Math.max(maxSuffix, num);
    }

    if (!hasBase) return { name: base, renamed: false };
    return { name: `${base} (${maxSuffix + 1})`, renamed: true };
  }

  async createWorkspacePrompt(workspaceId, userId, name, content, action = 'create') {
    const { name: finalName, renamed } = await this.resolveUniqueWorkspacePromptName(
      workspaceId,
      name
    );
    const id = uuid();
    const row = await database.get(
      `INSERT INTO workspace_prompts
       (id, workspace_id, name, content, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, content, created_at, updated_at, created_by, updated_by`,
      [id, workspaceId, finalName, content, userId]
    );
    this.logPromptAudit({
      userId,
      workspaceId,
      promptId: row?.id || id,
      scope: 'shared',
      action,
      details: { renamed },
    });
    return { prompt: row, renamed };
  }

  async updateWorkspacePrompt(workspaceId, promptId, { name, content }, userId) {
    const current = await database.get(
      `SELECT id, name, content
       FROM workspace_prompts
       WHERE id = $1 AND workspace_id = $2`,
      [promptId, workspaceId]
    );
    if (!current) return null;

    let finalName = current.name;
    let renamed = false;
    if (typeof name === 'string' && name.trim() && name.trim() !== current.name) {
      const resolved = await this.resolveUniqueWorkspacePromptName(workspaceId, name, promptId);
      finalName = resolved.name;
      renamed = resolved.renamed;
    }

    const finalContent =
      typeof content === 'string' && content.trim() ? content.trim() : current.content;

    const row = await database.get(
      `UPDATE workspace_prompts
       SET name = $1, content = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND workspace_id = $5
       RETURNING id, name, content, created_at, updated_at, created_by, updated_by`,
      [finalName, finalContent, userId, promptId, workspaceId]
    );
    this.logPromptAudit({
      userId,
      workspaceId,
      promptId: row?.id || promptId,
      scope: 'shared',
      action: 'update',
      details: { renamed },
    });
    return { prompt: row, renamed };
  }

  async deleteWorkspacePrompt(workspaceId, promptId, userId) {
    const row = await database.get(
      `DELETE FROM workspace_prompts
       WHERE id = $1 AND workspace_id = $2
       RETURNING id`,
      [promptId, workspaceId]
    );
    if (row?.id) {
      this.logPromptAudit({
        userId,
        workspaceId,
        promptId: row.id,
        scope: 'shared',
        action: 'delete',
      });
    }
    return !!row?.id;
  }

  async shareUserPromptToWorkspace(workspaceId, userId, promptId) {
    const source = await database.get(
      `SELECT id, name, content
       FROM user_prompts
       WHERE id = $1 AND user_id = $2`,
      [promptId, userId]
    );
    if (!source) return null;
    const result = await this.createWorkspacePrompt(
      workspaceId,
      userId,
      source.name,
      source.content,
      'share'
    );
    return { shared: result.prompt, renamed: result.renamed };
  }

  // ---- PROMPT AUDIT LOG ----
  async logPromptAudit({ userId, workspaceId, promptId, scope, action, details = {} }) {
    try {
      await database.run(
        `INSERT INTO prompt_audit_log
         (user_id, workspace_id, prompt_id, prompt_scope, action, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [userId, workspaceId, promptId, scope, action, details]
      );
    } catch (e) {
      logger.warn('[AUDIT] Failed to log prompt audit:', e.message);
    }
  }

  async cleanupPromptAuditLogs(retentionDays = 90) {
    const days = Number.isFinite(retentionDays) ? retentionDays : 90;
    if (days <= 0) return 0;
    const result = await database.run(
      "DELETE FROM prompt_audit_log WHERE created_at < NOW() - ($1 || ' days')::interval",
      [days]
    );
    return result.changes || 0;
  }

  async resolveUniquePromptName(userId, desiredName, excludeId = null) {
    const base = String(desiredName || '').trim();
    const likePattern = `${escapeLike(base)} (%)`;
    const params = [userId, base, likePattern];
    let sql = `
      SELECT name FROM user_prompts
      WHERE user_id = $1 AND (name = $2 OR name LIKE $3 ESCAPE '\\')
    `;
    if (excludeId) {
      sql += ' AND id <> $4';
      params.push(excludeId);
    }
    const rows = await database.all(sql, params);
    if (!rows || rows.length === 0) return { name: base, renamed: false };

    const regex = new RegExp(`^${escapeRegExp(base)}(?: \\((\\d+)\\))?$`);
    let hasBase = false;
    let maxSuffix = 1;
    for (const row of rows) {
      const match = regex.exec(row.name);
      if (!match) continue;
      if (!match[1]) {
        hasBase = true;
        continue;
      }
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num)) maxSuffix = Math.max(maxSuffix, num);
    }

    if (!hasBase) return { name: base, renamed: false };
    return { name: `${base} (${maxSuffix + 1})`, renamed: true };
  }

  async getRecentJobs(limit = null, userId = null) {
    const base = `SELECT id, status, progress, total_links, created_at, updated_at, title FROM jobs`;
    if (userId) {
      if (limit === null || limit === 'all') {
        return await database.all(`${base} WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      }
      return await database.all(`${base} WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [
        userId,
        limit,
      ]);
    }
    if (limit === null || limit === 'all') {
      return await database.all(`${base} ORDER BY created_at DESC`);
    }
    return await database.all(`${base} ORDER BY created_at DESC LIMIT $1`, [limit]);
  }

  async getRecentJobsForWorkspace(workspaceId, limit = null) {
    const base =
      'SELECT id, status, progress, total_links, created_at, updated_at, title FROM jobs WHERE workspace_id = $1';
    if (limit === null || limit === 'all') {
      return await database.all(`${base} ORDER BY created_at DESC`, [workspaceId]);
    }
    return await database.all(`${base} ORDER BY created_at DESC LIMIT $2`, [workspaceId, limit]);
  }

  async getJobsPage({
    page = 1,
    limit = 20,
    status = '',
    search = '',
    userId = null,
    workspaceId = null,
  } = {}) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
    const where = [];
    const params = [];
    let idx = 1;

    if (workspaceId) {
      where.push(`workspace_id = $${idx}`);
      params.push(workspaceId);
      idx++;
    } else if (userId) {
      where.push(`user_id = $${idx}`);
      params.push(userId);
      idx++;
    }
    if (status) {
      where.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (search) {
      const safeSearch = `%${escapeLike(search)}%`;
      where.push(`(title ILIKE $${idx} OR prompt ILIKE $${idx})`);
      params.push(safeSearch);
      idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (safePage - 1) * safeLimit;

    const jobs = await database.all(
      `SELECT id, status, progress, processed_links, total_links, created_at, updated_at, title, duration, matter_id
       FROM jobs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, safeLimit, offset]
    );

    const totalRow = await database.get(
      `SELECT COUNT(*)::int AS total FROM jobs ${whereClause}`,
      params
    );

    return {
      jobs,
      total: totalRow?.total || 0,
      page: safePage,
      limit: safeLimit,
    };
  }

  async getJobLight(jobId, userId = null) {
    const sql = userId
      ? `SELECT id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration, workspace_id, matter_id FROM jobs WHERE id = $1 AND user_id = $2`
      : `SELECT id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration, workspace_id, matter_id FROM jobs WHERE id = $1`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.get(sql, params);
  }

  async getJobLightForWorkspace(jobId, workspaceId) {
    return await database.get(
      `SELECT id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration, workspace_id, matter_id, user_id
       FROM jobs
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId]
    );
  }

  async updateJobTitle(jobId, title, userId = null) {
    const sql = userId
      ? `UPDATE jobs SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at`
      : `UPDATE jobs SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at`;
    const params = userId ? [title, jobId, userId] : [title, jobId];
    const updated = await database.get(sql, params);
    return updated;
  }

  async updateJobTitleForWorkspace(jobId, title, workspaceId) {
    const updated = await database.get(
      `UPDATE jobs
       SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND workspace_id = $3
       RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at`,
      [title, jobId, workspaceId]
    );
    return updated;
  }

  async updateJobStatus(jobId, status, additionalData = {}) {
    const params = [status];
    const allowedFields = ['progress', 'processed_links', 'error_message', 'duration', 'end_time'];

    let setClauses = 'status = $1, updated_at = CURRENT_TIMESTAMP';
    let paramIndex = 2;

    for (const field in additionalData) {
      if (allowedFields.includes(field)) {
        setClauses += `, ${field} = $${paramIndex}`;
        params.push(additionalData[field]);
        paramIndex++;
      }
    }

    params.push(jobId);
    // Return only lightweight fields to avoid heavy reads during progress updates
    const sql = `
      UPDATE jobs
      SET ${setClauses}
      WHERE id = $${paramIndex}
      RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration
    `;

    const updated = await database.get(sql, params);
    return updated;
  }

  async updateAutoTitleIfAllowed(jobId, newTitle, source = 'heuristic') {
    const sql = `
      UPDATE jobs
      SET title = $1, title_source = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND COALESCE(user_edited, false) = false AND COALESCE(auto_title_enabled, true) = true`;
    const res = await database.run(sql, [newTitle, source, jobId]);
    return res.changes > 0;
  }

  async getJobOwnerId(jobId) {
    const row = await database.get('SELECT user_id FROM jobs WHERE id = $1', [jobId]);
    return row ? row.user_id : null;
  }

  async getJobStatus(jobId) {
    const row = await database.get('SELECT status FROM jobs WHERE id = $1', [jobId]);
    return row ? row.status : null;
  }

  async summarizeJobForTitle(jobId, userId = null) {
    // Count total and processed
    const totalRow = await database.get(
      userId
        ? 'SELECT COUNT(*)::int AS total FROM job_links WHERE job_id=$1 AND user_id=$2'
        : 'SELECT COUNT(*)::int AS total FROM job_links WHERE job_id=$1',
      userId ? [jobId, userId] : [jobId]
    );
    const processedRow = await database.get(
      userId
        ? "SELECT COUNT(*)::int AS processed FROM job_links WHERE job_id=$1 AND user_id=$2 AND status='processed'"
        : "SELECT COUNT(*)::int AS processed FROM job_links WHERE job_id=$1 AND status='processed'",
      userId ? [jobId, userId] : [jobId]
    );

    // Top law article
    const topArticleRow = await database.get(
      userId
        ? `
          SELECT article, COUNT(*) AS c FROM (
            SELECT jsonb_array_elements_text(law_articles) AS article
            FROM job_links
            WHERE job_id=$1 AND user_id=$2 AND status='processed' AND law_articles IS NOT NULL
          ) t
          GROUP BY article
          ORDER BY c DESC
          LIMIT 1
        `
        : `
          SELECT article, COUNT(*) AS c FROM (
            SELECT jsonb_array_elements_text(law_articles) AS article
            FROM job_links
            WHERE job_id=$1 AND status='processed' AND law_articles IS NOT NULL
          ) t
          GROUP BY article
          ORDER BY c DESC
          LIMIT 1
        `,
      userId ? [jobId, userId] : [jobId]
    );

    // Top case type
    const topTypeRow = await database.get(
      userId
        ? `SELECT case_type, COUNT(*) AS c FROM job_links WHERE job_id=$1 AND user_id=$2 AND status='processed' AND case_type IS NOT NULL GROUP BY case_type ORDER BY c DESC LIMIT 1`
        : `SELECT case_type, COUNT(*) AS c FROM job_links WHERE job_id=$1 AND status='processed' AND case_type IS NOT NULL GROUP BY case_type ORDER BY c DESC LIMIT 1`,
      userId ? [jobId, userId] : [jobId]
    );

    return {
      total: totalRow?.total || 0,
      processed: processedRow?.processed || 0,
      topArticle: topArticleRow?.article || null,
      topCaseType: topTypeRow?.case_type || null,
    };
  }

  async addJobLinks(jobId, links, userId = null) {
    if (!links || links.length === 0) return;

    // Batch insert для производительности
    const cols = userId
      ? '(job_id, url, status, decision_date, user_id)'
      : '(job_id, url, status, decision_date)';
    const perRowParams = userId ? 5 : 4;
    const values = links
      .map((_, index) => {
        const base = `($${index * perRowParams + 1}, $${index * perRowParams + 2}, $${
          index * perRowParams + 3
        }, $${index * perRowParams + 4}`;
        return userId ? `${base}, $${index * perRowParams + 5})` : `${base})`;
      })
      .join(', ');
    const sql = `INSERT INTO job_links ${cols} VALUES ${values}`;

    const params = [];
    for (const link of links) {
      if (userId) params.push(jobId, link.url, 'pending', link.decisionDate, userId);
      else params.push(jobId, link.url, 'pending', link.decisionDate);
    }

    await database.run(sql, params);
    logger.info(`✅ Batch добавлено ${links.length} ссылок для задания ${jobId}`);
  }

  async getJobLinks(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, status, content, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 AND user_id = $2 ORDER BY id`
      : `SELECT url, status, content, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async getJobLinksLight(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, status, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 AND user_id = $2 ORDER BY id`
      : `SELECT url, status, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async getJobLinksLightForWorkspace(jobId, workspaceId) {
    return await database.all(
      `SELECT jl.url, jl.status, jl.decision_date, jl.evidence_snippet
       FROM job_links jl
       JOIN jobs j ON j.id = jl.job_id
       WHERE jl.job_id = $1 AND j.workspace_id = $2
       ORDER BY jl.id`,
      [jobId, workspaceId]
    );
  }

  async updateLinkStatus(jobId, url, status, content = null, errorMessage = null, metadata = null) {
    let sql, params;
    const evidenceSnippet = status === 'processed' ? extractEvidenceSnippet(content) : null;
    const shouldUpdateEvidence = Boolean(evidenceSnippet);

    if (metadata) {
      // Include legal metadata in the update
      sql = `
            UPDATE job_links 
            SET status = $1, content = $2, error_message = $3, processed_at = CURRENT_TIMESTAMP,
                law_articles = $6, claim_amount = $7, case_type = $8, parties = $9, metadata_extracted_at = CURRENT_TIMESTAMP
            WHERE job_id = $4 AND url = $5
        `;
      params = [
        status,
        content,
        errorMessage,
        jobId,
        url,
        JSON.stringify(metadata.lawArticles || []),
        metadata.claimAmount ? JSON.stringify(metadata.claimAmount) : null,
        metadata.caseType || null,
        JSON.stringify(metadata.parties || {}),
      ];
    } else {
      // Original update without metadata
      sql = `
            UPDATE job_links 
            SET status = $1, content = $2, error_message = $3, processed_at = CURRENT_TIMESTAMP
            WHERE job_id = $4 AND url = $5
        `;
      params = [status, content, errorMessage, jobId, url];
    }

    if (shouldUpdateEvidence) {
      const idx = params.length + 1;
      sql = sql.replace(
        'WHERE job_id',
        `, evidence_snippet = $${idx}, evidence_extracted_at = CURRENT_TIMESTAMP WHERE job_id`
      );
      params.push(evidenceSnippet);
    }

    await database.run(sql, params);
  }

  async saveJobResult(jobId, analysisText) {
    // Проверяем, что задача еще существует перед сохранением результата
    const job = await database.get('SELECT id, user_id FROM jobs WHERE id = $1', [jobId]);
    if (!job) {
      logger.warn(
        `[DB] Попытка сохранить результат для несуществующей задачи ${jobId} - пропускаем`
      );
      return; // Тихо игнорируем, задача была удалена
    }

    try {
      await database.run('DELETE FROM job_results WHERE job_id = $1', [jobId]);
      const sql = `INSERT INTO job_results (job_id, analysis_text, user_id) VALUES ($1, $2, $3)`;
      await database.run(sql, [jobId, analysisText, job.user_id || null]);
      logger.info(
        `[DB] Результат анализа сохранен для задачи ${jobId} (${analysisText.length} символов)`
      );
    } catch (error) {
      // Дополнительная проверка на случай удаления задачи между проверкой и вставкой
      if (error.message.includes('foreign key constraint')) {
        logger.warn(
          `[DB] Задача ${jobId} была удалена во время сохранения результата - игнорируем`
        );
        return;
      }
      throw error; // Перебрасываем другие ошибки
    }
  }

  async getJobResult(jobId, userId = null) {
    const sql = userId
      ? `SELECT analysis_text FROM job_results WHERE job_id = $1 AND user_id = $2 LIMIT 1`
      : `SELECT analysis_text FROM job_results WHERE job_id = $1 LIMIT 1`;
    const params = userId ? [jobId, userId] : [jobId];
    const result = await database.get(sql, params);
    return result ? result.analysis_text : null;
  }

  async getJobResultForWorkspace(jobId, workspaceId) {
    const row = await database.get(
      `SELECT jr.analysis_text
       FROM job_results jr
       JOIN jobs j ON j.id = jr.job_id
       WHERE jr.job_id = $1 AND j.workspace_id = $2
       LIMIT 1`,
      [jobId, workspaceId]
    );
    return row ? row.analysis_text : null;
  }

  async getLinksContent(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, content FROM job_links WHERE job_id = $1 AND user_id = $2 AND status = 'processed' ORDER BY id`
      : `SELECT url, content FROM job_links WHERE job_id = $1 AND status = 'processed' ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async getLinksContentForWorkspace(jobId, workspaceId) {
    return await database.all(
      `SELECT jl.url, jl.content
       FROM job_links jl
       JOIN jobs j ON j.id = jl.job_id
       WHERE jl.job_id = $1 AND j.workspace_id = $2 AND jl.status = 'processed'
       ORDER BY jl.id`,
      [jobId, workspaceId]
    );
  }

  async addChatMessage(jobId, role, content, userId = null) {
    const sql = `INSERT INTO chat_messages (job_id, role, content, user_id) VALUES ($1, $2, $3, $4) RETURNING id`;
    const result = await database.query(sql, [jobId, role, content, userId]);
    return result.rows?.[0]?.id || null;
  }

  async getChatHistory(jobId, userId = null, limit = 50) {
    const sql = userId
      ? `SELECT role, content FROM chat_messages WHERE job_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT $3`
      : `SELECT role, content FROM chat_messages WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2`;
    const params = userId ? [jobId, userId, limit] : [jobId, limit];
    return await database.all(sql, params);
  }

  async getChatHistoryForWorkspace(jobId, workspaceId, limit = 50) {
    return await database.all(
      `SELECT cm.role, cm.content
       FROM chat_messages cm
       JOIN jobs j ON j.id = cm.job_id
       WHERE cm.job_id = $1 AND j.workspace_id = $2
       ORDER BY cm.created_at ASC
       LIMIT $3`,
      [jobId, workspaceId, limit]
    );
  }

  // --- Caching Methods ---

  async getCachedCaseByUrl(url, userId = null) {
    const sql = userId
      ? `SELECT case_data, updated_at FROM parsed_cases WHERE url = $1 AND user_id = $2`
      : `SELECT case_data, updated_at FROM parsed_cases WHERE url = $1`;
    try {
      const row = await database.get(sql, userId ? [url, userId] : [url]);
      if (row) {
        const cached = row.case_data;
        const isTemporary = cached?.isTemporary === true;
        if (isTemporary) {
          const ttlMs = parseInt(
            process.env.TEMP_CACHE_TTL_MS || process.env.CACHE_TEMP_ERROR_TTL_MS || '3600000',
            10
          );
          const updatedAtMs = row.updated_at
            ? typeof row.updated_at === 'string'
              ? Date.parse(row.updated_at)
              : row.updated_at.getTime()
            : cached?.cachedAt || null;
          if (
            Number.isFinite(ttlMs) &&
            ttlMs > 0 &&
            Number.isFinite(updatedAtMs) &&
            Date.now() - updatedAtMs > ttlMs
          ) {
            logger.info(`[CACHE] TEMP EXPIRED for URL: ${url}`);
            try {
              const deleteSql = userId
                ? 'DELETE FROM parsed_cases WHERE url = $1 AND user_id = $2'
                : 'DELETE FROM parsed_cases WHERE url = $1';
              await database.run(deleteSql, userId ? [url, userId] : [url]);
            } catch (deleteError) {
              logger.warn(`[CACHE] Failed to purge expired temp cache for ${url}:`, deleteError);
            }
            return null;
          }
        }

        logger.info(`[CACHE] HIT for URL: ${url}`);
        // The pg driver automatically parses JSON/JSONB fields, so no need for JSON.parse
        return cached;
      }
      logger.info(`[CACHE] MISS for URL: ${url}`);
      return null;
    } catch (error) {
      logger.error(`[CACHE] Error getting cached case for URL ${url}:`, error);
      return null; // On error, proceed as if it's a cache miss
    }
  }

  async saveCaseToCache(caseData, userId = null) {
    const sql = `
      INSERT INTO parsed_cases (url, case_data, created_at, updated_at, user_id)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)
      ON CONFLICT(url)
      DO UPDATE SET
        case_data = EXCLUDED.case_data,
        updated_at = CURRENT_TIMESTAMP;
    `;
    const timeoutMs = parseInt(process.env.CACHE_STATEMENT_TIMEOUT_MS || '5000', 10);
    const tStart = Date.now();
    const spans = {};

    // JSON stringify timing (can dominate for large bodies)
    const tStringifyStart = Date.now();
    const caseDataJson = JSON.stringify(caseData);
    spans.stringifyMs = Date.now() - tStringifyStart;

    let client;
    try {
      const tAcquireStart = Date.now();
      client = await database.pool.connect();
      spans.acquireMs = Date.now() - tAcquireStart;

      await client.query('BEGIN');
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      }

      const tExecStart = Date.now();
      await client.query(sql, [caseData.url, caseDataJson, userId]);
      spans.execMs = Date.now() - tExecStart;

      await client.query('COMMIT');
      spans.totalMs = Date.now() - tStart;
      logger.info(`[CACHE] SAVED case for URL: ${caseData.url} timings=${JSON.stringify(spans)}`);
    } catch (error) {
      try {
        if (client) await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.warn('[CACHE] ROLLBACK failed during saveCaseToCache:', rollbackErr);
      }
      logger.error(
        `[CACHE] Error saving case to cache for URL ${caseData.url}: ${error.message || error}`,
        { code: error.code, spans }
      );
    } finally {
      if (client) client.release();
    }
  }

  // Optimized cleanup using a cutoff timestamp to avoid large NOT IN subqueries
  async cleanupOldCacheEntriesOptimized(maxEntries = null) {
    try {
      const limit = parseInt(maxEntries || process.env.CACHE_MAX_PARSED_CASES || '1000', 10);
      if (!Number.isFinite(limit) || limit <= 0) return 0;

      const sql = `
        WITH cutoff AS (
          SELECT updated_at
          FROM parsed_cases
          ORDER BY updated_at DESC
          OFFSET $1 LIMIT 1
        )
        DELETE FROM parsed_cases
        WHERE (SELECT updated_at FROM cutoff) IS NOT NULL
          AND updated_at < (SELECT updated_at FROM cutoff)
      `;
      const res = await database.run(sql, [limit - 1]);
      const deleted = res.changes || 0;
      if (deleted > 0) {
        logger.info(`[CACHE] Cleaned up ${deleted} old cache entries (kept latest ${limit})`);
      }
      return deleted;
    } catch (error) {
      logger.error(`[CACHE] Error cleaning up old cache entries (optimized):`, error);
      return 0;
    }
  }

  // --- End Caching Methods ---

  async getActiveJobsCount(userId = null) {
    const sql = userId
      ? `SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('completed', 'error') AND user_id = $1`
      : `SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('completed', 'error')`;
    const result = await database.get(sql, userId ? [userId] : []);
    return result.count || 0;
  }

  async getLastRelevantJob(userId = null) {
    // Priority: 1) Active jobs 2) Recently updated 3) Recently created
    const activeJob = await database.get(
      userId
        ? `SELECT * FROM jobs WHERE status NOT IN ('completed', 'error') AND user_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1`
        : `SELECT * FROM jobs WHERE status NOT IN ('completed', 'error') ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      userId ? [userId] : []
    );

    if (activeJob) {
      activeJob.links = await this.getJobLinks(activeJob.id, userId);
      activeJob.analysis = await this.getJobResult(activeJob.id, userId);
      return activeJob;
    }

    // No active jobs, get the most recently updated completed job
    const lastJob = await database.get(
      userId
        ? `SELECT * FROM jobs WHERE user_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1`
        : `SELECT * FROM jobs ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      userId ? [userId] : []
    );

    if (lastJob) {
      lastJob.links = await this.getJobLinks(lastJob.id, userId);
      lastJob.analysis = await this.getJobResult(lastJob.id, userId);
    }

    return lastJob;
  }

  async deleteJob(jobId, userId = null) {
    logger.info(`[DB] Attempting to delete job ${jobId} and all related data.`);
    const client = await database.pool.connect();
    const onClientError = (err) => {
      // Prevent unhandled 'error' event on client during transaction
      logger.error('[DB] Client error during deleteJob transaction:', err);
    };
    client.on('error', onClientError);
    const tablesToDeleteFrom = ['chat_messages', 'job_results', 'job_links', 'jobs'];

    try {
      await client.query('BEGIN');

      if (userId) {
        const job = await client.query('SELECT id FROM jobs WHERE id = $1 AND user_id = $2', [
          jobId,
          userId,
        ]);
        if (!job.rows[0]) throw new Error('Not found or access denied');
      }

      for (const table of tablesToDeleteFrom) {
        const idColumn = table === 'jobs' ? 'id' : 'job_id';
        const sql = userId
          ? `DELETE FROM ${table} WHERE ${idColumn} = $1 AND user_id = $2`
          : `DELETE FROM ${table} WHERE ${idColumn} = $1`;
        const result = await client.query(sql, userId ? [jobId, userId] : [jobId]);
        logger.info(`[DB] Deleted ${result.rowCount} rows from ${table} for job ${jobId}`);
      }

      await client.query('COMMIT');
      logger.info(`[DB] Successfully deleted job ${jobId} and committed transaction.`);
      return { success: true, message: `Job ${jobId} deleted successfully.` };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('[DB] ROLLBACK failed:', rollbackErr);
      }
      logger.error(`[DB] Error deleting job ${jobId}:`, error);
      throw new Error(`Failed to delete job ${jobId}. The transaction was rolled back.`);
    } finally {
      try {
        client.removeListener('error', onClientError);
      } catch {
        // noop
      }
      client.release();
    }
  }

  async deleteJobForWorkspace(jobId, workspaceId) {
    logger.info(`[DB] Attempting to delete job ${jobId} for workspace ${workspaceId}.`);
    const client = await database.pool.connect();
    const onClientError = (err) => {
      logger.error('[DB] Client error during deleteJobForWorkspace transaction:', err);
    };
    client.on('error', onClientError);
    const tablesToDeleteFrom = ['chat_messages', 'job_results', 'job_links', 'jobs'];

    try {
      await client.query('BEGIN');
      const job = await client.query('SELECT id FROM jobs WHERE id = $1 AND workspace_id = $2', [
        jobId,
        workspaceId,
      ]);
      if (!job.rows[0]) throw new Error('Not found or access denied');

      for (const table of tablesToDeleteFrom) {
        const idColumn = table === 'jobs' ? 'id' : 'job_id';
        const sql = `DELETE FROM ${table} WHERE ${idColumn} = $1`;
        const result = await client.query(sql, [jobId]);
        logger.info(`[DB] Deleted ${result.rowCount} rows from ${table} for job ${jobId}`);
      }

      await client.query('COMMIT');
      logger.info(`[DB] Successfully deleted job ${jobId} for workspace ${workspaceId}.`);
      return { success: true, message: `Job ${jobId} deleted successfully.` };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('[DB] ROLLBACK failed:', rollbackErr);
      }
      logger.error(`[DB] Error deleting job ${jobId}:`, error);
      throw new Error(`Failed to delete job ${jobId}. The transaction was rolled back.`);
    } finally {
      try {
        client.removeListener('error', onClientError);
      } catch {
        // noop
      }
      client.release();
    }
  }

  async getProcessedUrls(userId = null) {
    const sql = `
      SELECT DISTINCT url, MAX(processed_at) as latest_processed_at
      FROM job_links 
      WHERE status = 'processed' ${userId ? 'AND user_id = $1' : ''}
      GROUP BY url
      ORDER BY latest_processed_at DESC
    `;
    const results = await database.all(sql, userId ? [userId] : []);
    return results.map((row) => row.url);
  }

  async getProcessedMembership(urls = [], userId = null) {
    if (!Array.isArray(urls) || urls.length === 0) return [];
    const sql = userId
      ? `SELECT url FROM job_links WHERE status = 'processed' AND user_id = $2 AND url = ANY($1)`
      : `SELECT url FROM job_links WHERE status = 'processed' AND url = ANY($1)`;
    const params = userId ? [urls, userId] : [urls];
    const rows = await database.all(sql, params);
    return rows.map((r) => r.url);
  }

  // ---- QUEUE/LEASING OPERATIONS ----

  async recoverStuckJobs() {
    // Return stuck in-progress jobs (no lease or expired lease) back to 'retrying'
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE status NOT IN ('completed','error','queued','retrying')
        AND (lease_until IS NULL OR lease_until < NOW())
    `;
    try {
      const res = await database.run(sql);
      if (res.changes > 0) {
        logger.info(`🔁 Recovered ${res.changes} stuck job(s) to 'retrying'`);
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] recoverStuckJobs error:', e.message);
      return 0;
    }
  }

  async recoverJobsAfterServerRestart(serverStartedAtIso) {
    // On startup, convert any in-progress jobs whose last heartbeat predates server start into 'retrying'
    // This avoids 30-minute waits due to stale leases after a crash/restart.
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status NOT IN ('completed','error','queued','retrying')
        AND (locked_by IS NOT NULL OR lease_until IS NOT NULL OR heartbeat_at IS NOT NULL)
        AND (heartbeat_at IS NULL OR heartbeat_at < $1)
    `;
    try {
      const res = await database.run(sql, [serverStartedAtIso]);
      if (res.changes > 0) {
        logger.info(`🩺 Recovered ${res.changes} pre-restart in-progress job(s) to 'retrying'`);
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] recoverJobsAfterServerRestart error:', e.message);
      return 0;
    }
  }

  async recoverJobsWithStaleHeartbeat(graceMinutes = 5) {
    // Force-recover in-progress jobs that haven't heartbeated recently
    const minutes = Math.max(1, parseInt(graceMinutes, 10) || 5);
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status NOT IN ('completed','error','queued','retrying')
        AND (
          heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '${minutes} minutes'
        )
    `;
    try {
      const res = await database.run(sql);
      if (res.changes > 0) {
        logger.info(
          `🧯 Force-recovered ${res.changes} in-flight job(s) with stale heartbeat (${minutes}m)`
        );
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] recoverJobsWithStaleHeartbeat error:', e.message);
      return 0;
    }
  }

  async retryFailedJobs() {
    // Retry jobs that failed with temporary/retryable errors
    // Only retry jobs that are not too old and haven't been retried too many times
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, 
          attempt = COALESCE(attempt, 0), updated_at = CURRENT_TIMESTAMP
      WHERE status = 'error'
        AND COALESCE(attempt, 0) < 3
        AND (
          error_message LIKE '%Memory limit exceeded%'
          OR error_message LIKE '%Worker terminated due to reaching memory limit%'
          OR error_message LIKE '%зависла%'
          OR error_message LIKE '%timeout%'
          OR error_message LIKE '%превысил%'
          OR error_message LIKE '%network%'
          OR error_message LIKE '%ENET%'
          OR error_message LIKE '%ECONN%'
          OR error_message LIKE '%503%'
          OR error_message LIKE '%502%'
          OR error_message LIKE '%fetch failed%'
        )
        AND updated_at > NOW() - INTERVAL '24 hours'
    `;
    try {
      const res = await database.run(sql);
      if (res.changes > 0) {
        logger.info(`🔄 Retrying ${res.changes} failed job(s) with temporary errors`);
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] retryFailedJobs error:', e.message);
      return 0;
    }
  }

  async getJobsWithErrors(limit = 10) {
    // Get jobs that are in error state for admin review
    const sql = `
      SELECT id, status, error_message, attempt, updated_at, created_at
      FROM jobs 
      WHERE status = 'error' 
      ORDER BY updated_at DESC 
      LIMIT $1
    `;
    try {
      return await database.all(sql, [limit]);
    } catch (e) {
      logger.error('[DB] getJobsWithErrors error:', e.message);
      return [];
    }
  }

  async manualRetryJob(jobId) {
    // Manual retry for a specific job (admin action)
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, 
          error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'error'
      RETURNING id
    `;
    try {
      const result = await database.get(sql, [jobId]);
      if (result) {
        logger.info(`🔧 Manual retry initiated for job ${jobId}`);
        return true;
      }
      return false;
    } catch (e) {
      logger.error('[DB] manualRetryJob error:', e.message);
      return false;
    }
  }

  async claimNextJob(workerId) {
    // Atomically claim the next queued/retrying job with a global advisory xact lock (single active job across processes)
    // Uses pg_try_advisory_xact_lock which releases automatically at end of transaction
    const sql = `
      WITH lock AS (
        SELECT pg_try_advisory_xact_lock(42424242) AS ok
      ), next AS (
        SELECT id, prompt, user_id
        FROM jobs
        WHERE status IN ('queued','retrying')
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs j
      SET status = 'processing',
          locked_by = $1,
          locked_at = NOW(),
          lease_until = NOW() + INTERVAL '30 minutes',
          attempt = COALESCE(attempt,0) + 1,
          updated_at = CURRENT_TIMESTAMP
      FROM lock, next
      WHERE j.id = next.id AND lock.ok
      RETURNING j.id, next.prompt, next.user_id
    `;
    try {
      const row = await database.get(sql, [workerId]);
      if (row?.id) {
        logger.info(`[QUEUE/DB] Claimed job ${row.id} by ${workerId}`);
        return row;
      }
      return null;
    } catch (e) {
      logger.error('[DB] claimNextJob error:', e.message);
      return null;
    }
  }

  async lockJob(jobId, workerId) {
    const sql = `
      UPDATE jobs
      SET status = 'processing', locked_by = $2, locked_at = NOW(), lease_until = NOW() + INTERVAL '30 minutes',
          attempt = COALESCE(attempt,0) + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND (locked_by IS NULL OR lease_until IS NULL OR lease_until < NOW())
      RETURNING id
    `;
    try {
      const row = await database.get(sql, [jobId, workerId]);
      return !!row?.id;
    } catch (e) {
      logger.error('[DB] lockJob error:', e.message);
      return false;
    }
  }

  async heartbeatJob(jobId, workerId) {
    const sql = `
      UPDATE jobs
      SET heartbeat_at = NOW(), lease_until = NOW() + INTERVAL '30 minutes'
      WHERE id = $1 AND locked_by = $2
    `;
    try {
      await database.run(sql, [jobId, workerId]);
    } catch (e) {
      logger.debug('[DB] heartbeatJob error (non-fatal):', e.message);
    }
  }

  async clearJobLock(jobId) {
    const sql = `
      UPDATE jobs
      SET locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    try {
      await database.run(sql, [jobId]);
    } catch (e) {
      logger.error('[DB] clearJobLock error:', e.message);
    }
  }

  // ---- WORKSPACES & MEMBERS ----
  async ensureWorkspaceForUser(userId, email = null) {
    const existing = await database.get(
      `SELECT w.id, w.name, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY w.created_at ASC
       LIMIT 1`,
      [userId]
    );
    if (existing) return existing;

    const workspaceId = uuid();
    const label = email ? email.split('@')[0] : 'workspace';
    const name = `${label}'s workspace`;

    await database.run(
      `INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [workspaceId, name, userId]
    );
    await database.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, created_at, updated_at)
       VALUES ($1, $2, 'owner', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [workspaceId, userId, userId]
    );

    await database.run(
      `UPDATE jobs
       SET workspace_id = $1
       WHERE user_id = $2 AND workspace_id IS NULL`,
      [workspaceId, userId]
    );

    return { id: workspaceId, name, role: 'owner' };
  }

  async listWorkspaces(userId) {
    return await database.all(
      `SELECT w.id, w.name, w.owner_user_id, w.created_at, w.updated_at, wm.role,
        (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = w.id) AS member_count
       FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY w.created_at DESC`,
      [userId]
    );
  }

  async createWorkspace(userId, name) {
    const workspaceId = uuid();
    const trimmed = String(name || '').trim() || 'New workspace';
    const row = await database.get(
      `INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, owner_user_id, created_at, updated_at`,
      [workspaceId, trimmed, userId]
    );
    await database.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, created_at, updated_at)
       VALUES ($1, $2, 'owner', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [workspaceId, userId, userId]
    );
    return row;
  }

  async getWorkspaceRole(userId, workspaceId) {
    const row = await database.get(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    return row?.role || null;
  }

  async listWorkspaceMembers(workspaceId) {
    return await database.all(
      `SELECT wm.user_id, wm.role, wm.created_at, wm.updated_at, au.email
       FROM workspace_members wm
       LEFT JOIN app_users au ON au.user_id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.role DESC, wm.created_at ASC`,
      [workspaceId]
    );
  }

  async addWorkspaceMember(workspaceId, email, role = 'member', invitedBy = null) {
    const emailLower = String(email || '')
      .trim()
      .toLowerCase();
    const userRow = await database.get(
      `SELECT user_id, email FROM app_users WHERE email_lower = $1`,
      [emailLower]
    );
    if (!userRow?.user_id) {
      return { error: 'user_not_found' };
    }

    const row = await database.get(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, updated_at = CURRENT_TIMESTAMP
       RETURNING workspace_id, user_id, role`,
      [workspaceId, userRow.user_id, role, invitedBy]
    );
    return { member: row, email: userRow.email };
  }

  async updateWorkspaceMemberRole(workspaceId, userId, role) {
    const row = await database.get(
      `UPDATE workspace_members
       SET role = $1, updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = $2 AND user_id = $3
       RETURNING workspace_id, user_id, role`,
      [role, workspaceId, userId]
    );
    return row || null;
  }

  async removeWorkspaceMember(workspaceId, userId) {
    const row = await database.get(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`,
      [workspaceId, userId]
    );
    return !!row?.user_id;
  }

  // ---- MATTERS ----
  async listMatters(workspaceId) {
    return await database.all(
      `SELECT m.id, m.title, m.client_name, m.tags, m.created_at, m.updated_at,
        (SELECT COUNT(*)::int FROM jobs WHERE matter_id = m.id) AS jobs_count
       FROM matters m
       WHERE m.workspace_id = $1
       ORDER BY m.updated_at DESC`,
      [workspaceId]
    );
  }

  async createMatter(
    { workspaceId, title, description = null, clientName = null, tags = [] },
    userId
  ) {
    const id = uuid();
    const row = await database.get(
      `INSERT INTO matters (id, workspace_id, title, description, client_name, tags, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, workspace_id, title, description, client_name, tags, created_by, created_at, updated_at`,
      [id, workspaceId, title, description, clientName, JSON.stringify(tags || []), userId]
    );
    return row;
  }

  async getMatter(matterId, workspaceId) {
    return await database.get(
      `SELECT id, workspace_id, title, description, client_name, tags, created_by, created_at, updated_at
       FROM matters
       WHERE id = $1 AND workspace_id = $2`,
      [matterId, workspaceId]
    );
  }

  async updateMatter(matterId, workspaceId, updates = {}) {
    const fields = [];
    const params = [];
    let idx = 1;
    if (typeof updates.title === 'string' && updates.title.trim()) {
      fields.push(`title = $${idx++}`);
      params.push(updates.title.trim());
    }
    if (typeof updates.description === 'string') {
      fields.push(`description = $${idx++}`);
      params.push(updates.description);
    }
    const clientName =
      typeof updates.clientName === 'string' ? updates.clientName : updates.client_name;
    if (typeof clientName === 'string') {
      fields.push(`client_name = $${idx++}`);
      params.push(clientName);
    }
    if (Array.isArray(updates.tags)) {
      fields.push(`tags = $${idx++}`);
      params.push(JSON.stringify(updates.tags));
    }
    if (fields.length === 0) return null;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(matterId, workspaceId);
    const idIndex = idx++;
    const workspaceIndex = idx;
    const sql = `UPDATE matters SET ${fields.join(', ')} WHERE id = $${idIndex} AND workspace_id = $${workspaceIndex} RETURNING id, title, description, client_name, tags, updated_at`;
    return await database.get(sql, params);
  }

  async deleteMatter(matterId, workspaceId) {
    const row = await database.get(
      `DELETE FROM matters WHERE id = $1 AND workspace_id = $2 RETURNING id`,
      [matterId, workspaceId]
    );
    return !!row?.id;
  }

  async listMatterJobs(matterId, workspaceId) {
    return await database.all(
      `SELECT id, title, status, progress, processed_links, total_links, created_at, updated_at
       FROM jobs
       WHERE matter_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC`,
      [matterId, workspaceId]
    );
  }

  async assignJobToMatter(jobId, matterId, workspaceId) {
    const row = await database.get(
      `UPDATE jobs
       SET matter_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND workspace_id = $3
       RETURNING id, matter_id`,
      [matterId, jobId, workspaceId]
    );
    return row || null;
  }

  async removeJobFromMatter(jobId, matterId, workspaceId) {
    const row = await database.get(
      `UPDATE jobs
       SET matter_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND workspace_id = $2 AND matter_id = $3
       RETURNING id`,
      [jobId, workspaceId, matterId]
    );
    return !!row?.id;
  }

  // ---- SHARE LINKS ----
  async createShareLink(jobId, createdBy, expiresAt) {
    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashToken(token);
    const id = uuid();
    const host = process.env.PUBLIC_SHARE_BASE_URL || process.env.APP_BASE_URL || '';
    const shareUrl = host ? `${host.replace(/\/$/, '')}/share/${token}` : null;
    const row = await database.get(
      `INSERT INTO share_links (id, job_id, token_hash, share_url, expires_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       RETURNING id, job_id, share_url, expires_at, created_by, created_at`,
      [id, jobId, tokenHash, shareUrl, expiresAt, createdBy]
    );
    return { token, link: row };
  }

  async listShareLinksForWorkspace(workspaceId) {
    return await database.all(
      `SELECT s.id, s.job_id, s.share_url, s.expires_at, s.created_by, s.created_at, s.revoked_at,
        j.title
       FROM share_links s
       JOIN jobs j ON j.id = s.job_id
       WHERE j.workspace_id = $1
       ORDER BY s.created_at DESC`,
      [workspaceId]
    );
  }

  async revokeShareLink(id, workspaceId = null) {
    const params = [id];
    let workspaceClause = '';

    if (workspaceId) {
      params.push(workspaceId);
      workspaceClause = ` AND job_id IN (SELECT id FROM jobs WHERE workspace_id = $2)`;
    }

    const row = await database.get(
      `UPDATE share_links
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND revoked_at IS NULL${workspaceClause}
       RETURNING id`,
      params
    );
    return !!row?.id;
  }

  async getShareLinkByToken(token) {
    const tokenHash = hashToken(token);
    return await database.get(
      `SELECT id, job_id, expires_at, revoked_at, created_at
       FROM share_links
       WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  async getSharePayloadByToken(token) {
    const tokenHash = hashToken(token);
    const link = await database.get(
      `SELECT id, job_id, expires_at, revoked_at, created_at
       FROM share_links
       WHERE token_hash = $1`,
      [tokenHash]
    );
    if (!link) return null;

    const job = await database.get(
      `SELECT id, title, status, progress, processed_links, total_links, created_at, updated_at
       FROM jobs
       WHERE id = $1`,
      [link.job_id]
    );
    if (!job) return null;

    const analysis = await database.get(
      `SELECT analysis_text FROM job_results WHERE job_id = $1 LIMIT 1`,
      [link.job_id]
    );
    const links = await database.all(
      `SELECT url, status, decision_date, evidence_snippet
       FROM job_links
       WHERE job_id = $1
       ORDER BY id`,
      [link.job_id]
    );

    return {
      link,
      job,
      analysis: analysis?.analysis_text || null,
      links,
    };
  }

  async requeueJob(jobId, { resetLinks = false } = {}) {
    // Clear lock and move to 'retrying'
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `;
    const row = await database.get(sql, [jobId]);
    if (!row) return false;
    if (resetLinks) {
      // Reset links that are not yet processed back to pending (we consider 'error' or null states)
      try {
        await database.run(
          `UPDATE job_links SET status = 'pending', processed_at = NULL WHERE job_id = $1 AND status NOT IN ('pending','processed')`,
          [jobId]
        );
      } catch (e) {
        logger.warn('[DB] requeueJob: resetLinks error:', e.message);
      }
    }
    logger.info(`[QUEUE/DB] Requeued job ${jobId}`);
    return true;
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
