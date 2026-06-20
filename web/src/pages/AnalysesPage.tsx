import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { clear as clearSelection, intersect, isAllSelected, selectAll, toggle } from '../lib/selection';
import { formatDateShort, formatStatus, statusLabels } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { SkeletonList } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { mergeJobUpdate } from '../lib/jobUpdate';
import { ACTIVE_STATUS_KEYS } from '../lib/overviewStats';
import type { JobSummary } from '../types/api';

const PAGE_SIZE = 20;

const DEFAULT_SORT = 'created_at_desc';
const SORT_KEYS = [
  'created_at_desc',
  'created_at_asc',
  'updated_at_desc',
  'title_asc',
  'title_desc',
  'status_asc',
] as const;

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
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle(t('analyses.title'));
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || '');
  const [sortBy, setSortBy] = useState(DEFAULT_SORT);
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
  // Holds the message + confirmed action for the styled confirm dialog that
  // replaces the blocking window.confirm(). Null when no dialog is open.
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  // Guard so the URL hydration runs exactly once on mount. Without it, the
  // write-back effect below (setSearchParams -> re-render) would re-hydrate and
  // fight the user's current filter/sort/search/page state.
  const hydratedRef = useRef(false);
  // Skips the write-back effect's first invocation. On mount the hydrate effect
  // schedules state updates that haven't applied yet to the current render, so
  // an immediate write-back would build the URL from stale pre-hydration state
  // and clobber the very params we just hydrated. We let the next render (which
  // sees the hydrated state) own the first write.
  const skipFirstSyncRef = useRef(true);

  // Build the canonical, defaults-omitted query string for the current filters.
  // Used both by the write-back effect and to skip the first redundant write.
  const buildParamString = useCallback(() => {
    const next = new URLSearchParams();
    if (statusFilter) next.set('status', statusFilter);
    if (search) next.set('search', search);
    if (sortBy && sortBy !== DEFAULT_SORT) next.set('sort', sortBy);
    if (page > 1) next.set('page', String(page));
    return next.toString();
  }, [statusFilter, search, sortBy, page]);

  // Hydrate all filter state from the URL once on mount (covers reload,
  // shareable links, and the dashboard's ?status= deep-link). Validates page
  // and sort; status passes through (the API tolerates unknown values).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const urlSearch = searchParams.get('search') || '';
    if (urlSearch) {
      setSearch(urlSearch);
      setSearchInput(urlSearch);
    }
    const urlSort = searchParams.get('sort') || '';
    if ((SORT_KEYS as readonly string[]).includes(urlSort)) {
      setSortBy(urlSort);
    }
    const urlPage = Number.parseInt(searchParams.get('page') || '', 10);
    if (Number.isInteger(urlPage) && urlPage > 0) {
      setPage(urlPage);
    }
    // statusFilter is already initialized from the URL via useState.
  }, [searchParams]);

  // Write the non-default filter subset back to the URL so filters/sort/search/
  // page survive reload and are shareable. `replace: true` keeps per-keystroke
  // changes out of history. The "only write when different from the current
  // search string" guard prevents the setSearchParams -> re-render -> effect
  // loop: after the first write the recomputed string matches and we skip.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (skipFirstSyncRef.current) {
      skipFirstSyncRef.current = false;
      return;
    }
    const nextString = buildParamString();
    const current = searchParams.toString();
    if (nextString === current) return;
    setSearchParams(new URLSearchParams(nextString), { replace: true });
  }, [statusFilter, search, sortBy, page, buildParamString, searchParams, setSearchParams]);

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
          sort: sortBy || undefined,
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
  }, [accessToken, activeWorkspaceId, page, search, statusFilter, sortBy, t]);

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
    const activeStatuses: readonly string[] = ACTIVE_STATUS_KEYS;
    const hasActive = jobs.some((job) => activeStatuses.includes(job.status));
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
    setSortBy('created_at_desc');
    setPage(1);
  };

  const performDelete = async (jobId: string) => {
    if (!accessToken) return;
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

  const handleDelete = (event: MouseEvent, jobId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!accessToken) return;
    setPendingConfirm({
      message: t('analyses.deleteConfirm'),
      onConfirm: () => {
        setPendingConfirm(null);
        void performDelete(jobId);
      },
    });
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

  const performBulkDelete = async (ids: string[]) => {
    if (!accessToken) return;
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

  const handleBulkDelete = () => {
    if (!accessToken) return;
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    setPendingConfirm({
      message: t('analyses.bulkDeleteConfirm', { count: ids.length }),
      onConfirm: () => {
        setPendingConfirm(null);
        void performBulkDelete(ids);
      },
    });
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
              aria-label={t('common.search')}
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
        <label className="field">
          <span>{t('analyses.sortLabel')}</span>
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value);
              setPage(1);
            }}
          >
            <option value="created_at_desc">{t('analyses.sortNewest')}</option>
            <option value="created_at_asc">{t('analyses.sortOldest')}</option>
            <option value="updated_at_desc">{t('analyses.sortUpdated')}</option>
            <option value="title_asc">{t('analyses.sortTitleAsc')}</option>
            <option value="title_desc">{t('analyses.sortTitleDesc')}</option>
            <option value="status_asc">{t('analyses.sortStatus')}</option>
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
              className={`card card--row${selected.has(job.id) ? ' card--selected' : ''}`}
            >
              <div className="card__header">
                <div className="card__heading">
                  <input
                    type="checkbox"
                    className="card__select"
                    aria-label={t('analyses.selectOne')}
                    checked={selected.has(job.id)}
                    onChange={(event) => handleToggleOne(event, job.id)}
                  />
                  <div>
                    <div className="card__title">
                      <Link to={`/analyses/${job.id}`} className="card__title-link">
                        {job.title || t('analyses.untitled')}
                      </Link>
                    </div>
                    <div className="card__meta">
                      {formatDateShort(job.created_at, dateLocale)} •{' '}
                      {formatStatus(job.status, statusLabels(t))}
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

      <ConfirmDialog
        open={!!pendingConfirm}
        message={pendingConfirm?.message ?? ''}
        confirmLabel={t('common.remove')}
        danger
        onConfirm={() => pendingConfirm?.onConfirm()}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
