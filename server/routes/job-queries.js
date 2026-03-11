import express from 'express';

import jobQueryService from '../services/jobQueryService.js';

export default function createJobQueriesRouter({ resolveWorkspaceFromQuery }) {
  const router = express.Router();

  router.get('/status/:id', async (req, res, next) => {
    try {
      const include = []
        .concat(req.query.include || [])
        .flat()
        .map((s) => String(s).toLowerCase());
      const wantAnalysis = include.includes('analysis');
      const wantLinks = include.includes('links');

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;

      const userId = workspace ? null : req.user?.id || null;
      const base = workspace
        ? await jobQueryService.getJobLightForWorkspace(req.params.id, workspace.id)
        : await jobQueryService.getJobLight(req.params.id, userId);
      if (!base) return res.status(404).json({ error: 'Задание не найдено' });

      if (wantAnalysis) {
        base.analysis = workspace
          ? await jobQueryService.getJobResultForWorkspace(req.params.id, workspace.id)
          : await jobQueryService.getJobResult(req.params.id, userId);
      }
      if (wantLinks) {
        base.links = workspace
          ? await jobQueryService.getJobLinksLightForWorkspace(req.params.id, workspace.id)
          : await jobQueryService.getJobLinksLight(req.params.id, userId);
      }

      return res.json(base);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/jobs/:jobId/analysis', async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const analysis = workspace
        ? await jobQueryService.getJobResultForWorkspace(jobId, workspace.id)
        : await jobQueryService.getJobResult(jobId, req.user?.id || null);
      if (!analysis) {
        return res.status(404).json({ error: 'Анализ для этого задания не найден.' });
      }
      return res.json({ success: true, jobId, analysis });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/jobs/:jobId/links-content', async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const links = workspace
        ? await jobQueryService.getLinksContentForWorkspace(jobId, workspace.id)
        : await jobQueryService.getLinksContent(jobId, req.user?.id || null);
      return res.json({ success: true, jobId, links });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/jobs/last', async (req, res, next) => {
    try {
      const lastJob = await jobQueryService.getLastRelevantJob(req.user?.id || null);
      if (!lastJob) {
        return res.status(404).json({ error: 'Нет доступных заданий' });
      }
      return res.json({ success: true, job: lastJob });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/processed-urls', async (req, res, next) => {
    try {
      const processedUrls = await jobQueryService.getProcessedUrls(req.user?.id || null);
      return res.json({ success: true, urls: processedUrls });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/urls/processed-check', async (req, res, next) => {
    try {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter(Boolean) : [];
      if (urls.length === 0) return res.json({ success: true, processed: [] });
      const processed = await jobQueryService.getProcessedMembership(urls, req.user?.id || null);
      return res.json({ success: true, processed });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
