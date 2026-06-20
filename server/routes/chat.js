import express from 'express';

import { validateChatMessage } from '../middleware/validators.js';
import { answerChatQuestion } from '../gemini.js';
import chatService from '../services/chatService.js';
import jobQueryService from '../services/jobQueryService.js';
import { sendUpdateToJobOwner } from '../websocket.js';

export default function createChatRouter({ chatMeta, chatSessions, resolveWorkspaceFromQuery }) {
  const router = express.Router();

  router.post('/chat/:jobId', validateChatMessage, async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Сообщение не может быть пустым' });

      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const analysis = workspace
        ? await jobQueryService.getJobResultForWorkspace(jobId, workspace.id)
        : await jobQueryService.getJobResult(jobId, req.user?.id || null);
      if (!analysis) return res.status(404).json({ error: 'Анализ для этого задания не найден.' });

      await chatService.addChatMessage(jobId, 'user', message, req.user?.id || null);
      const history = workspace
        ? await chatService.getChatHistoryForWorkspace(jobId, workspace.id)
        : await chatService.getChatHistory(jobId, req.user?.id || null);

      const hadSessionBefore = chatSessions.has(jobId);
      const answer = await answerChatQuestion(jobId, analysis, history, message, chatSessions);

      const now = Date.now();
      const current = chatMeta.get(jobId) || { createdAt: now, lastUsed: now };
      chatMeta.set(jobId, {
        createdAt: hadSessionBefore ? (current.createdAt ?? now) : now,
        lastUsed: now,
      });

      await chatService.addChatMessage(jobId, 'ai', answer, req.user?.id || null);

      const newHistory = workspace
        ? await chatService.getChatHistoryForWorkspace(jobId, workspace.id)
        : await chatService.getChatHistory(jobId, req.user?.id || null);
      // Include the job id so multi-tab consumers can verify the chat update
      // belongs to the job they currently have open (privacy/trust guard).
      sendUpdateToJobOwner(jobId, { type: 'CHAT_UPDATE', id: jobId, payload: newHistory });

      return res.json({ success: true, answer });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/chat/:jobId', async (req, res, next) => {
    try {
      const workspace = await resolveWorkspaceFromQuery(req, res);
      if (req.query.workspaceId && !workspace) return;
      const history = workspace
        ? await chatService.getChatHistoryForWorkspace(req.params.jobId, workspace.id)
        : await chatService.getChatHistory(req.params.jobId, req.user?.id || null);
      return res.json(history);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
