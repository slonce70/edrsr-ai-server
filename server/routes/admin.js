import express from 'express';
import { createClient } from '@supabase/supabase-js';
import database from '../database/connection.js';
import { attachUser } from '../middleware/auth.js';
import {
  requireAdmin,
  logAdminAction,
  grantAdminRole,
  revokeAdminRole,
} from '../middleware/adminAuth.js';
import {
  adminRouteRateLimit,
  securityHeaders,
  logSuspiciousActivity,
  getSecurityStats,
} from '../middleware/security.js';
import { logger } from '../utils.js';
import dbService from '../services/dbService.js';

const router = express.Router();

// Dashboard cache (60 seconds TTL to reduce DB load)
let dashboardCache = null;
let dashboardCacheTime = 0;
const DASHBOARD_CACHE_TTL = 60 * 1000; // 60 seconds

// Применяем безопасность и авторизацию ко всем админским routes
router.use(securityHeaders);
router.use(logSuspiciousActivity);
router.use(adminRouteRateLimit);
router.use(attachUser);
router.use(requireAdmin);

// Supabase client для управления пользователями
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseAdmin;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ---- Admin helpers (email cache, super-admin) ----
const EMAIL_CACHE_MAX = parseInt(process.env.ADMIN_EMAIL_CACHE_MAX || '1000', 10);
const emailCache = new Map(); // userId -> { email, ts }
const EMAIL_LOOKUP_MAX_PAGES = parseInt(process.env.ADMIN_EMAIL_LOOKUP_MAX_PAGES || '5', 10);
const EMAIL_LOOKUP_PER_PAGE = parseInt(process.env.ADMIN_EMAIL_LOOKUP_PER_PAGE || '200', 10);

const SUPER_ADMIN_USER_IDS = new Set(
  (process.env.SUPER_ADMIN_USER_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

function isSuperAdmin(user) {
  if (!user) return false;
  if (SUPER_ADMIN_USER_IDS.size > 0 && SUPER_ADMIN_USER_IDS.has(user.id)) return true;
  if (user.email && SUPER_ADMIN_EMAILS.has(String(user.email).toLowerCase())) return true;
  return false;
}

function getCachedEmail(userId) {
  if (!userId) return null;
  const cached = emailCache.get(userId);
  if (!cached) return null;
  // refresh LRU position
  emailCache.delete(userId);
  emailCache.set(userId, cached);
  return cached.email;
}

function setCachedEmail(userId, email) {
  if (!userId || !email) return;
  if (emailCache.has(userId)) emailCache.delete(userId);
  emailCache.set(userId, { email, ts: Date.now() });
  if (emailCache.size > EMAIL_CACHE_MAX) {
    const oldestKey = emailCache.keys().next().value;
    if (oldestKey) emailCache.delete(oldestKey);
  }
}

async function upsertAppUserEmail(userId, email) {
  if (!userId || !email) return;
  const emailLower = String(email).toLowerCase();
  try {
    await database.run(
      `INSERT INTO app_users (user_id, email, email_lower, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, NULL, NULL)
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         email_lower = EXCLUDED.email_lower`,
      [userId, email, emailLower]
    );
  } catch (e) {
    logger.warn('Could not upsert app_users email cache:', e.message);
  }
}

async function backfillUserEmail(userId) {
  if (!supabaseAdmin || !userId) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) return null;
    const email = data?.user?.email || null;
    if (email) {
      setCachedEmail(userId, email);
      await upsertAppUserEmail(userId, email);
      return email;
    }
  } catch (e) {
    logger.warn('Could not backfill user email:', e.message);
  }
  return null;
}

async function ensureEmailCached(emailLower) {
  if (!supabaseAdmin || !emailLower || !emailLower.includes('@')) return;
  try {
    const existing = await database.get('SELECT user_id FROM app_users WHERE email_lower = $1', [
      emailLower,
    ]);
    if (existing?.user_id) return;

    for (let page = 1; page <= EMAIL_LOOKUP_MAX_PAGES; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: EMAIL_LOOKUP_PER_PAGE,
      });
      if (error || !data?.users) break;

      const found = data.users.find((u) => u.email && String(u.email).toLowerCase() === emailLower);
      if (found) {
        await upsertAppUserEmail(found.id, found.email);
        setCachedEmail(found.id, found.email);
        break;
      }

      if (data.users.length < EMAIL_LOOKUP_PER_PAGE) break;
    }
  } catch (e) {
    logger.warn('Email lookup fallback failed:', e.message);
  }
}

