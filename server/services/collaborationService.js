import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

import {
  MAX_SHARE_LINK_DAYS,
  buildShareUrl as buildShareUrlFromPolicy,
  isValidWorkspaceRole,
  normalizeWorkspaceRole,
} from '../collaborationPolicy.js';
import database from '../database/connection.js';
import { computeReportCoverage } from '../quality/coverage.js';

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const WORKSPACE_ROLE_VALUES = ['owner', 'admin', 'member'];
export const WORKSPACE_ROLES = Object.freeze([...WORKSPACE_ROLE_VALUES]);

function assertWorkspaceRole(role, { allowOwner = true } = {}) {
  const normalized = normalizeWorkspaceRole(role);
  if (!isValidWorkspaceRole(normalized)) {
    throw new Error('Invalid workspace role');
  }
  if (!allowOwner && normalized === 'owner') {
    throw new Error('Owner role cannot be assigned via this endpoint');
  }
  return normalized;
}

function buildShareUrl(token) {
  const host = process.env.PUBLIC_SHARE_BASE_URL || process.env.APP_BASE_URL || '';
  const shareUrl = buildShareUrlFromPolicy(host, token);
  if (shareUrl) {
    return shareUrl;
  }

  return null;
}

class CollaborationService {
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
    return row?.role ? normalizeWorkspaceRole(row.role) : null;
  }

  async getWorkspaceOwnerId(workspaceId) {
    const row = await database.get(`SELECT owner_user_id FROM workspaces WHERE id = $1`, [
      workspaceId,
    ]);
    return row?.owner_user_id || null;
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
    const normalizedRole = assertWorkspaceRole(role, { allowOwner: false });
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
      [workspaceId, userRow.user_id, normalizedRole, invitedBy]
    );
    return { member: row, email: userRow.email };
  }

  async updateWorkspaceMemberRole(workspaceId, userId, role) {
    const normalizedRole = assertWorkspaceRole(role);
    const row = await database.get(
      `UPDATE workspace_members
       SET role = $1, updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = $2 AND user_id = $3
       RETURNING workspace_id, user_id, role`,
      [normalizedRole, workspaceId, userId]
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
    return await database.get(
      `INSERT INTO matters (id, workspace_id, title, description, client_name, tags, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, workspace_id, title, description, client_name, tags, created_by, created_at, updated_at`,
      [id, workspaceId, title, description, clientName, JSON.stringify(tags || []), userId]
    );
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

  async createShareLink(jobId, createdBy, expiresAt) {
    const expiresAtTime = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtTime) || expiresAtTime <= Date.now()) {
      throw new Error('Invalid share link expiration');
    }
    const ttlDays = (expiresAtTime - Date.now()) / (24 * 60 * 60 * 1000);
    if (ttlDays > MAX_SHARE_LINK_DAYS) {
      throw new Error('Share link expiration exceeds maximum allowed lifetime');
    }

    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashToken(token);
    const id = uuid();
    const shareUrl = buildShareUrl(token);
    const row = await database.get(
      `INSERT INTO share_links (id, job_id, token_hash, share_url, expires_at, created_by, created_at)
       VALUES ($1, $2, $3, NULL, $4, $5, CURRENT_TIMESTAMP)
       RETURNING id, job_id, share_url, expires_at, created_by, created_at`,
      [id, jobId, tokenHash, expiresAt, createdBy]
    );
    return {
      token,
      url: shareUrl,
      link: {
        ...row,
        share_url: null,
      },
    };
  }

  async listShareLinksForWorkspace(workspaceId) {
    return await database.all(
      `SELECT s.id, s.job_id, NULL::TEXT AS share_url, s.expires_at, s.created_by, s.created_at, s.revoked_at,
        s.view_count, s.first_viewed_at, s.last_viewed_at,
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

    const analysisText = analysis?.analysis_text || null;
    // Reuse the SAME pure coverage helper the lawyer-side JobQuality uses, so a
    // partial shared report is honestly flagged to the client. Shape matches
    // ReportStatusBanner's JobQuality prop: { analyzed, total, cited, coverage, partial }.
    const quality = computeReportCoverage(
      analysisText,
      links.map((l) => l.url)
    );

    return {
      link,
      job,
      analysis: analysisText,
      links,
      quality,
    };
  }

  // Fire-and-forget read receipt: increments the view counter and timestamps for
  // a VALID share view. Callers MUST only invoke this after the payload is
  // resolved and confirmed non-revoked / non-expired. Errors are swallowed so a
  // failed update never blocks or breaks the client's report response.
  async recordShareView(linkId) {
    if (!linkId) return;
    try {
      await database.run(
        `UPDATE share_links
         SET view_count = COALESCE(view_count, 0) + 1,
             last_viewed_at = now(),
             first_viewed_at = COALESCE(first_viewed_at, now())
         WHERE id = $1`,
        [linkId]
      );
    } catch (error) {
      console.error('[collaboration] recordShareView failed:', error.message);
    }
  }
}

export default new CollaborationService();
export { isValidWorkspaceRole, normalizeWorkspaceRole };
