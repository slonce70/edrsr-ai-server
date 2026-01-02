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

  useEffect(() => {
    if (!accessToken || !activeWorkspaceId || !matterId) {
      setLoading(false);
      return;
    }
    loadMatter();
  }, [accessToken, activeWorkspaceId, matterId, loadMatter]);

  const handleRemoveJob = async (jobId: string) => {
    if (!accessToken || !activeWorkspaceId || !matterId) return;
    try {
      await apiRequest(`/matters/${matterId}/jobs/${jobId}`, {
        token: accessToken,
        method: 'DELETE',
        workspaceId: activeWorkspaceId,
      });
      await loadMatter();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
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
        <Link className="btn btn-primary" to={`/create?matterId=${matter.id}`}>
          {t('matters.addJob')}
        </Link>
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
                      {job.title}
                    </Link>
                    <div className="meta">
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
