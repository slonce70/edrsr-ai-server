import database from '../database/connection.js';
import { logger } from '../utils.js';
import { extractEvidenceSnippet } from './evidenceService.js';

class JobWriteService {
  async updateJobTitle(jobId, title, userId = null) {
    const sql = userId
      ? `UPDATE jobs SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at`
      : `UPDATE jobs SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at`;
    const params = userId ? [title, jobId, userId] : [title, jobId];
    return await database.get(sql, params);
  }

  async updateJobTitleForWorkspace(jobId, title, workspaceId) {
    return await database.get(
      `UPDATE jobs
       SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND workspace_id = $3
       RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at`,
      [title, jobId, workspaceId]
    );
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
    const sql = `
      UPDATE jobs
      SET ${setClauses}
      WHERE id = $${paramIndex}
      RETURNING id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration
    `;

    return await database.get(sql, params);
  }

  async updateAutoTitleIfAllowed(jobId, newTitle, source = 'heuristic') {
    const sql = `
      UPDATE jobs
      SET title = $1, title_source = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND COALESCE(user_edited, false) = false AND COALESCE(auto_title_enabled, true) = true`;
    const res = await database.run(sql, [newTitle, source, jobId]);
    return res.changes > 0;
  }

  async addJobLinks(jobId, links, userId = null) {
    if (!links || links.length === 0) return;

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

  async updateLinkStatus(jobId, url, status, content = null, errorMessage = null, metadata = null) {
    let sql, params;
    const evidenceSnippet = status === 'processed' ? extractEvidenceSnippet(content) : null;
    const shouldUpdateEvidence = Boolean(evidenceSnippet);

    if (metadata) {
      sql = `
            UPDATE job_links
            SET status = $1, content = $2, error_message = $3, processed_at = CURRENT_TIMESTAMP,
                law_articles = $6, claim_amount = $7, case_type = $8, parties = $9,
                decision_date = COALESCE($10, decision_date),
                metadata_extracted_at = CURRENT_TIMESTAMP
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
        metadata.decisionDate || null,
      ];
    } else {
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
    const job = await database.get('SELECT id, user_id FROM jobs WHERE id = $1', [jobId]);
    if (!job) {
      logger.warn(
        `[DB] Попытка сохранить результат для несуществующей задачи ${jobId} - пропускаем`
      );
      return;
    }

    try {
      await database.run('DELETE FROM job_results WHERE job_id = $1', [jobId]);
      const sql = `INSERT INTO job_results (job_id, analysis_text, user_id) VALUES ($1, $2, $3)`;
      await database.run(sql, [jobId, analysisText, job.user_id || null]);
      logger.info(
        `[DB] Результат анализа сохранен для задачи ${jobId} (${analysisText.length} символов)`
      );
    } catch (error) {
      if (error.message.includes('foreign key constraint')) {
        logger.warn(
          `[DB] Задача ${jobId} была удалена во время сохранения результата - игнорируем`
        );
        return;
      }
      throw error;
    }
  }

  async deleteJob(jobId, userId = null) {
    logger.info(`[DB] Attempting to delete job ${jobId} and all related data.`);
    const client = await database.pool.connect();
    const onClientError = (err) => {
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
}

export default new JobWriteService();
