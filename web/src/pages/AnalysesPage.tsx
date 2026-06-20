import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { clear as clearSelection, intersect, isAllSelected, selectAll, toggle } from '../lib/selection';
import { formatDateShort, formatStatus } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { SkeletonList } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { mergeJobUpdate } from '../lib/jobUpdate';
import type { JobSummary } from '../types/api';

const PAGE_SIZE = 20;

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
  const { success, error: toastError } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useDocumentTitle(t('analyses.title'));
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Selection model: per current page only. Stored ids are pruned to the
  // visible jobs whenever the page/filter/search/refetch changes, so a
  // selection never silently spans pages the user can't see.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [total]);

  const visibleIds = useMemo(() => jobs.map((job) => job.id), [jobs]);
  const allSelected = isAllSelected(selected, visibleIds);
  const someSelected = selected.size > 0 && !allSelected;

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
    jobs.forEach((job) => subscribe(job.id, activeWorkspaceId));
  }, [activeWorkspaceId, jobs, subscribe]);

  useEffect(() => {
    return onJobUpdate((payload) => {
      if (!payload?.id || payload.type === 'CHAT_UPDATE') return;
      setJobs((prev) =>
        prev.map((job) =>
          job.id === payload.id ? mergeJobUpdate(job, payload as Record<string, unknown>) : job
        )
      );
    });
  }, [onJobUpdate]);

  useEffect(() => {
    const hasActive = jobs.some((job) =>
      ['queued', 'retrying', 'processing', 'downloading', 'analyzing', 'pending'].includes(
        job.status
      )
    );
    if (!hasActive) return undefined;
    const interval = window.setInterval(() => {
      fetchJobs();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [fetchJobs, jobs]);

  // Prune stale ids whenever the visible jobs change (page/filter/search/refetch)
  // so selection stays scoped to the current page.
  useEffect(() => {
    setSelected((prev) => {
      const pruned = intersect(prev, jobs.map((job) => job.id));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [jobs]);

  // Reflect the tri-state of the "select all on page" checkbox.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

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

  const handleDelete = async (event: MouseEvent, jobId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!accessToken) return;
    if (!window.confirm(t('analyses.deleteConfirm'))) return;
    setDeletingId(jobId);
    setError(null);
    try {
      await apiRequest(`/jobs/${jobId}`, {
        token: accessToken,
        method: 'DELETE',
        workspaceId: activeWorkspaceId || undefined,
      });
      if (jobs.length === 1 && page > 1) {
        setPage((prev) => Math.max(1, prev - 1));
      } else {
        await fetchJobs();
      }
      success(t('analyses.deleted'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
      toastError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleOne = (event: ChangeEvent<HTMLInputElement>, jobId: string) => {
    event.stopPropagation();
    setSelected((prev) => toggle(prev, jobId));
  };

  const handleToggleAll = () => {
    setSelected((prev) => (isAllSelected(prev, visibleIds) ? clearSelection() : selectAll(prev, visibleIds)));
  };

  const handleClearSelection = () => {
    setSelected(clearSelection());
  };

  const handleBulkDelete = async () => {
    if (!accessToken) return;
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    if (!window.confirm(t('analyses.bulkDeleteConfirm', { count: ids.length }))) return;
    setBulkDeleting(true);
    setError(null);
    let ok = 0;
    let failed = 0;
    // Sequential deletes keep load on the API bounded and predictable.
    for (const id of ids) {
      try {
        await apiRequest(`/jobs/${id}`, {
          token: accessToken,
          method: 'DELETE',
          workspaceId: activeWorkspaceId || undefined,
        });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setSelected(clearSelection());
    await fetchJobs();
    setBulkDeleting(false);
    if (failed === 0) {
      success(t('analyses.bulkDeleted', { count: ok }));
    } else {
      toastError(t('analyses.bulkDeletePartial', { ok, failed }));
    }
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
            <option value="retrying">{t('status.retrying')}</option>
            <option value="processing">{t('status.processing')}</option>
            <option value="downloading">{t('status.downloading')}</option>
            <option value="analyzing">{t('status.analyzing')}</option>
            <option value="completed">{t('status.completed')}</option>
            <option value="error">{t('status.error')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
            <option value="pending">{t('status.pending')}</option>
          </select>
        </label>
        <button className="btn btn-ghost" onClick={resetFilters}>
          {t('common.reset')}
        </button>
        {jobs.length > 0 ? (
          <label className="select-all">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={handleToggleAll}
            />
            <span>{t('analyses.selectAll')}</span>
          </label>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className="bulk-bar" role="region" aria-label={t('analyses.selectedCount', { count: selected.size })}>
          <span className="bulk-bar__count">
            {t('analyses.selectedCount', { count: selected.size })}
          </span>
          <div className="bulk-bar__actions">
            <button
              className="btn btn-ghost"
              onClick={handleClearSelection}
              disabled={bulkDeleting}
            >
              {t('analyses.clearSelection')}
            </button>
            <button
              className="btn btn-danger"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {t('analyses.bulkDelete')}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="stack" aria-busy="true">
          <span className="sr-only">{t('analyses.loading')}</span>
          <SkeletonList count={5} />
        </div>
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
            <div
              key={job.id}
              className={`card card--link${selected.has(job.id) ? ' card--selected' : ''}`}
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
                <div className="card__heading">
                  <input
                    type="checkbox"
                    className="card__select"
                    aria-label={t('analyses.selectOne')}
                    checked={selected.has(job.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => handleToggleOne(event, job.id)}
                  />
                  <div>
                    <div className="card__title">{job.title || t('analyses.untitled')}</div>
                    <div className="card__meta">
                      {formatDateShort(job.created_at, dateLocale)} •{' '}
                      {formatStatus(job.status, {
                        queued: t('status.queued'),
                        retrying: t('status.retrying'),
                        processing: t('status.processing'),
                        downloading: t('status.downloading'),
                        analyzing: t('status.analyzing'),
                        completed: t('status.completed'),
                        error: t('status.error'),
                        failed: t('status.failed'),
                        cancelled: t('status.cancelled'),
                        pending: t('status.pending'),
                        unknown: t('status.unknown'),
                      })}
                    </div>
                  </div>
                </div>
                <div className="card__actions">
                  <StatusBadge status={job.status} />
                  <button
                    className="btn btn-ghost btn-danger"
                    onClick={(event) => handleDelete(event, job.id)}
                    disabled={deletingId === job.id}
                  >
                    {t('common.remove')}
                  </button>
                </div>
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
            </div>
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