// =====================
// ДАШБОРД
// =====================

router.get('/dashboard', async (req, res) => {
  try {
    const now = Date.now();

    // Return cached data if valid (reduces DB load significantly)
    if (dashboardCache && now - dashboardCacheTime < DASHBOARD_CACHE_TTL) {
      await logAdminAction(req.user.id, 'VIEW_DASHBOARD', null, null, { cached: true }, req);
      return res.json({
        success: true,
        data: { ...dashboardCache, is_super_admin: isSuperAdmin(req.user) },
      });
    }

    // Основная статистика
    const stats = await database.all(`
      SELECT 
        (SELECT COUNT(*) FROM jobs) as total_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as completed_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'error') as failed_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'error' AND COALESCE(attempt, 0) < 3) as retryable_jobs,
        (SELECT COUNT(*)
         FROM jobs
         WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Kiev') AT TIME ZONE 'Europe/Kiev') as jobs_today,
        (SELECT COUNT(*) FROM job_links) as total_links_processed,
        (SELECT ROUND(AVG(duration)) FROM jobs WHERE status = 'completed' AND duration IS NOT NULL) as avg_job_duration,
        (SELECT COUNT(*) FROM chat_messages) as total_chat_messages,
        (SELECT COUNT(*) FROM parsed_cases) as cached_cases
    `);

    // Статистика пользователей
    const userStats = { total_users: 0, new_users_30d: 0, active_users_30d: 0, admin_count: 0 };
    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        if (!error) {
          userStats.total_users = data.total || data.users?.length || 0;
        }
      } catch (error) {
        logger.warn('Could not fetch total users from Supabase:', error.message);
      }
    }

    // Локальні метрики за останні 30 днів (активні/нові у нашому застосунку)
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const localStats = await database.get(
        `SELECT
           SUM(CASE WHEN first_seen_at >= $1 THEN 1 ELSE 0 END)::int AS new_users_30d,
           SUM(CASE WHEN last_seen_at >= $1 THEN 1 ELSE 0 END)::int AS active_users_30d
         FROM app_users`,
        [thirtyDaysAgo]
      );
      userStats.new_users_30d = localStats?.new_users_30d || 0;
      userStats.active_users_30d = localStats?.active_users_30d || 0;
    } catch (error) {
      logger.warn('Could not fetch local user activity stats:', error.message);
    }

    const adminCount = await database.get(
      'SELECT COUNT(*) as count FROM user_roles WHERE role = $1',
      ['admin']
    );
    userStats.admin_count = adminCount?.count || 0;

    // Последняя активность
    const lastActivity = await database.get(`
      SELECT 
        (SELECT MAX(created_at) FROM jobs) as last_job_created,
        (SELECT MAX(updated_at) FROM jobs) as last_job_updated
    `);

    // Активные воркеры (из существующей системы)
    const systemStats = {
      memory_usage: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptime_hours: Math.round((process.uptime() / 3600) * 10) / 10,
    };

    const dashboardData = {
      ...stats[0],
      ...userStats,
      ...lastActivity,
      ...systemStats,
    };

    // Update cache
    dashboardCache = dashboardData;
    dashboardCacheTime = Date.now();

    await logAdminAction(req.user.id, 'VIEW_DASHBOARD', null, null, { cached: false }, req);
    res.json({
      success: true,
      data: { ...dashboardData, is_super_admin: isSuperAdmin(req.user) },
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).json({ error: 'Ошибка загрузки дашборда' });
  }
});

// =====================
// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
// =====================

router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;

    let users = [];
    let totalUsers = 0;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page: parseInt(page),
        perPage: parseInt(limit),
      });

      if (error) {
        throw error;
      }

      users = data.users.map((user) => ({
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        email_confirmed_at: user.email_confirmed_at,
      }));

      totalUsers = data.total || users.length;

      // Cache user emails locally for admin filtering
      for (const user of users) {
        if (user?.id && user?.email) {
          setCachedEmail(user.id, user.email);
          await upsertAppUserEmail(user.id, user.email);
        }
      }

      // Фильтрация по поиску если нужно
      if (search) {
        users = users.filter((user) => user.email.toLowerCase().includes(search.toLowerCase()));
      }

      // Добавляем информацию о ролях
      for (const user of users) {
        const roles = await database.all(
          'SELECT role, granted_at FROM user_roles WHERE user_id = $1',
          [user.id]
        );
        user.roles = roles.map((r) => r.role);
        user.is_admin = roles.some((r) => r.role === 'admin');
      }
    }

    await logAdminAction(req.user.id, 'VIEW_USERS', null, null, { page, search }, req);
    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalUsers,
      },
    });
  } catch (error) {
    logger.error('Users list error:', error);
    res.status(500).json({ error: 'Ошибка загрузки пользователей' });
  }
});

