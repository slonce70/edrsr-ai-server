import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDate } from '../lib/format';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWorkspace } from '../state/WorkspaceContext';
import type { ShareLink, ShareLinksResponse, ShareStatus } from '../types/api';

export function ShareLinksPage() {
  const { accessToken } = useAuth();
  const { t, dateLocale } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<ShareLinksResponse>('/share-links', {
        token: accessToken,
        workspaceId: activeWorkspaceId,
      });
      setLinks(data.links || []);
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
    loadLinks();
  }, [accessToken, activeWorkspaceId, loadLinks]);

  const getStatus = useCallback((link: ShareLink): ShareStatus => {
    if (link.revoked_at) return 'revoked';
    if (link.expires_at) {
      const expiresAt = new Date(link.expires_at).getTime();
      if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) return 'expired';
    }
    return 'active';
  }, []);

  const handleRevoke = async (link: ShareLink) => {
    if (!accessToken || !activeWorkspaceId) return;
    if (!window.confirm(t('share.revokeConfirm'))) return;
    setRevokingId(link.id);
    setError(null);
    try {
      await apiRequest(`/share-links/${link.id}/revoke`, {
        token: accessToken,
        method: 'POST',
        workspaceId: activeWorkspaceId,
      });
      await loadLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setRevokingId(null);
    }
  };

  const hasWorkspace = Boolean(activeWorkspaceId);
  const linksWithStatus = useMemo(
    () =>
      links.map((link) => ({
        ...link,
        status: getStatus(link),
      })),
    [getStatus, links]
  );

  if (!hasWorkspace) {
    return <EmptyState title={t('share.workspaceTitle')} message={t('share.workspaceMessage')} />;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('share.manageTitle')}</h1>
          <p>{t('share.manageSubtitle')}</p>
        </div>
      </div>

      <div className="card">
        <div className="card__body">
          <div className="muted">{t('share.manageNote')}</div>
        </div>
      </div>

      {loading ? (
        <div className="card">{t('common.loading')}</div>
      ) : error ? (
        <div className="card card--error">{error}</div>
      ) : linksWithStatus.length === 0 ? (
        <EmptyState title={t('share.manageEmptyTitle')} message={t('share.manageEmptyMessage')} />
      ) : (
        <div className="list">
          {linksWithStatus.map((link) => (
            <div key={link.id} className="card">
              <div className="card__header">
                <div>
                  <div className="card__title">
                    <Link to={`/analyses/${link.job_id}`} className="link">
                      {link.title || t('analyses.untitled')}
                    </Link>
                  </div>
                  <div className="card__meta">
                    {t('share.linkMeta', {
                      created: formatDate(link.created_at, dateLocale),
                      expires: formatDate(link.expires_at || null, dateLocale),
                    })}
                  </div>
                </div>
                <div className="actions">
                  <span className={`badge badge-${link.status}`}>
                    {t(`share.status.${link.status}`)}
                  </span>
                  {link.status === 'active' ? (
                    <button
                      className="btn btn-ghost btn-danger"
                      onClick={() => handleRevoke(link)}
                      disabled={revokingId === link.id}
                    >
                      {t('share.revoke')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="card__body">
                <div className="muted">{t('share.urlMissing')}</div>
                <div className="meta">
                  {link.created_by ? t('share.createdBy', { id: link.created_by }) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
