import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDateShort, formatStatus } from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';

type Matter = {
  id: string;
  title: string;
  description?: string | null;
  client_name?: string | null;
  tags?: string[] | null;
  created_at?: string | null;
};

type MatterJob = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type AvailableJob = {
  id: string;
  title?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  matter_id?: string | null;
};

type JobsResponse = {
  success: boolean;
  jobs: AvailableJob[];
};

type MattersListResponse = {
  success: boolean;
  matters: { id: string; title: string }[];
};

type MatterResponse = {
  success: boolean;
  matter: Matter;
  jobs: MatterJob[];
};

export function MatterDetailPage() {
  const { matterId } = useParams();
  const { accessToken } = useAuth();
  const { t, dateLocale } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [matter, setMatter] = useState<Matter | null>(null);
  const [jobs, setJobs] = useState<MatterJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [attachSearchInput, setAttachSearchInput] = useState('');
  const [attachSearch, setAttachSearch] = useState('');
  const [attachStatus, setAttachStatus] = useState('completed');
  const [availableJobs, setAvailableJobs] = useState<AvailableJob[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [mattersIndex, setMattersIndex] = useState<Record<string, string>>({});

  const loadMatter = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId || !matterId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<MatterResponse>(`/matters/${matterId}`, {
        token: accessToken,
        workspaceId: activeWorkspaceId,
      });
      setMatter(data.matter);
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeWorkspaceId, matterId, t]);

  const loadMattersIndex = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId) return;
    try {
      const data = await apiRequest<MattersListResponse>('/matters', {
        token: accessToken,
        workspaceId: activeWorkspaceId,
      });
      const nextIndex: Record<string, string> = {};
      (data.matters || []).forEach((item) => {
        nextIndex[item.id] = item.title;
      });
      setMattersIndex(nextIndex);
    } catch {
      setMattersIndex({});
    }
  }, [accessToken, activeWorkspaceId]);

  const loadAvailableJobs = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId) return;
    setAttachLoading(true);
    setAttachError(null);
    try {
      const data = await apiRequest<JobsResponse>('/jobs', {
        token: accessToken,
        workspaceId: activeWorkspaceId,
        query: {
          limit: 50,
          page: 1,
          status: attachStatus || undefined,
          search: attachSearch || undefined,
        },
      });
      setAvailableJobs(data.jobs || []);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : t('errors.generic'));
      setAvailableJobs([]);
    } finally {
      setAttachLoading(false);
    }
  }, [accessToken, activeWorkspaceId, attachSearch, attachStatus, t]);

  useEffect(() => {
    if (!accessToken || !activeWorkspaceId || !matterId) {
      setLoading(false);
      return;
    }
    loadMatter();
  }, [accessToken, activeWorkspaceId, matterId, loadMatter]);

  useEffect(() => {
    if (!showAttach) return;
    loadMattersIndex();
  }, [loadMattersIndex, showAttach]);

  useEffect(() => {
    if (!showAttach) return;
    loadAvailableJobs();
  }, [attachSearch, attachStatus, loadAvailableJobs, showAttach]);

  const handleAttachSearch = () => {
    setAttachSearch(attachSearchInput.trim());
  };

  const resetAttachFilters = () => {
    setAttachSearchInput('');
    setAttachSearch('');
    setAttachStatus('completed');
  };

  const handleRemoveJob = async (jobId: string) => {
    if (!accessToken || !activeWorkspaceId || !matterId) return;
    try {
      await apiRequest(`/matters/${matterId}/jobs/${jobId}`, {
        token: accessToken,
        method: 'DELETE',
        workspaceId: activeWorkspaceId,
      });
      await loadMatter();
      if (showAttach) {
        await loadAvailableJobs();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    }
  };

  const handleAttachJob = async (job: AvailableJob) => {
    if (!accessToken || !activeWorkspaceId || !matterId) return;
    if (job.matter_id && job.matter_id !== matterId) {
      const otherName = mattersIndex[job.matter_id] || job.matter_id;
      if (!window.confirm(t('matters.moveConfirm', { matter: otherName }))) return;
    }
    try {
      await apiRequest(`/matters/${matterId}/jobs`, {
        token: accessToken,
        method: 'POST',
        workspaceId: activeWorkspaceId,
        body: { jobId: job.id },
      });
      await loadMatter();
      await loadAvailableJobs();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : t('errors.generic'));
    }
  };

  if (loading) return <div className="card">{t('common.loading')}</div>;
  if (error) return <div className="card card--error">{error}</div>;
  if (!matter) return <EmptyState title={t('matters.emptyTitle')} />;

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <button className="link" onClick={() => navigate('/matters')}>
            {t('common.back')}
          </button>
          <h1>{matter.title}</h1>
          <p>{matter.client_name ? `${t('common.client')}: ${matter.client_name}` : ''}</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-ghost" onClick={() => setShowAttach((prev) => !prev)}>
            {showAttach ? t('common.close') : t('matters.addExisting')}
          </button>
          <Link className="btn btn-primary" to={`/create?matterId=${matter.id}`}>
            {t('matters.addJob')}
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('matters.details')}</div>
            <div className="card__meta">{matter.description || t('common.optional')}</div>
          </div>
        </div>
        <div className="card__body stats">
          <div>
            <span>{t('common.title')}</span>
            <strong>{matter.title}</strong>
          </div>
          <div>
            <span>{t('common.client')}</span>
            <strong>{matter.client_name || '—'}</strong>
          </div>
        </div>
      </div>

      {showAttach ? (
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('matters.attachExistingTitle')}</div>
              <div className="card__meta">{t('matters.attachExistingMeta')}</div>
            </div>
          </div>
          <div className="card__body stack">
            <div className="filters">
              <div className="field">
                <span>{t('common.search')}</span>
                <div className="field__row">
                  <input
                    value={attachSearchInput}
                    onChange={(event) => setAttachSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleAttachSearch();
                    }}
                    placeholder={t('matters.searchPlaceholder')}
                  />
                  <button className="btn btn-ghost" onClick={handleAttachSearch}>
                    {t('common.search')}
                  </button>
                </div>
              </div>
              <label className="field">
                <span>{t('common.status')}</span>
                <select
                  value={attachStatus}
                  onChange={(event) => setAttachStatus(event.target.value)}
                >
                  <option value="">{t('common.all')}</option>
                  <option value="completed">{t('status.completed')}</option>
                  <option value="queued">{t('status.queued')}</option>
                  <option value="retrying">{t('status.retrying')}</option>
                  <option value="processing">{t('status.processing')}</option>
                  <option value="downloading">{t('status.downloading')}</option>
                  <option value="analyzing">{t('status.analyzing')}</option>
                  <option value="error">{t('status.error')}</option>
                  <option value="cancelled">{t('status.cancelled')}</option>
                  <option value="pending">{t('status.pending')}</option>
                </select>
              </label>
              <button className="btn btn-ghost" onClick={resetAttachFilters}>
                {t('common.reset')}
              </button>
            </div>

            {attachError ? <div className="form__error">{attachError}</div> : null}
            {attachLoading ? (
              <div className="muted">{t('common.loading')}</div>
            ) : availableJobs.length === 0 ? (
              <EmptyState
                title={t('matters.attachEmptyTitle')}
                message={t('matters.attachEmptyMessage')}
              />
            ) : (
              <div className="list">
                {availableJobs.map((job) => {
                  const isCurrentMatter = job.matter_id === matterId;
                  const isOtherMatter = !!job.matter_id && job.matter_id !== matterId;
                  const otherMatterName = isOtherMatter
                    ? mattersIndex[job.matter_id || ''] || job.matter_id
                    : null;
                  const locationLabel = isCurrentMatter
                    ? t('matters.inThisMatter')
                    : isOtherMatter
                      ? t('matters.inOtherMatter', { matter: otherMatterName || '' })
                      : t('matters.unassigned');
                  const actionLabel = isCurrentMatter
                    ? t('matters.alreadyAdded')
                    : isOtherMatter
                      ? t('matters.moveToMatter')
                      : t('matters.addExistingAction');

                  return (
                    <div
                      key={job.id}
                      className={`list__row${isCurrentMatter ? ' list__row--active' : ''}`}
                    >
                      <div>
                        <Link to={`/analyses/${job.id}`} className="link">
                          {job.title || t('analyses.untitled')}
                        </Link>
                        <div className="meta">
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
                        <div className="meta">{locationLabel}</div>
                      </div>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleAttachJob(job)}
                        disabled={isCurrentMatter}
                      >
                        {actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('matters.jobs')}</div>
            <div className="card__meta">{t('matters.jobsCount', { count: jobs.length })}</div>
          </div>
        </div>
        <div className="card__body">
          {jobs.length === 0 ? (
            <EmptyState title={t('analyses.emptyTitle')} message={t('analyses.emptyMessage')} />
          ) : (
            <div className="list">
              {jobs.map((job) => (
                <div key={job.id} className="list__row">
                  <div>
                    <Link to={`/analyses/${job.id}`} className="link">
                      {job.title || t('analyses.untitled')}
                    </Link>
                    <div className="meta">
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
                  <button className="btn btn-ghost" onClick={() => handleRemoveJob(job.id)}>
                    {t('common.remove')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
