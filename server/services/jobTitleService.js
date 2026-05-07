import dbService from './dbService.js';
import jobQueryService from './jobQueryService.js';
import jobWriteService from './jobWriteService.js';
import { logger } from '../utils.js';
import { sendUpdateToJobOwner } from '../websocket.js';

function truncate(str, max = 70) {
  if (!str) return '';
  const s = String(str).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function buildPromptTitleWords(prompt) {
  return prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 5)
    .join(' ');
}

export function generateInitialTitle({ linksCount = 0, prompt = null, promptLabel = null }) {
  const n = linksCount || 0;
  const suffix = n > 0 ? ` — ${n} справ` : '';
  if (promptLabel && promptLabel.trim()) return `Аналіз: «${truncate(promptLabel, 40)}»${suffix}`;

  if (prompt && typeof prompt === 'string' && prompt.trim()) {
    const words = buildPromptTitleWords(prompt);
    if (words) return `Запит: ${truncate(words, 40)}${suffix}`;
  }

  const today = new Date().toLocaleDateString('uk-UA');
  return `Аналіз від ${today}${suffix}`;
}

export async function refreshHeuristicTitle(jobId) {
  try {
    const userId = await jobQueryService.getJobOwnerId(jobId);
    const summary = await jobQueryService.summarizeJobForTitle(jobId, userId || null);
    const { processed, total, topArticle, topCaseType } = summary;
    const status = await jobQueryService.getJobStatus(jobId);
    if (!total || total < 1) return false;

    let base = '';
    if (topArticle) base = `Ст. ${topArticle}`;
    else if (topCaseType) base = `${topCaseType}`;
    else base = 'Аналіз';

    const suffix =
      status === 'completed' ? (processed ? ` — ${processed} з ${total}` : '') : ` — ${total}`;
    const title = truncate(`${base}${suffix}`, 70);
    const ok = await jobWriteService.updateAutoTitleIfAllowed(jobId, title, 'heuristic');

    if (ok) {
      const updatedJob = await dbService.getJob(jobId, userId || null);
      if (updatedJob) {
        sendUpdateToJobOwner(jobId, {
          id: updatedJob.id,
          title: updatedJob.title,
          status: updatedJob.status,
          progress: updatedJob.progress,
          processed_links: updatedJob.processed_links,
          total_links: updatedJob.total_links,
          updated_at: updatedJob.updated_at,
        });
      } else {
        logger.debug(`[TITLE] Job ${jobId} disappeared before title update broadcast`);
      }
    }

    return ok;
  } catch (error) {
    logger.debug(`[TITLE] refreshHeuristicTitle error for ${jobId}: ${error.message}`);
    return false;
  }
}
