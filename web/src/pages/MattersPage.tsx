import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';

type MatterSummary = {
  id: string;
  title: string;
  client_name?: string | null;
  jobs_count?: number | null;
  created_at?: string;
  updated_at?: string;
};

type MattersResponse = {
  success: boolean;
  matters: MatterSummary[];
};

export function MattersPage() {
  const { accessToken } = useAuth();
  const { t } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const resetForm = () => {
    setTitle('');
    setClientName('');
    setDescription('');
  };

  const loadMatters = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<MattersResponse>('/matters', {
        token: accessToken,
        workspaceId: activeWorkspaceId,
      });
      setMatters(data.matters || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeWorkspaceId, t]);

  useEffect(() => {
    if (!accessToken || !activeWorkspaceId) {
      setLoading(false);
      return;
    }
    loadMatters();
  }, [accessToken, activeWorkspaceId, loadMatters]);

  const handleCreate = async () => {
    if (!accessToken || !activeWorkspaceId || !title.trim()) return;
    setSaving(true);
    try {
      await apiRequest('/matters', {
        token: accessToken,
        method: 'POST',
        workspaceId: activeWorkspaceId,
        body: {
          title: title.trim(),
          clientName: clientName.trim() || null,
          description: description.trim() || null,
        },
      });
      resetForm();
      setShowForm(false);
      await loadMatters();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('matters.title')}</h1>
          <p>{t('matters.subtitle')}</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm((prev) => !prev)}
          disabled={saving}
        >
          {showForm ? t('common.cancel') : t('matters.newMatter')}
        </button>
      </div>

      {showForm ? (
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('matters.newMatter')}</div>
              <div className="card__meta">{t('matters.newMatterMeta')}</div>
            </div>
          </div>
          <div className="card__body stack">
            <label className="field">
              <span>{t('common.title')}</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>{t('common.client')}</span>
              <input
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder={t('common.optional')}
              />
            </label>
            <label className="field">
              <span>{t('common.description')}</span>
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('common.optional')}
              />
            </label>
            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={saving || !title.trim()}
              >
                {saving ? t('common.saving') : t('common.create')}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="card">{t('common.loading')}</div>
      ) : error ? (
        <div className="card card--error">{error}</div>
      ) : matters.length === 0 ? (
        <EmptyState
          title={t('matters.emptyTitle')}
          message={t('matters.emptyMessage')}
          action={
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              {t('matters.newMatter')}
            </button>
          }
        />
      ) : (
        <div className="list">
          {matters.map((matter) => (
            <Link key={matter.id} to={`/matters/${matter.id}`} className="card card--link">
              <div className="card__header">
                <div>
                  <div className="card__title">{matter.title}</div>
                  <div className="card__meta">
                    {matter.client_name ? `${t('common.client')}: ${matter.client_name}` : ''}
                  </div>
                </div>
                <span className="pill">
                  {t('matters.jobsCount', { count: matter.jobs_count || 0 })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
