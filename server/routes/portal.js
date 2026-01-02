import express from 'express';
import dbService from '../services/dbService.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { validatePromptCreate, validatePromptUpdate } from '../middleware/validators.js';
import { attachWorkspace, requireWorkspaceRole } from '../middleware/workspace.js';

const router = express.Router();

// Attach user for all portal routes
router.use(attachUser);

// Public share view (token + expiry)
router.get('/share/:token', async (req, res, next) => {
  try {
    const payload = await dbService.getSharePayloadByToken(req.params.token);
    if (!payload) return res.status(404).json({ error: 'Share link not found' });

    const expiresAt = payload.link?.expires_at ? new Date(payload.link.expires_at) : null;
    if (payload.link?.revoked_at) {
      return res.status(410).json({ error: 'Share link revoked' });
    }
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: 'Share link expired' });
    }

    return res.json({
      success: true,
      share: {
        id: payload.link.id,
        expires_at: payload.link.expires_at,
        created_at: payload.link.created_at,
      },
      job: payload.job,
      analysis: payload.analysis,
      links: payload.links || [],
    });
  } catch (error) {
    next(error);
  }
});

// Auth required below
router.use(requireAuth);
router.use(attachWorkspace);

// Shared prompts (workspace)
router.get('/prompts/shared', async (req, res, next) => {
  try {
    const prompts = await dbService.listWorkspacePrompts(req.workspace.id);
    res.json({ success: true, workspace_id: req.workspace.id, prompts });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/prompts/shared',
  requireWorkspaceRole(['owner', 'admin']),
  validatePromptCreate,
  async (req, res, next) => {
    try {
      const { name, content } = req.body || {};
      const result = await dbService.createWorkspacePrompt(
        req.workspace.id,
        req.user.id,
        name,
        content
      );
      res.json({ success: true, prompt: result.prompt, renamed: result.renamed });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/prompts/shared/:id',
  requireWorkspaceRole(['owner', 'admin']),
  validatePromptUpdate,
  async (req, res, next) => {
    try {
      const result = await dbService.updateWorkspacePrompt(
        req.workspace.id,
        req.params.id,
        req.body || {},
        req.user.id
      );
      if (!result?.prompt) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      res.json({ success: true, prompt: result.prompt, renamed: result.renamed });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/prompts/shared/:id',
  requireWorkspaceRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const ok = await dbService.deleteWorkspacePrompt(
        req.workspace.id,
        req.params.id,
        req.user.id
      );
      if (!ok) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/prompts/shared/from-user',
  requireWorkspaceRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const promptId = typeof req.body?.promptId === 'string' ? req.body.promptId : '';
      if (!promptId) return res.status(400).json({ error: 'promptId is required' });
      const result = await dbService.shareUserPromptToWorkspace(
        req.workspace.id,
        req.user.id,
        promptId
      );
      if (!result?.shared) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      res.json({ success: true, prompt: result.shared, renamed: result.renamed });
    } catch (error) {
      next(error);
    }
  }
);

// Workspaces
router.get('/workspaces', async (req, res, next) => {
  try {
    const workspaces = await dbService.listWorkspaces(req.user.id);
    res.json({ success: true, workspaces, active_workspace_id: req.workspace?.id || null });
  } catch (error) {
    next(error);
  }
});

router.post('/workspaces', async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Workspace name is required' });
    const workspace = await dbService.createWorkspace(req.user.id, name);
    res.json({ success: true, workspace });
  } catch (error) {
    next(error);
  }
});

router.get('/workspaces/:workspaceId/members', async (req, res, next) => {
  try {
    const members = await dbService.listWorkspaceMembers(req.workspace.id);
    res.json({ success: true, workspace_id: req.workspace.id, members });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/workspaces/:workspaceId/members',
  requireWorkspaceRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const role = typeof req.body?.role === 'string' ? req.body.role : 'member';
      if (!email) return res.status(400).json({ error: 'Email is required' });

      const result = await dbService.addWorkspaceMember(req.workspace.id, email, role, req.user.id);
      if (result.error === 'user_not_found') {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json({ success: true, member: result.member, email: result.email });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/workspaces/:workspaceId/members/:memberId',
  requireWorkspaceRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const role = typeof req.body?.role === 'string' ? req.body.role : '';
      if (!role) return res.status(400).json({ error: 'Role is required' });
      const targetId = req.params.memberId;

      const existingRole = await dbService.getWorkspaceRole(targetId, req.workspace.id);
      if (!existingRole) return res.status(404).json({ error: 'Member not found' });
      if (existingRole === 'owner' && role !== 'owner') {
        return res.status(400).json({ error: 'Cannot change owner role' });
      }

      const updated = await dbService.updateWorkspaceMemberRole(req.workspace.id, targetId, role);
      if (!updated) return res.status(404).json({ error: 'Member not found' });
      return res.json({ success: true, member: updated });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/workspaces/:workspaceId/members/:memberId',
  requireWorkspaceRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const targetId = req.params.memberId;
      const existingRole = await dbService.getWorkspaceRole(targetId, req.workspace.id);
      if (!existingRole) return res.status(404).json({ error: 'Member not found' });
      if (existingRole === 'owner') {
        return res.status(400).json({ error: 'Cannot remove workspace owner' });
      }
      const removed = await dbService.removeWorkspaceMember(req.workspace.id, targetId);
      return res.json({ success: true, removed });
    } catch (error) {
      next(error);
    }
  }
);

// Matters
router.get('/matters', async (req, res, next) => {
  try {
    const matters = await dbService.listMatters(req.workspace.id);
    res.json({ success: true, workspace_id: req.workspace.id, matters });
  } catch (error) {
    next(error);
  }
});

router.post('/matters', async (req, res, next) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const matter = await dbService.createMatter(
      {
        workspaceId: req.workspace.id,
        title,
        description: typeof req.body?.description === 'string' ? req.body.description : null,
        clientName: typeof req.body?.clientName === 'string' ? req.body.clientName : null,
        tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
      },
      req.user.id
    );
    res.json({ success: true, matter });
  } catch (error) {
    next(error);
  }
});

router.get('/matters/:matterId', async (req, res, next) => {
  try {
    const matter = await dbService.getMatter(req.params.matterId, req.workspace.id);
    if (!matter) return res.status(404).json({ error: 'Matter not found' });
    const jobs = await dbService.listMatterJobs(req.params.matterId, req.workspace.id);
    res.json({ success: true, matter, jobs });
  } catch (error) {
    next(error);
  }
});

router.patch('/matters/:matterId', async (req, res, next) => {
  try {
    const updated = await dbService.updateMatter(req.params.matterId, req.workspace.id, {
      title: req.body?.title,
      description: req.body?.description,
      clientName: req.body?.clientName,
      tags: req.body?.tags,
    });
    if (!updated) return res.status(404).json({ error: 'Matter not found' });
    res.json({ success: true, matter: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/matters/:matterId', async (req, res, next) => {
  try {
    const deleted = await dbService.deleteMatter(req.params.matterId, req.workspace.id);
    res.json({ success: true, deleted });
  } catch (error) {
    next(error);
  }
});

router.post('/matters/:matterId/jobs', async (req, res, next) => {
  try {
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const assigned = await dbService.assignJobToMatter(
      jobId,
      req.params.matterId,
      req.workspace.id
    );
    if (!assigned) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true, job: assigned });
  } catch (error) {
    next(error);
  }
});

router.delete('/matters/:matterId/jobs/:jobId', async (req, res, next) => {
  try {
    const removed = await dbService.removeJobFromMatter(
      req.params.jobId,
      req.params.matterId,
      req.workspace.id
    );
    res.json({ success: true, removed });
  } catch (error) {
    next(error);
  }
});

// Share links
router.get('/share-links', async (req, res, next) => {
  try {
    const links = await dbService.listShareLinksForWorkspace(req.workspace.id);
    res.json({ success: true, links });
  } catch (error) {
    next(error);
  }
});

router.post('/share-links', async (req, res, next) => {
  try {
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const daysRaw = Number.parseInt(req.body?.expiresInDays, 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 14;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const job = await dbService.getJobLightForWorkspace(jobId, req.workspace.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const result = await dbService.createShareLink(jobId, req.user.id, expiresAt);
    const host = process.env.PUBLIC_SHARE_BASE_URL || process.env.APP_BASE_URL || '';
    const shareUrl = host ? `${host.replace(/\/$/, '')}/share/${result.token}` : null;

    res.json({
      success: true,
      share: {
        ...result.link,
        url: shareUrl,
      },
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/share-links/:id/revoke', async (req, res, next) => {
  try {
    const revoked = await dbService.revokeShareLink(req.params.id);
    res.json({ success: true, revoked });
  } catch (error) {
    next(error);
  }
});

export default router;
