import database from '../database/connection.js';
import { computeReportCoverage } from '../quality/coverage.js';

const escapeLike = (value) => String(value || '').replace(/[\\%_]/g, '\\$&');

class JobQueryService {
  async getJob(jobId, userId = null) {
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

    job.links = links;
    job.analysis = analysis;
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

  async getRecentJobsForWorkspace(workspaceId, limit = null) {
    const base =
      'SELECT id, status, progress, total_links, created_at, updated_at, title FROM jobs WHERE workspace_id = $1';
    if (limit === null || limit === 'all') {
      return await database.all(`${base} ORDER BY created_at DESC`, [workspaceId]);
    }
    return await database.all(`${base} ORDER BY created_at DESC LIMIT $2`, [workspaceId, limit]);
  }

  async getJobsPage({
    page = 1,
    limit = 20,
    status = '',
    search = '',
    userId = null,
    workspaceId = null,
  } = {}) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
    const where = [];
    const params = [];
    let idx = 1;

    if (workspaceId) {
      where.push(`workspace_id = $${idx}`);
      params.push(workspaceId);
      idx++;
    } else if (userId) {
      where.push(`user_id = $${idx}`);
      params.push(userId);
      idx++;
    }
    if (status) {
      where.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (search) {
      const safeSearch = `%${escapeLike(search)}%`;
      where.push(`(title ILIKE $${idx} OR prompt ILIKE $${idx})`);
      params.push(safeSearch);
      idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (safePage - 1) * safeLimit;

    const jobs = await database.all(
      `SELECT id, status, progress, processed_links, total_links, created_at, updated_at, title, duration, matter_id
       FROM jobs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, safeLimit, offset]
    );

    const totalRow = await database.get(
      `SELECT COUNT(*)::int AS total FROM jobs ${whereClause}`,
      params
    );

    return {
      jobs,
      total: totalRow?.total || 0,
      page: safePage,
      limit: safeLimit,
    };
  }

  async getJobLight(jobId, userId = null) {
    const sql = userId
      ? `SELECT id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration, workspace_id, matter_id, error_message FROM jobs WHERE id = $1 AND user_id = $2`
      : `SELECT id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration, workspace_id, matter_id, error_message FROM jobs WHERE id = $1`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.get(sql, params);
  }

  async getJobLightForWorkspace(jobId, workspaceId) {
    return await database.get(
      `SELECT id, title, status, progress, processed_links, total_links, prompt, created_at, updated_at, duration, workspace_id, matter_id, user_id, error_message
       FROM jobs
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId]
    );
  }

  async getJobOwnerId(jobId) {
    const row = await database.get('SELECT user_id FROM jobs WHERE id = $1', [jobId]);
    return row ? row.user_id : null;
  }

  async getJobStatus(jobId) {
    const row = await database.get('SELECT status FROM jobs WHERE id = $1', [jobId]);
    return row ? row.status : null;
  }

  async summarizeJobForTitle(jobId, userId = null) {
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

  async getJobLinks(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, status, content, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 AND user_id = $2 ORDER BY id`
      : `SELECT url, status, content, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async getJobLinksLight(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, status, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 AND user_id = $2 ORDER BY id`
      : `SELECT url, status, decision_date, evidence_snippet FROM job_links WHERE job_id = $1 ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async getJobLinksLightForWorkspace(jobId, workspaceId) {
    return await database.all(
      `SELECT jl.url, jl.status, jl.decision_date, jl.evidence_snippet
       FROM job_links jl
       JOIN jobs j ON j.id = jl.job_id
       WHERE jl.job_id = $1 AND j.workspace_id = $2
       ORDER BY jl.id`,
      [jobId, workspaceId]
    );
  }

  async getJobResult(jobId, userId = null) {
    const sql = userId
      ? `SELECT analysis_text FROM job_results WHERE job_id = $1 AND user_id = $2 LIMIT 1`
      : `SELECT analysis_text FROM job_results WHERE job_id = $1 LIMIT 1`;
    const params = userId ? [jobId, userId] : [jobId];
    const result = await database.get(sql, params);
    return result ? result.analysis_text : null;
  }

  async getJobResultForWorkspace(jobId, workspaceId) {
    const row = await database.get(
      `SELECT jr.analysis_text
       FROM job_results jr
       JOIN jobs j ON j.id = jr.job_id
       WHERE jr.job_id = $1 AND j.workspace_id = $2
       LIMIT 1`,
      [jobId, workspaceId]
    );
    return row ? row.analysis_text : null;
  }

  async getJobQuality(jobId, userId = null) {
    const analysis = await this.getJobResult(jobId, userId);
    if (!analysis) return null;
    const rows = await database.all(
      userId
        ? 'SELECT url FROM job_links WHERE job_id = $1 AND user_id = $2'
        : 'SELECT url FROM job_links WHERE job_id = $1',
      userId ? [jobId, userId] : [jobId]
    );
    return computeReportCoverage(analysis, rows.map((r) => r.url));
  }

  async getJobQualityForWorkspace(jobId, workspaceId) {
    const analysis = await this.getJobResultForWorkspace(jobId, workspaceId);
    if (!analysis) return null;
    const rows = await database.all(
      'SELECT jl.url FROM job_links jl JOIN jobs j ON j.id = jl.job_id WHERE jl.job_id = $1 AND j.workspace_id = $2',
      [jobId, workspaceId]
    );
    return computeReportCoverage(analysis, rows.map((r) => r.url));
  }

  async getLinksContent(jobId, userId = null) {
    const sql = userId
      ? `SELECT url, content FROM job_links WHERE job_id = $1 AND user_id = $2 AND status = 'processed' ORDER BY id`
      : `SELECT url, content FROM job_links WHERE job_id = $1 AND status = 'processed' ORDER BY id`;
    const params = userId ? [jobId, userId] : [jobId];
    return await database.all(sql, params);
  }

  async getLinksContentForWorkspace(jobId, workspaceId) {
    return await database.all(
      `SELECT jl.url, jl.content
       FROM job_links jl
       JOIN jobs j ON j.id = jl.job_id
       WHERE jl.job_id = $1 AND j.workspace_id = $2 AND jl.status = 'processed'
       ORDER BY jl.id`,
      [jobId, workspaceId]
    );
  }

  async getActiveJobsCount(userId = null) {
    const sql = userId
      ? `SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('completed', 'error') AND user_id = $1`
      : `SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('completed', 'error')`;
    const result = await database.get(sql, userId ? [userId] : []);
    return result.count || 0;
  }

  async getLastRelevantJob(userId = null) {
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

  async getOverview({ userId = null, workspaceId = null } = {}) {
    // Build the scope predicate exactly once, mirroring the GET /jobs access model:
    // when a workspace is resolved filter by workspace_id, otherwise by user_id.
    // $1 is reserved for the scope value so every query reuses the same params array.
    let scopeClause = '';
    const params = [];
    if (workspaceId) {
      scopeClause = 'workspace_id = $1';
      params.push(workspaceId);
    } else if (userId) {
      scopeClause = 'user_id = $1';
      params.push(userId);
    }
    const whereScope = scopeClause ? `WHERE ${scopeClause}` : '';
    const andScope = scopeClause ? `AND ${scopeClause}` : '';

    const totalRow = await database.get(
      `SELECT COUNT(*)::int AS total FROM jobs ${whereScope}`,
      params
    );

    const statusRows = await database.all(
      `SELECT status, COUNT(*)::int AS count FROM jobs ${whereScope} GROUP BY status`,
      params
    );

    const thisWeekRow = await database.get(
      `SELECT COUNT(*)::int AS count FROM jobs
       WHERE created_at >= now() - interval '7 days' ${andScope}`,
      params
    );

    const todayRow = await database.get(
      `SELECT COUNT(*)::int AS count FROM jobs
       WHERE created_at >= date_trunc('day', now()) ${andScope}`,
      params
    );

    const matterRows = await database.all(
      `SELECT matter_id, COUNT(*)::int AS count FROM jobs
       WHERE matter_id IS NOT NULL ${andScope}
       GROUP BY matter_id
       ORDER BY count DESC
       LIMIT 8`,
      params
    );

    const recent = await database.all(
      `SELECT id, status, progress, total_links, processed_links, created_at, updated_at, title, matter_id
       FROM jobs
       ${whereScope}
       ORDER BY created_at DESC
       LIMIT 8`,
      params
    );

    const statusCounts = {};
    for (const row of statusRows) {
      statusCounts[row.status] = row.count;
    }

    return {
      total: totalRow?.total || 0,
      statusCounts,
      thisWeek: thisWeekRow?.count || 0,
      today: todayRow?.count || 0,
      byMatter: matterRows,
      recent,
    };
  }

  async getProcessedMembership(urls = [], userId = null) {
    if (!Array.isArray(urls) || urls.length === 0) return [];
    const sql = userId
      ? `SELECT url FROM job_links WHERE status = 'processed' AND user_id = $2 AND url = ANY($1)`
      : `SELECT url FROM job_links WHERE status = 'processed' AND url = ANY($1)`;
    const params = userId ? [urls, userId] : [urls];
    const rows = await database.all(sql, params);
    return rows.map((r) => r.url);
  }
}

export default new JobQueryService();
