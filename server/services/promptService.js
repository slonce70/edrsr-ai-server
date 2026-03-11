import { isDeepStrictEqual } from 'node:util';
import { v4 as uuid } from 'uuid';

import database from '../database/connection.js';
import { logger } from '../utils.js';
import { getDefaultPromptDefinitions } from '../prompt-definitions.js';

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeLike = (value) => String(value || '').replace(/[\\%_]/g, '\\$&');

class PromptService {
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
}

export default new PromptService();
