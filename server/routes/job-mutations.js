import express from 'express';
import { v4 as uuid } from 'uuid';

import dbService from '../services/dbService.js';
import jobQueryService from '../services/jobQueryService.js';
import jobWriteService from '../services/jobWriteService.js';
import { limitRetry } from '../middleware/rateLimit.js';
import jobQueue from '../queue.js';
import { logger } from '../utils.js';
import { sendUpdateToJobOwner } from '../websocket.js';

export default function createJobMutationsRouter({
  chatMeta,
  chatSessions,
  clients,
  hasActiveWorker,
  processQueue,
  resolveWorkspaceFromQuery,
  terminateWorker,
}) {
  const router = express.Router();

  router.post('/retry/:jobId', limitRetry, async (req, res, next) => {
    try {
      const { jobId: oldJobId } = req.params;
      const { clientId } = req.body;

      if (!clientId || !clients.has(clientId)) {
        return res.status(400).json({ error: 'Неверный или отсутствующий clientId' });
      }

      const originalJob = await dbService.getJob(oldJobId, req.user?.id || null);
      if (!originalJob) {
        return res.status(404).json({ error: 'Задание для повтора не найдено.' });
      }

      const newJobId = uuid();
      const today = new Date().toLocaleDateString('uk-UA');
      const defaultTitle = `Повторний аналіз від ${today}`;

      const jobData = {
        id: newJobId,
        title: defaultTitle,
        status: 'queued',
        totalLinks: originalJob.total_links || originalJob.totalLinks || originalJob.links.length,
        links: originalJob.links.map((link) => ({
          url: link.url,
          decisionDate: link.decision_date,
          status: 'pending',
        })),
        prompt: originalJob.prompt,
        originalJobId: oldJobId,
      };

      const clientData = clients.get(clientId);
      if (clientData && clientData.userId && req.user?.id && clientData.userId === req.user.id) {
        clientData.jobs.add(newJobId);
      } else {
        logger.warn(`[SEC] ClientId ${clientId} does not match req.user for job ${newJobId}`);
      }

      await dbService.createJob(
        jobData,
        req.user?.id || null,
        originalJob.workspace_id || null,
        originalJob.matter_id || null
      );
      const newJobState = await dbService.getJob(newJobId, req.user?.id || null);

      sendUpdateToJobOwner(newJobId, {
        ...newJobState,
        status: 'queued',
        progress: 0,
        message: 'Задание в очереди на повтор',
      });

      res.json({ success: true, jobId: newJobId, ...newJobState });

      jobQueue.enqueue({
        jobId: newJobId,
        links: newJobState.links,
        cookie: '',
        prompt: newJobState.prompt,
      });
      processQueue();
    } catch (error) {
      next(error);
    }
  });

  router.patch('/jobs/:id/title', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { title } = req.body;

      if (!title || typeof title !== 'string' || title.length > 255) {
        return res.status(400).json({ error: 'Неверный или отсутствующий заголовок' });
      }

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;

      let updatedJob = null;
      if (workspace) {
        const job = await jobQueryService.getJobLightForWorkspace(id, workspace.id);
        if (!job) return res.status(404).json({ error: 'Задание не найдено' });
        if (workspace.role === 'member' && job.user_id && job.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Недостаточно прав доступа' });
        }
        updatedJob = await jobWriteService.updateJobTitleForWorkspace(id, title, workspace.id);
      } else {
        updatedJob = await jobWriteService.updateJobTitle(id, title, req.user?.id || null);
      }

      if (!updatedJob) {
        return res.status(404).json({ error: 'Задание не найдено' });
      }

      sendUpdateToJobOwner(id, {
        id,
        ...updatedJob,
        message: 'Заголовок обновлен',
      });

      res.status(200).json({ success: true, job: updatedJob });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/jobs/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;

      let job = null;
      if (workspace) {
        job = await jobQueryService.getJobLightForWorkspace(id, workspace.id);
        if (!job) return res.status(404).json({ error: 'Задание не найдено' });
        if (workspace.role === 'member' && job.user_id && job.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Недостаточно прав доступа' });
        }
      } else {
        job = await jobQueryService.getJobLight(id, req.user?.id || null);
        if (!job) return res.status(404).json({ error: 'Задание не найдено' });
      }

      const workerTerminated =
        hasActiveWorker(id) && terminateWorker(id, 'Задача удалена пользователем');
      if (workerTerminated) {
        logger.info(`[DELETE_JOB] Найден активный воркер для задачи ${id}, завершаю его...`);
      }

      jobQueue.clearCachedCookie(id);

      if (workspace) {
        await jobWriteService.deleteJobForWorkspace(id, workspace.id);
      } else {
        await jobWriteService.deleteJob(id, req.user?.id || null);
      }

      chatSessions.delete(id);
      chatMeta.delete(id);

      res.status(200).json({
        success: true,
        message: `Job ${id} deleted successfully.`,
        workerTerminated,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
