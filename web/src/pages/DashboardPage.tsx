import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { computeJobStats, type JobStats } from '../lib/dashboardStats';
import { formatDateShort } from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import type { JobSummary } from '../types/api';

type JobsResponse = {
  success: boolean;
  jobs: JobSummary[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
};

const ACTIVE_STATUSES = [
  'queued',
  'retrying',
  'processing',
  'downloading',
  'analyzing',
  'pending',
];

const ZERO_STATS: JobStats = { total: 0, completed: 0, error: 0, active: 0 };

export function DashboardPage() {
  const { accessToken } = useAuth();
  const { t, dateLocale } = useLocale();
  const { error: toastError } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [stats, setStats] = useState<JobStats>(ZERO_STATS);
  const [recent, setRecent] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const workspaceId = activeWorkspaceId || undefined;
      const [totalRes, completedRes, errorRes, recentRes] = await Promise.all([
        apiRequest<JobsResponse>('/jobs', {
          token: accessToken,
          workspaceId,
          query: { limit: 1 },
        }),
        apiRequest<JobsResponse>('/jobs', {
          token: accessToken,
          workspaceId,
          query: { limit: 1, status: 'completed' },
        }),
        apiRequest<JobsResponse>('/jobs', {
          token: accessToken,
          workspaceId,
          query: { limit: 1, status: 'error' },
        }),
        apiRequest<JobsResponse>('/jobs', {
          token: accessToken,
          workspaceId,
          query: { limit: 5 },
        }),
      ]);
      setStats(
        computeJobStats({
          total: totalRes.pagination?.total || 0,
          completed: completedRes.pagination?.total || 0,
          error: errorRes.pagination?.total || 0,
        })
      );
      setRecent(recentRes.jobs || []);
      setLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeWorkspaceId, t, toastError]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    const hasActive =
      stats.active > 0 || recent.some((job) => ACTIVE_STATUSES.includes(job.status));
    if (!hasActive) return undefined;
    const interval = window.setInterval(() => {
      fetchOverview();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [fetchOverview, recent, stats.active]);

  const statCards = [
    { label: t('dashboard.statTotal'), value: stats.total },
    { label: t('dashboard.statCompleted'), value: stats.completed },
    { label: t('dashboard.statActive'), value: stats.active },
    { label: t('dashboard.statErrors'), value: stats.error },
  ];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.subtitle')}</p>
        </div>
        <div className="page-header__actions">
          <Link className="btn btn-primary" to="/create">
            {t('analyses.new')}
          </Link>
        </div>
      </div>

      {loading && !loaded ? (
        <div className="stack" aria-busy="true">
          <span className="sr-only">{t('common.loading')}</span>
          <div className="stats-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="card stat-card" aria-hidden="true">
                <Skeleton width="40%" height="1.8rem" />
                <Skeleton width="60%" height="0.75rem" />
              </div>
            ))}
          </div>
          <SkeletonList count={3} />
        </div>
      ) : error ? (
        <div className="card card--error">{error}</div>
      ) : stats.total === 0 ? (
        <EmptyState
          title={t('dashboard.emptyTitle')}
          message={t('dashboard.emptyMessage')}
          action={
            <Link className="btn btn-primary" to="/create">
              {t('analyses.create')}
            </Link>
          }
        />
      ) : (
        <>
          <div className="stats-grid">
            {statCards.map((card) => (
              <div key={card.label} className="card stat-card">
                <div className="stat-card__value">{card.value}</div>
                <div className="stat-card__label">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card__header">
              <div className="card__title">{t('dashboard.recent')}</div>
              <Link className="link" to="/analyses">
                {t('dashboard.viewAll')}
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="card__meta">{t('dashboard.emptyMessage')}</div>
            ) : (
              <div className="list">
                {recent.map((job) => (
                  <div
                    key={job.id}
                    className="card card--link"
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/analyses/${job.id}`)}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/analyses/${job.id}`);
                      }
                    }}
                  >
                    <div className="card__header">
                      <div>
                        <div className="card__title">{job.title || t('analyses.untitled')}</div>
                        <div className="card__meta">
                          {formatDateShort(job.created_at, dateLocale)}
                        </div>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="card__body">
                      <ProgressBar value={job.progress} />
                      <div className="card__meta">
                        {t('analyses.linksProcessed', {
                          processed:
                            typeof job.processed_links === 'number' ? job.processed_links : 0,
                          total: typeof job.total_links === 'number' ? job.total_links : 0,
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