router.post('/users/:userId/make-admin', async (req, res) => {
  try {
    const { userId } = req.params;

    const success = await grantAdminRole(userId, req.user.id);
    if (success) {
      res.json({ success: true, message: 'Права администратора предоставлены' });
    } else {
      res.status(500).json({ error: 'Ошибка предоставления прав' });
    }
  } catch (error) {
    logger.error('Grant admin error:', error);
    res.status(500).json({ error: 'Ошибка предоставления прав администратора' });
  }
});

router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Проверяем что админ не удаляет сам себя
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя' });
    }

    // Получаем информацию о пользователе для логирования
    let userEmail = 'unknown';
    if (supabaseAdmin) {
      try {
        const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
        userEmail = user?.user?.email || 'unknown';
      } catch (e) {
        logger.warn('Could not get user email for deletion log:', e.message);
      }
    }

    // Удаляем все данные пользователя из нашей базы
    await database.run('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await database.run('DELETE FROM jobs WHERE user_id = $1', [userId]);
    await database.run('DELETE FROM chat_messages WHERE user_id = $1', [userId]);
    await database.run('DELETE FROM parsed_cases WHERE user_id = $1', [userId]);
    await database.run('DELETE FROM user_prompts WHERE user_id = $1', [userId]);
    await database.run('DELETE FROM app_users WHERE user_id = $1', [userId]);

    // Удаляем пользователя из Supabase Auth
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (error) {
        logger.warn('Could not delete user from Supabase Auth:', error.message);
        // Продолжаем выполнение даже если удаление из Supabase не удалось
      }
    }

    await logAdminAction(
      req.user.id,
      'DELETE_USER',
      'user',
      userId,
      {
        user_email: userEmail,
      },
      req
    );

    res.json({ success: true, message: 'Пользователь удален' });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

// =====================
// ОЧЕРЕДЬ/ПЕРЕЗАПУСК ЗАДАНИЙ
// =====================

// Перезапускает задание: снимает блокировку и переводит в состояние retrying/queued
router.post('/jobs/:id/requeue', async (req, res) => {
  try {
    const { id } = req.params;
    const { reset_links = false } = req.body || {};

    const ok = await dbService.requeueJob(id, { resetLinks: !!reset_links });
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Задание не найдено' });
    }

    // Логируем админ-действие
    await logAdminAction(
      req.user.id,
      'REQUEUE_JOB',
      'job',
      id,
      { reset_links: !!reset_links },
      req
    );

    // Запускаем обработку очереди после requeue (внутренним событием)
    setTimeout(() => {
      try {
        process.emit('edrsr:queue:pump');
        logger.info(`[ADMIN_RETRY] Очередь запрошена после requeue задания ${id}`);
      } catch {
        // noop
      }
    }, 500);

    res.json({ success: true, message: `Задание ${id} поставлено в очередь на повтор` });
  } catch (error) {
    logger.error('Admin requeue error:', error);
    res.status(500).json({ success: false, error: 'Ошибка перезапуска задания' });
  }
});

router.delete('/users/:userId/admin-role', async (req, res) => {
  try {
    const { userId } = req.params;

    // Проверяем что админ не удаляет сам себя
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Нельзя отозвать права у самого себя' });
    }

    const success = await revokeAdminRole(userId, req.user.id);
    if (success) {
      res.json({ success: true, message: 'Права администратора отозваны' });
    } else {
      res.status(404).json({ error: 'Права не найдены или уже отозваны' });
    }
  } catch (error) {
    logger.error('Revoke admin error:', error);
    res.status(500).json({ error: 'Ошибка отзыва прав администратора' });
  }
});

// =====================
// УПРАВЛЕНИЕ ЗАДАНИЯМИ
// =====================

