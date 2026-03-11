import express from 'express';

import { limitPromptDefinitions } from '../middleware/rateLimit.js';
import {
  validatePromptCreate,
  validatePromptImport,
  validatePromptUpdate,
} from '../middleware/validators.js';
import { orderPromptDefinitions } from '../prompt-definitions.js';
import promptService from '../services/promptService.js';

function formatPromptsMeta(meta) {
  const count = Number.isFinite(meta?.count) ? meta.count : 0;
  const lastUpdated = meta?.lastUpdated ? new Date(meta.lastUpdated).toISOString() : null;
  const etag = `W/"${count}:${lastUpdated || '0'}"`;
  return { count, lastUpdated, etag };
}

function formatPromptDefinitionsMeta(meta) {
  const version = Number.isFinite(meta?.version) ? meta.version : 1;
  const lastUpdated = meta?.lastUpdated ? new Date(meta.lastUpdated).toISOString() : null;
  const etag = `W/"v${version}:${lastUpdated || '0'}"`;
  return { version, lastUpdated, etag };
}

export default function createPromptsRouter() {
  const router = express.Router();

  router.get('/prompts/definitions', limitPromptDefinitions, async (req, res, next) => {
    try {
      const meta = await promptService.getPromptDefinitionsMeta();
      const { etag, lastUpdated, version } = formatPromptDefinitionsMeta(meta);
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === etag) {
        res.set('ETag', etag);
        return res.status(304).end();
      }

      const defs = await promptService.getPromptDefinitions();
      res.set('ETag', etag);
      return res.json({
        success: true,
        definitions: orderPromptDefinitions(defs?.payload || null),
        version: defs?.version ?? version,
        lastUpdated: defs?.updatedAt || lastUpdated,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/prompts', async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const meta = await promptService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === etag) {
        res.set('ETag', etag);
        return res.status(304).end();
      }

      const prompts = await promptService.listPrompts(userId);
      res.set('ETag', etag);
      return res.json({ success: true, prompts, lastUpdated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/prompts', validatePromptCreate, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { name, content } = req.body || {};
      const result = await promptService.createPrompt(userId, name, content);
      const meta = await promptService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({
        success: true,
        prompt: result.prompt,
        renamed: result.renamed,
        lastUpdated,
        etag,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/prompts/:id', validatePromptUpdate, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const promptId = req.params.id;
      const result = await promptService.updatePrompt(userId, promptId, req.body || {});
      if (!result?.prompt) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      const meta = await promptService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({
        success: true,
        prompt: result.prompt,
        renamed: result.renamed,
        lastUpdated,
        etag,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/prompts/:id', async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const promptId = req.params.id;
      const ok = await promptService.deletePrompt(userId, promptId);
      if (!ok) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }
      const meta = await promptService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({ success: true, lastUpdated, etag });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/prompts/import', validatePromptImport, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { prompts } = req.body || {};
      const result = await promptService.importPrompts(userId, prompts);
      const meta = await promptService.getPromptsMeta(userId);
      const { etag, lastUpdated } = formatPromptsMeta(meta);
      res.set('ETag', etag);
      return res.json({
        success: true,
        imported: result.imported,
        renamedCount: result.renamedCount,
        lastUpdated,
        etag,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
