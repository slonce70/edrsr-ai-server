import express from 'express';
import { v4 as uuid } from 'uuid';

import collaborationService from '../services/collaborationService.js';
import dbService from '../services/dbService.js';
import jobWriteService from '../services/jobWriteService.js';
import { generateInitialTitle } from '../services/jobTitleService.js';
import { limitCollect } from '../middleware/rateLimit.js';
import { validateCollectRequest } from '../middleware/validators.js';
import jobQueue from '../queue.js';
import { logger, isValidEDRSRUrl } from '../utils.js';
import { sendUpdateToJobOwner } from '../websocket.js';

export default function createJobCollectionRouter({ clients, processQueue }) {
  const router = express.Router();

  router.post('/collect', limitCollect, validateCollectRequest, async (req, res, next) => {
    try {
      const { links, cookie = '', prompt = null, clientId } = req.body;
      const autoTitleEnabled =
        typeof req.body.auto_title_enabled === 'boolean' ? req.body.auto_title_enabled : true;
      const promptLabel = req.body.prompt_label || null;
      if (!links || !Array.isArray(links) || links.length === 0) {
        return res.status(400).json({ error: 'Массив ссылок "links" не может быть пустым' });
      }

      const maxLinks = parseInt(process.env.MAX_LINKS_PER_REQUEST || '300', 10);
      if (links.length > maxLinks) {
        return res.status(422).json({ error: `Слишком много ссылок: максимум ${maxLinks}` });
      }

      let clientData = null;
      if (clientId) {
        if (!clients.has(clientId)) {
          logger.warn(`[SEC] Unknown clientId provided for collect: ${clientId}`);
        } else {
          clientData = clients.get(clientId);
        }
      }

      const validLinks = links.filter((link) => link && typeof link === 'object' && link.url);
      if (validLinks.length < links.length) {
        logger.warn(
          `[VALIDATION] Получен некорректный массив ссылок. Отфильтровано ${links.length - validLinks.length} невалидных элементов.`
        );
      }

      const strictlyValid = validLinks.filter(
        (link) => typeof link.url === 'string' && isValidEDRSRUrl(link.url)
      );
      const maxUrlLength = parseInt(process.env.MAX_URL_LENGTH || '2048', 10);
      const maxPromptLength = parseInt(process.env.MAX_PROMPT_LENGTH || '4000', 10);
      if (prompt && typeof prompt === 'string' && prompt.length > maxPromptLength) {
        return res.status(422).json({ error: `Слишком длинный prompt (> ${maxPromptLength})` });
      }

      const tooLongUrls = strictlyValid.filter((link) => link.url.length > maxUrlLength).length;
      if (tooLongUrls > 0) {
        logger.warn(
          `[VALIDATION] Отфильтровано ${tooLongUrls} слишком длинных URL (> ${maxUrlLength})`
        );
      }
      const safeLinks = strictlyValid.filter((link) => link.url.length <= maxUrlLength);

      if (safeLinks.length === 0) {
        return res
          .status(400)
          .json({ error: 'Не найдено ни одной валидной ссылки для обработки.' });
      }

      const jobId = uuid();
      const defaultTitle = generateInitialTitle({
        linksCount: safeLinks.length,
        prompt,
        promptLabel,
      });

      const jobData = {
        id: jobId,
        title: defaultTitle,
        status: 'queued',
        totalLinks: safeLinks.length,
        links: safeLinks,
        prompt,
        titleSource: 'heuristic',
        autoTitleEnabled,
      };

      if (clientData && clientData.userId && req.user?.id && clientData.userId === req.user.id) {
        clientData.jobs.add(jobId);
      } else if (clientId) {
        logger.warn(`[SEC] ClientId ${clientId} does not match req.user for job ${jobId}`);
      }

      let workspace = null;
      const requestedWorkspaceId =
        typeof req.body.workspaceId === 'string' ? req.body.workspaceId : null;
      if (req.user?.id) {
        if (requestedWorkspaceId) {
          const role = await collaborationService.getWorkspaceRole(
            req.user.id,
            requestedWorkspaceId
          );
          if (!role) return res.status(403).json({ error: 'Недостаточно прав доступа' });
          workspace = { id: requestedWorkspaceId, role };
        } else {
          workspace = await collaborationService.ensureWorkspaceForUser(
            req.user.id,
            req.user.email
          );
        }
      }

      const matterId = typeof req.body.matterId === 'string' ? req.body.matterId : null;
      if (matterId && workspace) {
        const matter = await collaborationService.getMatter(matterId, workspace.id);
        if (!matter) return res.status(404).json({ error: 'Matter not found' });
      }

      await dbService.createJob(jobData, req.user?.id || null, workspace?.id || null, matterId);
      const initialJobState = await dbService.getJob(jobId, req.user?.id || null);

      await jobWriteService.updateJobStatus(jobId, 'queued', { progress: 0 });
      sendUpdateToJobOwner(jobId, {
        ...initialJobState,
        status: 'queued',
        progress: 0,
        message: 'Задание в очереди',
      });

      res.json({ success: true, jobId, ...initialJobState });

      jobQueue.enqueue({ jobId, links: safeLinks, cookie, prompt });
      processQueue();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