router.get('/jobs', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = '', search = '', email = '' } = req.query;
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      where.push(`j.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (search) {
      where.push(`(j.title ILIKE $${paramIndex} OR j.prompt ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (email) {
      const emailLower = String(email).trim().toLowerCase();
      if (emailLower) {
        await ensureEmailCached(emailLower);
        where.push(`au.email_lower ILIKE $${paramIndex}`);
        params.push(`%${emailLower}%`);
        paramIndex++;
      }
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const jobs = await database.all(
      `SELECT j.id, j.title, j.status, j.progress, j.total_links, j.processed_links, 
                j.created_at, j.updated_at, j.user_id, j.duration, j.error_message,
                au.email AS user_email
         FROM jobs j
         LEFT JOIN app_users au ON j.user_id = au.user_id
         ${whereClause}
         ORDER BY j.created_at DESC 
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Fill from cache and backfill missing emails (best-effort)
    if (Array.isArray(jobs) && jobs.length > 0) {
      const missingUserIds = new Set();
      for (const job of jobs) {
        if (!job.user_id) continue;
        const cached = getCachedEmail(job.user_id);
        if (cached) {
          job.user_email = cached;
        } else if (job.user_email) {
          setCachedEmail(job.user_id, job.user_email);
        } else {
          missingUserIds.add(job.user_id);
        }
      }

      if (supabaseAdmin && missingUserIds.size > 0) {
        for (const userId of missingUserIds) {
          const emailFromApi = await backfillUserEmail(userId);
          if (!emailFromApi) continue;
          for (const job of jobs) {
            if (job.user_id === userId) job.user_email = emailFromApi;
          }
        }
      }
    }

    const totalCount = await database.get(
      `SELECT COUNT(*) as count
         FROM jobs j
         LEFT JOIN app_users au ON j.user_id = au.user_id
         ${whereClause}`,
      params
    );

    await logAdminAction(
      req.user.id,
      'VIEW_ALL_JOBS',
      null,
      null,
      { page, status, search, email },
      req
    );
    res.json({
      success: true,
      jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
      },
    });
  } catch (error) {
    logger.error('Admin jobs list error:', error);
    res.status(500).json({ error: 'Ошибка загрузки заданий' });
  }
});

router.get('/jobs/:jobId/report', async (req, res) => {
  try {
    const { jobId } = req.params;

    // Получаем задание с анализом
    const job = await database.get('SELECT * FROM jobs WHERE id = $1', [jobId]);

    if (!job) {
      return res.status(404).json({ error: 'Задание не найдено' });
    }

    // Получаем результат анализа
    const analysis = await database.get('SELECT analysis_text FROM job_results WHERE job_id = $1', [
      jobId,
    ]);

    if (!analysis) {
      return res.status(404).json({ error: 'Отчет по заданию не найден' });
    }

    await logAdminAction(
      req.user.id,
      'VIEW_JOB_REPORT',
      'job',
      jobId,
      {
        job_title: job.title,
      },
      req
    );

    res.json({
      success: true,
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
        created_at: job.created_at,
        updated_at: job.updated_at,
        total_links: job.total_links,
        processed_links: job.processed_links,
      },
      analysis: analysis.analysis_text,
    });
  } catch (error) {
    logger.error('Get job report error:', error);
    res.status(500).json({ error: 'Ошибка получения отчета' });
  }
});

// Детальная информация по заданию (для админ-диагностики)
router.get('/jobs/:jobId/details', async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await database.get(
      `SELECT j.id, j.title, j.status, j.progress, j.total_links, j.processed_links,
              j.created_at, j.updated_at, j.duration, j.error_message, j.prompt,
              j.user_id, j.attempt, j.max_attempts, j.locked_by, j.locked_at,
              j.lease_until, j.heartbeat_at, au.email AS user_email
       FROM jobs j
       LEFT JOIN app_users au ON j.user_id = au.user_id
       WHERE j.id = $1`,
      [jobId]
    );

    if (!job) {
      return res.status(404).json({ error: 'Задание не найдено' });
    }

    // Легкая агрегация по статусам ссылок
    const linkStatsRows = await database.all(
      `SELECT status, COUNT(*) as count
       FROM job_links
       WHERE job_id = $1
       GROUP BY status`,
      [jobId]
    );
    const linkStats = linkStatsRows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count, 10) || 0;
      return acc;
    }, {});

    await logAdminAction(req.user.id, 'VIEW_JOB_DETAILS', 'job', jobId, {}, req);

    res.json({
      success: true,
      job,
      link_stats: linkStats,
    });
  } catch (error) {
    logger.error('Get job details error:', error);
    res.status(500).json({ error: 'Ошибка получения деталей задания' });
  }
});

router.put('/jobs/:jobId/title', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== 'string' || title.length > 255) {
      return res.status(400).json({ error: 'Неверный или отсутствующий заголовок' });
    }

    // Проверяем что задание существует
    const job = await database.get('SELECT title, user_id FROM jobs WHERE id = $1', [jobId]);

    if (!job) {
      return res.status(404).json({ error: 'Задание не найдено' });
    }

    // Обновляем название
    await database.run('UPDATE jobs SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
      title,
      jobId,
    ]);

    await logAdminAction(
      req.user.id,
      'UPDATE_JOB_TITLE',
      'job',
      jobId,
      {
        old_title: job.title,
        new_title: title,
        job_user_id: job.user_id,
      },
      req
    );

    res.json({ success: true, message: 'Название задания обновлено' });
  } catch (error) {
    logger.error('Update job title error:', error);
    res.status(500).json({ error: 'Ошибка обновления названия задания' });
  }
});

router.delete('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    // Получаем информацию о задании для логирования
    const job = await database.get('SELECT title, user_id FROM jobs WHERE id = $1', [jobId]);

    if (!job) {
      return res.status(404).json({ error: 'Задание не найдено' });
    }

    // Удаляем задание (каскадно удалятся связанные записи)
    await database.run('DELETE FROM jobs WHERE id = $1', [jobId]);

    await logAdminAction(
      req.user.id,
      'DELETE_JOB',
      'job',
      jobId,
      {
        job_title: job.title,
        job_user_id: job.user_id,
      },
      req
    );

    res.json({ success: true, message: 'Задание удалено' });
  } catch (error) {
    logger.error('Delete job error:', error);
    res.status(500).json({ error: 'Ошибка удаления задания' });
  }
});

// =====================
// УПРАВЛЕНИЕ ОШИБКАМИ
// =====================

// Получить список заданий с ошибками
router.get('/jobs/errors', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const errorJobs = await dbService.getJobsWithErrors(parseInt(limit));

    await logAdminAction(req.user.id, 'VIEW_ERROR_JOBS', 'system', 'N/A', { limit }, req);

    res.json({ success: true, jobs: errorJobs });
  } catch (error) {
    logger.error('Get error jobs error:', error);
    res.status(500).json({ error: 'Ошибка получения заданий с ошибками' });
  }
});

// Перезапустить задание с ошибкой
router.post('/jobs/:jobId/retry', async (req, res) => {
  try {
    const { jobId } = req.params;

    // Получаем информацию о задании
    const job = await database.get(
      'SELECT id, status, error_message, attempt FROM jobs WHERE id = $1',
      [jobId]
    );

    if (!job) {
      return res.status(404).json({ error: 'Задание не найдено' });
    }

    if (job.status !== 'error') {
      return res
        .status(400)
        .json({ error: `Задание не в статусе ошибки (текущий статус: ${job.status})` });
    }

    const success = await dbService.manualRetryJob(jobId);

    if (success) {
      await logAdminAction(
        req.user.id,
        'RETRY_JOB',
        'job',
        jobId,
        {
          old_status: job.status,
          error_message: job.error_message,
          attempt: job.attempt,
        },
        req
      );

      // ВАЖНО: Запускаем обработку очереди после retry!
      setTimeout(() => {
        try {
          process.emit('edrsr:queue:pump');
          logger.info(`[ADMIN_RETRY] Очередь запрошена после retry задания ${jobId}`);
        } catch {
          // noop
        }
      }, 500);

      res.json({ success: true, message: 'Задание поставлено на повторное выполнение' });
    } else {
      res.status(400).json({ error: 'Не удалось перезапустить задание' });
    }
  } catch (error) {
    logger.error('Retry job error:', error);
    res.status(500).json({ error: 'Ошибка перезапуска задания' });
  }
});

// Автоматическое восстановление заданий с временными ошибками
router.post('/jobs/retry-failed', async (req, res) => {
  try {
    const retriedCount = await dbService.retryFailedJobs();

    await logAdminAction(
      req.user.id,
      'RETRY_FAILED_JOBS',
      'system',
      'N/A',
      { retried_count: retriedCount },
      req
    );

    // Запускаем обработку очереди если есть восстановленные задания
    if (retriedCount > 0) {
      setTimeout(() => {
        try {
          process.emit('edrsr:queue:pump');
          logger.info(
            `[ADMIN_RETRY] Очередь запрошена после массового retry (${retriedCount} заданий)`
          );
        } catch {
          // noop
        }
      }, 500);
    }

    res.json({
      success: true,
      message: `Перезапущено ${retriedCount} заданий с временными ошибками`,
      retried_count: retriedCount,
    });
  } catch (error) {
    logger.error('Retry failed jobs error:', error);
    res.status(500).json({ error: 'Ошибка автоматического восстановления заданий' });
  }
});

// Ручное восстановление зависших заданий (без ожидания lease)
router.post('/jobs/recover-stuck', async (req, res) => {
  try {
    const { grace_minutes = 5 } = req.body || {};
    const minutes = Math.max(1, parseInt(grace_minutes, 10) || 5);

    const recovered = await dbService.recoverJobsWithStaleHeartbeat(minutes);

    await logAdminAction(
      req.user.id,
      'RECOVER_STUCK_JOBS',
      'system',
      'N/A',
      { recovered, grace_minutes: minutes },
      req
    );

    if (recovered > 0) {
      setTimeout(() => {
        try {
          process.emit('edrsr:queue:pump');
          logger.info(`[ADMIN_RETRY] Очередь запрошена после ручного recovery (${recovered})`);
        } catch {
          // noop
        }
      }, 300);
    }

    res.json({ success: true, recovered, grace_minutes: minutes });
  } catch (error) {
    logger.error('Recover stuck jobs error:', error);
    res.status(500).json({ error: 'Ошибка ручного восстановления' });
  }
});

// =====================
// СИСТЕМНЫЕ ОПЕРАЦИИ
// =====================

router.post('/system/cleanup', async (req, res) => {
  try {
    const { cleanupType = 'old_jobs' } = req.body;
    const result = { cleaned: 0 };

    switch (cleanupType) {
      case 'old_jobs': {
        // Удаляем задания старше 90 дней
        const oldJobs = await database.run(
          "DELETE FROM jobs WHERE created_at < now() - interval '90 days'"
        );
        result.cleaned = oldJobs.changes;
        break;
      }

      case 'failed_jobs': {
        // Удаляем проваленные задания старше 7 дней
        const failedJobs = await database.run(
          "DELETE FROM jobs WHERE status = 'error' AND updated_at < now() - interval '7 days'"
        );
        result.cleaned = failedJobs.changes;
        break;
      }

      case 'old_cache': {
        // Очищаем кеш, который не обновлялся 30+ дней
        const oldCache = await database.run(
          "DELETE FROM parsed_cases WHERE COALESCE(updated_at, created_at) < now() - interval '30 days'"
        );
        result.cleaned = oldCache.changes;
        break;
      }

      default: {
        return res.status(400).json({ error: 'Неизвестный тип очистки' });
      }
    }

    await logAdminAction(req.user.id, 'SYSTEM_CLEANUP', 'system', cleanupType, result, req);
    res.json({
      success: true,
      message: `Очистка выполнена. Удалено: ${result.cleaned}`,
      ...result,
    });
  } catch (error) {
    logger.error('System cleanup error:', error);
    res.status(500).json({ error: 'Ошибка выполнения очистки' });
  }
});

router.get('/system/stats', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const systemStats = {
      memory: {
        used: Math.round(memoryUsage.rss / 1024 / 1024),
        heap_used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heap_total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
      uptime: {
        seconds: Math.round(process.uptime()),
        formatted: formatUptime(process.uptime()),
      },
      node_version: process.version,
      platform: process.platform,
    };

    // Статистика базы данных
    const dbStats = await database.all(`
      SELECT 
        'jobs' as table_name,
        COUNT(*) as count 
      FROM jobs
      UNION ALL
      SELECT 
        'job_links' as table_name,
        COUNT(*) as count 
      FROM job_links
      UNION ALL
      SELECT 
        'parsed_cases' as table_name,
        COUNT(*) as count 
      FROM parsed_cases
    `);

    res.json({
      success: true,
      system: systemStats,
      database: dbStats,
    });
  } catch (error) {
    logger.error('System stats error:', error);
    res.status(500).json({ error: 'Ошибка получения статистики системы' });
  }
});

// =====================
// ОТЧЕТЫ И АУДИТ
// =====================

router.get('/audit-log', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const logs = await database.all(
      `
      SELECT l.id, l.user_id, l.action, l.target_type, l.target_id, l.details,
             l.ip_address, l.created_at, au.email AS user_email
      FROM admin_audit_log l
      LEFT JOIN app_users au ON l.user_id = au.user_id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `,
      [limit, offset]
    );

    // Backfill missing emails (best-effort) using cache + Supabase
    if (Array.isArray(logs) && logs.length > 0) {
      const missingUserIds = new Set();
      for (const log of logs) {
        if (!log.user_id) continue;
        const cached = getCachedEmail(log.user_id);
        if (cached) {
          log.user_email = cached;
        } else if (log.user_email) {
          setCachedEmail(log.user_id, log.user_email);
        } else {
          missingUserIds.add(log.user_id);
        }
      }

      if (supabaseAdmin && missingUserIds.size > 0) {
        for (const userId of missingUserIds) {
          const emailFromApi = await backfillUserEmail(userId);
          if (!emailFromApi) continue;
          for (const log of logs) {
            if (log.user_id === userId) log.user_email = emailFromApi;
          }
        }
      }
    }
    const totalCount = await database.get('SELECT COUNT(*) as count FROM admin_audit_log');

    res.json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
      },
    });
  } catch (error) {
    logger.error('Audit log error:', error);
    res.status(500).json({ error: 'Ошибка загрузки логов аудита' });
  }
});

// Вспомогательная функция для форматирования времени работы
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}д ${hours}ч ${minutes}м`;
  } else if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  } else {
    return `${minutes}м`;
  }
}

// =====================
// БЕЗОПАСНОСТЬ
// =====================

router.get('/security/stats', async (req, res) => {
  try {
    const stats = getSecurityStats();

    await logAdminAction(req.user.id, 'VIEW_SECURITY_STATS', 'system', 'N/A', {}, req);

    res.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    logger.error('Security stats error:', error);
    res.status(500).json({ error: 'Ошибка получения статистики безопасности' });
  }
});

// =====================
// GEMINI API СТАТИСТИКА
// =====================

router.get('/gemini/stats', async (req, res) => {
  try {
    // Імпортуємо apiKeyManager динамічно щоб уникнути циклічних залежностей
    const { apiKeyManager } = await import('../config.js');

    const stats = apiKeyManager.getStats();

    // Отримати кількість queued jobs для контексту
    let queuedJobs = 0;
    try {
      const result = await database.get(
        `SELECT COUNT(*) as count FROM jobs WHERE status IN ('queued', 'retrying')`
      );
      queuedJobs = result?.count || 0;
    } catch (dbErr) {
      logger.warn('Could not get queued jobs count:', dbErr.message);
    }

    // Додаткова статистика
    const enhancedStats = {
      ...stats,
      queuedJobs,
      timestamp: new Date().toISOString(),
      summary: {
        totalRequests: stats.usage.reduce((sum, u) => sum + u.requests, 0),
        totalErrors: stats.usage.reduce((sum, u) => sum + u.errors, 0),
        totalRateLimits: stats.usage.reduce((sum, u) => sum + u.rateLimits, 0),
        keysOnCooldown: stats.cooldowns.length,
      },
    };

    await logAdminAction(req.user.id, 'VIEW_GEMINI_STATS', 'system', 'N/A', {}, req);

    res.json({
      success: true,
      data: enhancedStats,
      is_super_admin: isSuperAdmin(req.user),
    });
  } catch (error) {
    logger.error('Gemini stats error:', error);
    res.status(500).json({ error: 'Помилка отримання статистики Gemini API' });
  }
});

// Скинути статистику використання ключів
router.post('/gemini/reset-stats', async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }
    const { apiKeyManager } = await import('../config.js');

    // Скидаємо статистику
    for (let i = 0; i < apiKeyManager.usageStats.length; i++) {
      apiKeyManager.usageStats[i] = { requests: 0, errors: 0, rateLimits: 0 };
    }
    apiKeyManager.cooldowns.clear();

    await logAdminAction(req.user.id, 'RESET_GEMINI_STATS', 'system', 'N/A', {}, req);

    res.json({
      success: true,
      message: 'Статистику Gemini API скинуто',
    });
  } catch (error) {
    logger.error('Reset gemini stats error:', error);
    res.status(500).json({ error: 'Помилка скидання статистики' });
  }
});

export default router;
