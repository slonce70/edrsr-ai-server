import database from '../database/connection.js';
import { logger } from '../utils.js';

class QueueService {
  async recoverStuckJobs() {
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE status NOT IN ('completed','error','queued','retrying')
        AND (lease_until IS NULL OR lease_until < NOW())
    `;
    try {
      const res = await database.run(sql);
      if (res.changes > 0) {
        logger.info(`🔁 Recovered ${res.changes} stuck job(s) to 'retrying'`);
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] recoverStuckJobs error:', e.message);
      return 0;
    }
  }

  async recoverJobsAfterServerRestart(serverStartedAtIso) {
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status NOT IN ('completed','error','queued','retrying')
        AND (locked_by IS NOT NULL OR lease_until IS NOT NULL OR heartbeat_at IS NOT NULL)
        AND (heartbeat_at IS NULL OR heartbeat_at < $1)
    `;
    try {
      const res = await database.run(sql, [serverStartedAtIso]);
      if (res.changes > 0) {
        logger.info(`🩺 Recovered ${res.changes} pre-restart in-progress job(s) to 'retrying'`);
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] recoverJobsAfterServerRestart error:', e.message);
      return 0;
    }
  }

  async recoverJobsWithStaleHeartbeat(graceMinutes = 5) {
    const minutes = Math.max(1, parseInt(graceMinutes, 10) || 5);
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status NOT IN ('completed','error','queued','retrying')
        AND (
          heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '${minutes} minutes'
        )
    `;
    try {
      const res = await database.run(sql);
      if (res.changes > 0) {
        logger.info(
          `🧯 Force-recovered ${res.changes} in-flight job(s) with stale heartbeat (${minutes}m)`
        );
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] recoverJobsWithStaleHeartbeat error:', e.message);
      return 0;
    }
  }

  async retryFailedJobs() {
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL,
          attempt = COALESCE(attempt, 0), updated_at = CURRENT_TIMESTAMP
      WHERE status = 'error'
        AND COALESCE(attempt, 0) < 3
        AND (
          error_message LIKE '%Memory limit exceeded%'
          OR error_message LIKE '%Worker terminated due to reaching memory limit%'
          OR error_message LIKE '%зависла%'
          OR error_message LIKE '%timeout%'
          OR error_message LIKE '%превысил%'
          OR error_message LIKE '%network%'
          OR error_message LIKE '%ENET%'
          OR error_message LIKE '%ECONN%'
          OR error_message LIKE '%503%'
          OR error_message LIKE '%502%'
          OR error_message LIKE '%fetch failed%'
        )
        AND updated_at > NOW() - INTERVAL '24 hours'
    `;
    try {
      const res = await database.run(sql);
      if (res.changes > 0) {
        logger.info(`🔄 Retrying ${res.changes} failed job(s) with temporary errors`);
      }
      return res.changes || 0;
    } catch (e) {
      logger.error('[DB] retryFailedJobs error:', e.message);
      return 0;
    }
  }

  async getJobsWithErrors(limit = 10) {
    const sql = `
      SELECT id, status, error_message, attempt, updated_at, created_at
      FROM jobs
      WHERE status = 'error'
      ORDER BY updated_at DESC
      LIMIT $1
    `;
    try {
      return await database.all(sql, [limit]);
    } catch (e) {
      logger.error('[DB] getJobsWithErrors error:', e.message);
      return [];
    }
  }

  async manualRetryJob(jobId) {
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL,
          error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'error'
      RETURNING id
    `;
    try {
      const result = await database.get(sql, [jobId]);
      if (result) {
        logger.info(`🔧 Manual retry initiated for job ${jobId}`);
        return true;
      }
      return false;
    } catch (e) {
      logger.error('[DB] manualRetryJob error:', e.message);
      return false;
    }
  }

  async claimNextJob(workerId) {
    const sql = `
      WITH lock AS (
        SELECT pg_try_advisory_xact_lock(42424242) AS ok
      ), next AS (
        SELECT id, prompt, user_id
        FROM jobs
        WHERE status IN ('queued','retrying')
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs j
      SET status = 'processing',
          locked_by = $1,
          locked_at = NOW(),
          lease_until = NOW() + INTERVAL '30 minutes',
          attempt = COALESCE(attempt,0) + 1,
          updated_at = CURRENT_TIMESTAMP
      FROM lock, next
      WHERE j.id = next.id AND lock.ok
      RETURNING j.id, next.prompt, next.user_id
    `;
    try {
      const row = await database.get(sql, [workerId]);
      if (row?.id) {
        logger.info(`[QUEUE/DB] Claimed job ${row.id} by ${workerId}`);
        return row;
      }
      return null;
    } catch (e) {
      logger.error('[DB] claimNextJob error:', e.message);
      return null;
    }
  }

  async lockJob(jobId, workerId) {
    const sql = `
      UPDATE jobs
      SET status = 'processing', locked_by = $2, locked_at = NOW(), lease_until = NOW() + INTERVAL '30 minutes',
          attempt = COALESCE(attempt,0) + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND (locked_by IS NULL OR lease_until IS NULL OR lease_until < NOW())
      RETURNING id
    `;
    try {
      const row = await database.get(sql, [jobId, workerId]);
      return !!row?.id;
    } catch (e) {
      logger.error('[DB] lockJob error:', e.message);
      return false;
    }
  }

  async heartbeatJob(jobId, workerId) {
    const sql = `
      UPDATE jobs
      SET heartbeat_at = NOW(), lease_until = NOW() + INTERVAL '30 minutes'
      WHERE id = $1 AND locked_by = $2
    `;
    try {
      await database.run(sql, [jobId, workerId]);
    } catch (e) {
      logger.debug('[DB] heartbeatJob error (non-fatal):', e.message);
    }
  }

  async clearJobLock(jobId) {
    const sql = `
      UPDATE jobs
      SET locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    try {
      await database.run(sql, [jobId]);
    } catch (e) {
      logger.error('[DB] clearJobLock error:', e.message);
    }
  }

  async requeueJob(jobId, { resetLinks = false } = {}) {
    const sql = `
      UPDATE jobs
      SET status = 'retrying', locked_by = NULL, locked_at = NULL, lease_until = NULL, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `;
    const row = await database.get(sql, [jobId]);
    if (!row) return false;
    if (resetLinks) {
      try {
        await database.run(
          `UPDATE job_links SET status = 'pending', processed_at = NULL WHERE job_id = $1 AND status NOT IN ('pending','processed')`,
          [jobId]
        );
      } catch (e) {
        logger.warn('[DB] requeueJob: resetLinks error:', e.message);
      }
    }
    logger.info(`[QUEUE/DB] Requeued job ${jobId}`);
    return true;
  }
}

export default new QueueService();
