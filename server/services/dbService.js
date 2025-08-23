import database from '../database/connection.js';
import { logger } from '../utils.js';

/*
  SQL to create the cache table:

  CREATE TABLE IF NOT EXISTS parsed_cases (
    url TEXT PRIMARY KEY,
    case_data JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TRIGGER IF NOT EXISTS update_parsed_cases_updated_at
  BEFORE UPDATE ON parsed_cases
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_set_timestamp(); -- Assumes this function exists from other tables
*/

class DatabaseService {
  async createJob(jobData, userId = null) {
    const { id, status, totalLinks, prompt, title, titleSource = 'heuristic' } = jobData;
    const autoTitleEnabled =
      typeof jobData.autoTitleEnabled === 'boolean' ? jobData.autoTitleEnabled : true;
    const sql = `
            INSERT INTO jobs (id, title, status, total_links, prompt, progress, processed_links, user_id, title_source, user_edited, auto_title_enabled)
            VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7, false, $8)
        `;
    await database.run(sql, [id, title, status, totalLinks, prompt, userId, titleSource, autoTitleEnabled]);

    if (jobData.links && jobData.links.length > 0) {
      await this.addJobLinks(id, jobData.links, userId);
    }
    return await this.getJob(id, userId);
  }

  async getJob(jobId, userId = null) {
    // Один запрос с JOIN'ами для получения всех данных
    const jobSql = userId
      ? `SELECT * FROM jobs WHERE id = $1 AND user_id = $2`
      : `SELECT * FROM jobs WHERE id = $1`;
    const jobParams = userId ? [jobId, userId] : [jobId];
    const job = await database.get(jobSql, jobParams);

    if (!job) return null;

    const [links, analysis] = await Promise.all([
      this.getJobLinks(jobId, userId),
      this.getJobResult(jobId, userId),
    ]);

    if (job) {
      job.links = links;
      job.analysis = analysis;
    }
    return job;
  }

