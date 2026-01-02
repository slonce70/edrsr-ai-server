import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatCount, formatDateShort, formatStatus } from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useWebSocket } from '../state/WebSocketContext';
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
      const message = err instanceof Error ? err.message : 'Failed to load jobs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, search, statusFilter]);

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
          <h1>Analyses</h1>
          <p>Track your recent research runs and open the full report.</p>
        </div>
        <Link className="btn btn-primary" to="/create">
          New analysis
        </Link>
      </div>

      <div className="filters">
        <div className="field">
          <span>Search</span>
          <div className="field__row">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSearch();
              }}
              placeholder="Title or prompt"
            />
            <button className="btn btn-ghost" onClick={handleSearch}>
              Search
            </button>
          </div>
        </div>
        <label className="field">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="queued">Queued</option>
            <option value="downloading">Downloading</option>
            <option value="analyzing">Analyzing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <button className="btn btn-ghost" onClick={resetFilters}>
          Reset
        </button>
      </div>

      {loading ? (
        <div className="card">Loading analyses...</div>
      ) : error ? (
        <div className="card card--error">{error}</div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No analyses yet"
          message="Start a new analysis by pasting links from EDRSR."
          action={
            <Link className="btn btn-primary" to="/create">
              Create analysis
            </Link>
          }
        />
      ) : (
        <div className="list">
          {jobs.map((job) => (
            <Link key={job.id} to={`/analyses/${job.id}`} className="card card--link">
              <div className="card__header">
                <div>
                  <div className="card__title">{job.title || 'Untitled analysis'}</div>
                  <div className="card__meta">
                    {formatDateShort(job.created_at)} • {formatStatus(job.status)}
                  </div>
                </div>
                <StatusBadge status={job.status} />
              </div>
              <div className="card__body">
                <ProgressBar value={job.progress} />
                <div className="card__meta">
                  {formatCount(job.processed_links, job.total_links)} links processed
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
            Previous
          </button>
          <div className="pagination__info">
            Page {page} of {totalPages}
          </div>
          <button
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
