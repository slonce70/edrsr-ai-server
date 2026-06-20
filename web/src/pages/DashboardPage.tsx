import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { computeJobStats, type JobStats } from '../lib/dashboardStats';
import { formatDateShort } from '../lib/format';
import {
  ACTIVE_STATUS_KEYS,
  activeCount,
  statusSegments,
  type StatusSegmentKey,
} from '../lib/overviewStats';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import type { Overview, OverviewRecent } from '../types/api';

type OverviewResponse = {
  success: boolean;
  overview: Overview;
};

const EMPTY_OVERVIEW: Overview = {
  total: 0,
  statusCounts: {},
  thisWeek: 0,
  today: 0,
  byMatter: [],
  recent: [],
};

const SEGMENT_LABEL_KEYS: Record<StatusSegmentKey, string> = {
  completed: 'dashboard.statCompleted',
  active: 'dashboard.statActive',
  error: 'dashboard.statErrors',
  other: 'dashboard.statOther',
};

export function DashboardPage() {
  const { accessToken } = useAuth();
  const { t, dateLocale } = useLocale();
  const { error: toastError } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  useDocumentTitle(t('dashboard.title'));
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const workspaceId = activeWorkspaceId || undefined;
      const res = await apiRequest<OverviewResponse>('/overview', {
        token: accessToken,
        workspaceId,
      });
      setOverview(res.overview || EMPTY_OVERVIEW);
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

  const stats = useMemo<JobStats>(() => {
    const counts = overview.statusCounts;
    return computeJobStats({
      total: overview.total,
      completed: counts.completed || 0,
      error: (counts.error || 0) + (counts.failed || 0) + (counts.cancelled || 0),
    });
  }, [overview]);

  const segments = useMemo(
    () => statusSegments(overview.statusCounts, overview.total),
    [overview]
  );

  const activeStatusSet: readonly string[] = ACTIVE_STATUS_KEYS;
  const hasActive =
    activeCount(overview.statusCounts) > 0 ||
    overview.recent.some((job) => activeStatusSet.includes(job.status));

  useEffect(() => {
    if (!hasActive) return undefined;
    const interval = window.setInterval(() => {
      fetchOverview();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [fetchOverview, hasActive]);

  const statCards = [
    { label: t('dashboard.statTotal'), value: stats.total, to: '/analyses' },
    {
      label: t('dashboard.statCompleted'),
      value: stats.completed,
      to: '/analyses?status=completed',
    },
    { label: t('dashboard.statActive'), value: stats.active, to: '/analyses' },
    { label: t('dashboard.statErrors'), value: stats.error, to: '/analyses?status=error' },
  ];

  const distributionSummary = segments
    .map((segment) => `${t(SEGMENT_LABEL_KEYS[segment.key])}: ${segment.count}`)
    .join(', ');

  const recent: OverviewRecent[] = overview.recent;

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
              <Link key={card.label} to={card.to} className="card stat-card stat-card--link">
                <div className="stat-card__value">{card.value}</div>
                <div className="stat-card__label">{card.label}</div>
              </Link>
            ))}
          </div>

          <div className="dashboard-meta">
            <span className="dashboard-meta__item">
              {t('dashboard.thisWeek')}: <strong>{overview.thisWeek}</strong>
            </span>
            <span className="dashboard-meta__item">
              {t('dashboard.today')}: <strong>{overview.today}</strong>
            </span>
          </div>

          {overview.total > 0 && segments.length > 0 ? (
            <div className="card">
              <div className="card__header">
                <div className="card__title">{t('dashboard.distribution')}</div>
              </div>
              <div
                className="status-bar"
                role="img"
                aria-label={`${t('dashboard.distribution')}: ${distributionSummary}`}
              >
                {segments.map((segment) => (
                  <div
                    key={segment.key}
                    className={`status-bar__seg status-bar__seg--${segment.key}`}
                    style={{ width: `${segment.pct}%` }}
                  />
                ))}
              </div>
              <ul className="status-bar__legend" aria-hidden="true">
                {segments.map((segment) => (
                  <li key={segment.key} className="status-bar__legend-item">
                    <span
                      className={`status-bar__dot status-bar__dot--${segment.key}`}
                    />
                    {t(SEGMENT_LABEL_KEYS[segment.key])}
                    <strong>{segment.count}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