  async getRecentJobs(limit = null, userId = null) {
    const base = `SELECT id, status, progress, total_links, created_at, updated_at, title FROM jobs`;
    if (userId) {
      if (limit === null || limit === 'all') {
        return await database.all(`${base} WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      }
      return await database.all(`${base} WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [
        userId,
        limit,
      ]);
    }
    if (limit === null || limit === 'all') {
      return await database.all(`${base} ORDER BY created_at DESC`);
    }
    return await database.all(`${base} ORDER BY created_at DESC LIMIT $1`, [limit]);
  }

  async updateJobTitle(jobId, title, userId = null) {
    const sql = userId
      ? `UPDATE jobs SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3`
      : `UPDATE jobs SET title = $1, user_edited = true, title_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = $2`;
    const params = userId ? [title, jobId, userId] : [title, jobId];
    await database.run(sql, params);
    return await this.getJob(jobId, userId);
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
    const sql = `UPDATE jobs SET ${setClauses} WHERE id = $${paramIndex}`;

    await database.run(sql, params);
    return await this.getJob(jobId);
  }

  async updateAutoTitleIfAllowed(jobId, newTitle, source = 'heuristic') {
    const sql = `
      UPDATE jobs
      SET title = $1, title_source = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND COALESCE(user_edited, false) = false AND COALESCE(auto_title_enabled, true) = true`;
    const res = await database.run(sql, [newTitle, source, jobId]);
    return res.changes > 0;
  }

  async getJobOwnerId(jobId) {
    const row = await database.get('SELECT user_id FROM jobs WHERE id = $1', [jobId]);
    return row ? row.user_id : null;
  }

  async summarizeJobForTitle(jobId, userId = null) {
    // Count total and processed
    const totalRow = await database.get(
      userId
        ? 'SELECT COUNT(*)::int AS total FROM job_links WHERE job_id=$1 AND user_id=$2'
        : 'SELECT COUNT(*)::int AS total FROM job_links WHERE job_id=$1',
      userId ? [jobId, userId] : [jobId]
    );
    const processedRow = await database.get(
      userId
        ? "SELECT COUNT(*)::int AS processed FROM job_links WHERE job_id=$1 AND user_id=$2 AND status='processed'"
        : "SELECT COUNT(*)::int AS processed FROM job_links WHERE job_id=$1 AND status='processed'",
      userId ? [jobId, userId] : [jobId]
    );

    // Top law article
    const topArticleRow = await database.get(
      userId
        ? `
          SELECT article, COUNT(*) AS c FROM (
            SELECT jsonb_array_elements_text(law_articles) AS article
            FROM job_links
            WHERE job_id=$1 AND user_id=$2 AND status='processed' AND law_articles IS NOT NULL
          ) t
          GROUP BY article
          ORDER BY c DESC
          LIMIT 1
        `
        : `
          SELECT article, COUNT(*) AS c FROM (
            SELECT jsonb_array_elements_text(law_articles) AS article
            FROM job_links
            WHERE job_id=$1 AND status='processed' AND law_articles IS NOT NULL
          ) t
          GROUP BY article
          ORDER BY c DESC
          LIMIT 1
        `,
      userId ? [jobId, userId] : [jobId]
    );

    // Top case type
    const topTypeRow = await database.get(
      userId
        ? `SELECT case_type, COUNT(*) AS c FROM job_links WHERE job_id=$1 AND user_id=$2 AND status='processed' AND case_type IS NOT NULL GROUP BY case_type ORDER BY c DESC LIMIT 1`
        : `SELECT case_type, COUNT(*) AS c FROM job_links WHERE job_id=$1 AND status='processed' AND case_type IS NOT NULL GROUP BY case_type ORDER BY c DESC LIMIT 1`,
      userId ? [jobId, userId] : [jobId]
    );

    return {
      total: totalRow?.total || 0,
      processed: processedRow?.processed || 0,
      topArticle: topArticleRow?.article || null,
      topCaseType: topTypeRow?.case_type || null,
    };
  }

  async addJobLinks(jobId, links, userId = null) {
    if (!links || links.length === 0) return;

    // Batch insert для производительности
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

  async getJobLinks(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, status, content, decision_date FROM job_links WHERE job_id = $1 AND user_id = $2 ORDER BY id`
      : `SELECT url, status, content, decision_date FROM job_links WHERE job_id = $1 ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async updateLinkStatus(jobId, url, status, content = null, errorMessage = null, metadata = null) {
    let sql, params;

    if (metadata) {
      // Include legal metadata in the update
      sql = `
            UPDATE job_links 
            SET status = $1, content = $2, error_message = $3, processed_at = CURRENT_TIMESTAMP,
                law_articles = $6, claim_amount = $7, case_type = $8, parties = $9, metadata_extracted_at = CURRENT_TIMESTAMP
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
      ];
    } else {
      // Original update without metadata
      sql = `
            UPDATE job_links 
            SET status = $1, content = $2, error_message = $3, processed_at = CURRENT_TIMESTAMP
            WHERE job_id = $4 AND url = $5
        `;
      params = [status, content, errorMessage, jobId, url];
    }

    await database.run(sql, params);
  }

  async saveJobResult(jobId, analysisText) {
    // Проверяем, что задача еще существует перед сохранением результата
    const job = await database.get('SELECT id, user_id FROM jobs WHERE id = $1', [jobId]);
    if (!job) {
      logger.warn(
        `[DB] Попытка сохранить результат для несуществующей задачи ${jobId} - пропускаем`
      );
      return; // Тихо игнорируем, задача была удалена
    }

    try {
      await database.run('DELETE FROM job_results WHERE job_id = $1', [jobId]);
      const sql = `INSERT INTO job_results (job_id, analysis_text, user_id) VALUES ($1, $2, $3)`;
      await database.run(sql, [jobId, analysisText, job.user_id || null]);
      logger.info(
        `[DB] Результат анализа сохранен для задачи ${jobId} (${analysisText.length} символов)`
      );
    } catch (error) {
      // Дополнительная проверка на случай удаления задачи между проверкой и вставкой
      if (error.message.includes('foreign key constraint')) {
        logger.warn(
          `[DB] Задача ${jobId} была удалена во время сохранения результата - игнорируем`
        );
        return;
      }
      throw error; // Перебрасываем другие ошибки
    }
  }

  async getJobResult(jobId, userId = null) {
    const sql = userId
      ? `SELECT analysis_text FROM job_results WHERE job_id = $1 AND user_id = $2 LIMIT 1`
      : `SELECT analysis_text FROM job_results WHERE job_id = $1 LIMIT 1`;
    const params = userId ? [jobId, userId] : [jobId];
    const result = await database.get(sql, params);
    return result ? result.analysis_text : null;
  }

  async addChatMessage(jobId, role, content, userId = null) {
    const sql = `INSERT INTO chat_messages (job_id, role, content, user_id) VALUES ($1, $2, $3, $4) RETURNING id`;
    const result = await database.query(sql, [jobId, role, content, userId]);
    return result.rows?.[0]?.id || null;
  }

  async getChatHistory(jobId, userId = null, limit = 50) {
    const sql = userId
      ? `SELECT role, content FROM chat_messages WHERE job_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT $3`
      : `SELECT role, content FROM chat_messages WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2`;
    const params = userId ? [jobId, userId, limit] : [jobId, limit];
    return await database.all(sql, params);
  }

  // --- Caching Methods ---

  async getCachedCaseByUrl(url, userId = null) {
    const sql = userId
      ? `SELECT case_data FROM parsed_cases WHERE url = $1 AND user_id = $2`
      : `SELECT case_data FROM parsed_cases WHERE url = $1`;
    try {
      const row = await database.get(sql, userId ? [url, userId] : [url]);
      if (row) {
        logger.info(`[CACHE] HIT for URL: ${url}`);
        // The pg driver automatically parses JSON/JSONB fields, so no need for JSON.parse
        return row.case_data;
      }
      logger.info(`[CACHE] MISS for URL: ${url}`);
      return null;
    } catch (error) {
      logger.error(`[CACHE] Error getting cached case for URL ${url}:`, error);
      return null; // On error, proceed as if it's a cache miss
    }
  }

  async saveCaseToCache(caseData, userId = null) {
    // Use ON CONFLICT to perform an "upsert" operation.
    // If the URL already exists, it updates the case_data and updated_at fields.
    const sql = `
      INSERT INTO parsed_cases (url, case_data, created_at, updated_at, user_id)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)
      ON CONFLICT(url) 
      DO UPDATE SET 
        case_data = EXCLUDED.case_data, 
        updated_at = CURRENT_TIMESTAMP;
    `;
    try {
      // The caseData object needs to be stringified for the JSON column
      const caseDataJson = JSON.stringify(caseData);
      await database.run(sql, [caseData.url, caseDataJson, userId]);
      logger.info(`[CACHE] SAVED case for URL: ${caseData.url}`);

      // Clean up old cache entries occasionally (every 50th save)
      if (Math.random() < 0.02) {
        // 2% chance = ~every 50 saves
        await this.cleanupOldCacheEntries();
      }
    } catch (error) {
      logger.error(`[CACHE] Error saving case to cache for URL ${caseData.url}:`, error);
    }
  }

  async cleanupOldCacheEntries() {
    try {
      // Keep only the 1000 most recent cache entries
      const cleanupSql = `
        DELETE FROM parsed_cases 
        WHERE url NOT IN (
          SELECT url FROM parsed_cases 
          ORDER BY updated_at DESC 
          LIMIT 1000
        )
      `;
      const result = await database.run(cleanupSql);
      if (result.changes > 0) {
        logger.info(`[CACHE] Cleaned up ${result.changes} old cache entries`);
      }
    } catch (error) {
      logger.error(`[CACHE] Error cleaning up old cache entries:`, error);
    }
  }

  // --- End Caching Methods ---

  async getActiveJobsCount(userId = null) {
    const sql = userId
      ? `SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('completed', 'error') AND user_id = $1`
      : `SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('completed', 'error')`;
    const result = await database.get(sql, userId ? [userId] : []);
    return result.count || 0;
  }

  async getLastRelevantJob(userId = null) {
    // Priority: 1) Active jobs 2) Recently updated 3) Recently created
    const activeJob = await database.get(
      userId
        ? `SELECT * FROM jobs WHERE status NOT IN ('completed', 'error') AND user_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1`
        : `SELECT * FROM jobs WHERE status NOT IN ('completed', 'error') ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      userId ? [userId] : []
    );

    if (activeJob) {
      activeJob.links = await this.getJobLinks(activeJob.id, userId);
      activeJob.analysis = await this.getJobResult(activeJob.id, userId);
      return activeJob;
    }

    // No active jobs, get the most recently updated completed job
    const lastJob = await database.get(
      userId
        ? `SELECT * FROM jobs WHERE user_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1`
        : `SELECT * FROM jobs ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      userId ? [userId] : []
    );

    if (lastJob) {
      lastJob.links = await this.getJobLinks(lastJob.id, userId);
      lastJob.analysis = await this.getJobResult(lastJob.id, userId);
    }

    return lastJob;
  }

  async deleteJob(jobId, userId = null) {
    logger.info(`[DB] Attempting to delete job ${jobId} and all related data.`);
    const client = await database.pool.connect();
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
      client.release();
    }
  }

  async getProcessedUrls(userId = null) {
    const sql = `
      SELECT DISTINCT url, MAX(processed_at) as latest_processed_at
      FROM job_links 
      WHERE status = 'processed' ${userId ? 'AND user_id = $1' : ''}
      GROUP BY url
      ORDER BY latest_processed_at DESC
    `;
    const results = await database.all(sql, userId ? [userId] : []);
    return results.map((row) => row.url);
  }
}

export default new DatabaseService();

class SearchService {
  async search(query) {
    const sql = `SELECT * FROM edrsr WHERE name LIKE $1`;
    const params = [`%${query}%`];
    return await database.all(sql, params);
  }
}

export const searchService = new SearchService();
