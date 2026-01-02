import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDateShort, formatStatus } from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';

const PAGE_SIZE = 20;

type JobSummary = {
  id: string;
  title: string;
  status: string;
  progress: number;
  processed_links: number;
  total_links: number;
  created_at: string;
  updated_at: string;
  duration?: number | null;
};

type JobsResponse = {
  success: boolean;
  jobs: JobSummary[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
};

export function AnalysesPage() {
  const { accessToken } = useAuth();
  const { onJobUpdate, subscribe } = useWebSocket();
  const { t, dateLocale } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [total]);

  const fetchJobs = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<JobsResponse>('/jobs', {
        token: accessToken,
        workspaceId: activeWorkspaceId || undefined,
        query: {
          limit: PAGE_SIZE,
          page,
          status: statusFilter || undefined,
          search: search || undefined,
        },
      });
      setJobs(data.jobs || []);
      setTotal(data.pagination?.total || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeWorkspaceId, page, search, statusFilter, t]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    jobs.forEach((job) => subscribe(job.id));
  }, [jobs, subscribe]);

  useEffect(() => {
    return onJobUpdate((payload) => {
      if (!payload?.id || payload.type === 'CHAT_UPDATE') return;
      setJobs((prev) => prev.map((job) => (job.id === payload.id ? { ...job, ...payload } : job)));
    });
  }, [onJobUpdate]);

  useEffect(() => {
    const hasActive = jobs.some((job) =>
      ['queued', 'downloading', 'analyzing', 'pending'].includes(job.status)
    );
    if (!hasActive) return undefined;
    const interval = window.setInterval(() => {
      fetchJobs();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [fetchJobs, jobs]);

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatusFilter('');
    setPage(1);
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('analyses.title')}</h1>
          <p>{t('analyses.subtitle')}</p>
        </div>
        <Link className="btn btn-primary" to="/create">
          {t('analyses.new')}
        </Link>
      </div>

      <div className="filters">
        <div className="field">
          <span>{t('common.search')}</span>
          <div className="field__row">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSearch();
              }}
              placeholder={t('analyses.searchPlaceholder')}
            />
            <button className="btn btn-ghost" onClick={handleSearch}>
              {t('common.search')}
            </button>
          </div>
        </div>
        <label className="field">
          <span>{t('common.status')}</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            <option value="queued">{t('status.queued')}</option>
            <option value="downloading">{t('status.downloading')}</option>
            <option value="analyzing">{t('status.analyzing')}</option>
            <option value="completed">{t('status.completed')}</option>
            <option value="failed">{t('status.failed')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
            <option value="pending">{t('status.pending')}</option>
          </select>
        </label>
        <button className="btn btn-ghost" onClick={resetFilters}>
          {t('common.reset')}
        </button>
      </div>

      {loading ? (
        <div className="card">{t('analyses.loading')}</div>
      ) : error ? (
        <div className="card card--error">{error}</div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title={t('analyses.emptyTitle')}
          message={t('analyses.emptyMessage')}
          action={
            <Link className="btn btn-primary" to="/create">
              {t('analyses.create')}
            </Link>
          }
        />
      ) : (
        <div className="list">
          {jobs.map((job) => (
            <Link key={job.id} to={`/analyses/${job.id}`} className="card card--link">
              <div className="card__header">
                <div>
                  <div className="card__title">{job.title || t('analyses.untitled')}</div>
                  <div className="card__meta">
                    {formatDateShort(job.created_at, dateLocale)} •{' '}
                    {formatStatus(job.status, {
                      queued: t('status.queued'),
                      downloading: t('status.downloading'),
                      analyzing: t('status.analyzing'),
                      completed: t('status.completed'),
                      failed: t('status.failed'),
                      cancelled: t('status.cancelled'),
                      pending: t('status.pending'),
                      unknown: t('status.unknown'),
                    })}
                  </div>
                </div>
                <StatusBadge status={job.status} />
              </div>
              <div className="card__body">
                <ProgressBar value={job.progress} />
                <div className="card__meta">
                  {t('analyses.linksProcessed', {
                    processed: typeof job.processed_links === 'number' ? job.processed_links : 0,
                    total: typeof job.total_links === 'number' ? job.total_links : 0,
                  })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="pagination">
          <button
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            {t('pagination.prev')}
          </button>
          <div className="pagination__info">
            {t('pagination.pageOf', { page, total: totalPages })}
          </div>
          <button
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            {t('pagination.next')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
