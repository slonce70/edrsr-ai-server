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
    sort = '',
    matterId = '',
    userId = null,
    workspaceId = null,
  } = {}) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
    // Whitelist sort keys → fixed ORDER BY clauses. The clause is NEVER built from
    // user input — only a key is matched against this fixed map (injection-safe).
    const SORT_CLAUSES = {
      created_at_desc: 'created_at DESC',
      created_at_asc: 'created_at ASC',
      updated_at_desc: 'updated_at DESC',
      title_asc: 'title ASC NULLS LAST',
      title_desc: 'title DESC NULLS LAST',
      status_asc: 'status ASC, created_at DESC',
    };
    const orderByClause = SORT_CLAUSES[sort] || SORT_CLAUSES.created_at_desc;
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
    // Optional matter filter. matter_id is a UUID column on jobs (tenant-scoped
    // above via workspace_id/user_id), so the predicate is parameterized and the
    // value is appended at the current $-index — keeping LIMIT/OFFSET in line.
    if (matterId) {
      where.push(`matter_id = $${idx}`);
      params.push(matterId);
      idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (safePage - 1) * safeLimit;

    const jobs = await database.all(
      `SELECT id, status, progress, processed_links, total_links, created_at, updated_at, title, duration, matter_id
       FROM jobs
       ${whereClause}
       ORDER BY ${orderByClause}
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

  // Cross-report full-text search over report BODIES (job_results.analysis_text),
  // tenant-scoped IDENTICALLY to getJobsPage / the GET /jobs read path: by
  // workspace_id when a workspace is resolved, otherwise by user_id. Returns the
  // matching jobs plus a short context snippet around the first match.
  //
  // The term is matched case-insensitively as a literal substring via ILIKE,
  // with escapeLike() neutralizing %/_/\ so they are treated literally (never as
  // wildcards) — fully parameterized, never interpolated (injection-safe).
  //
  // SCALE NOTE: ILIKE '%term%' is a sequential scan. That is fine at the current
  // scale (a handful of reports per tenant). The scale-up path is a GIN/tsvector
  // (or pg_trgm) index on analysis_text — out of scope here.
  async searchJobsByContent({ userId = null, workspaceId = null, query = '', limit = 20 } = {}) {
    const term = String(query || '').trim();
    // Guard: don't run a full-table ILIKE on an empty/too-short term.
    if (term.length < 2) return [];
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 50);

    // Scope predicate on the jobs row (j), mirroring getJobsPage exactly. We
    // always JOIN job_results -> jobs so the same scoping applies whether we
    // filter by workspace_id or user_id; no new exposure beyond /jobs.
    const where = [];
    const params = [];
    let idx = 1;
    if (workspaceId) {
      where.push(`j.workspace_id = $${idx}`);
      params.push(workspaceId);
      idx++;
    } else if (userId) {
      where.push(`j.user_id = $${idx}`);
      params.push(userId);
      idx++;
    }

    // The match term. escapeLike() makes %/_/\ literal; we wrap with %...% in SQL
    // so the value bound to $idx is just the (escaped) needle.
    const likeTerm = `%${escapeLike(term)}%`;
    const termIdx = idx;
    where.push(`jr.analysis_text ILIKE $${termIdx}`);
    params.push(likeTerm);
    idx++;

    // Raw (un-escaped) term for position() — position() does a literal match, so
    // it must NOT receive the ILIKE-escaped form. Bound as its own parameter.
    const posIdx = idx;
    params.push(term);
    idx++;

    const whereClause = `WHERE ${where.join(' AND ')}`;

    // snippet: a 160-char window starting ~60 chars before the first
    // case-insensitive match, with internal whitespace collapsed. position() on
    // the lowercased text/term locates the first hit; greatest(1, pos-60) keeps
    // substring()'s start in range. All values are parameterized.
    // De-duplicate by job: a job with >1 job_results row (legacy data) would
    // otherwise appear once per result row. DISTINCT ON (j.id) collapses to one
    // row per job and REQUIRES j.id to lead its ORDER BY, so we do that in an
    // inner query, then re-order the de-duplicated set by created_at DESC for
    // display in the outer query. LIMIT is applied last to the final set.
    const rows = await database.all(
      `SELECT t.id, t.title, t.status, t.created_at, t.snippet
       FROM (
         SELECT DISTINCT ON (j.id)
                j.id,
                j.title,
                j.status,
                j.created_at,
                regexp_replace(
                  trim(
                    substring(
                      jr.analysis_text
                      FROM greatest(1, position(lower($${posIdx}) IN lower(jr.analysis_text)) - 60)
                      FOR 160
                    )
                  ),
                  '\\s+', ' ', 'g'
                ) AS snippet
         FROM job_results jr
         JOIN jobs j ON j.id = jr.job_id
         ${whereClause}
         ORDER BY j.id, j.created_at DESC
       ) t
       ORDER BY t.created_at DESC
       LIMIT $${idx}`,
      [...params, safeLimit]
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      created_at: row.created_at,
      snippet: row.snippet || '',
    }));
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
