import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDate } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { ReportSearch } from '../components/ReportSearch';
import { ReportStatusBanner } from '../components/ReportStatusBanner';
import { ReportToc } from '../components/ReportToc';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

type SharePayload = {
  success: boolean;
  share: { expires_at: string };
  job: {
    id: string;
    title: string;
    created_at: string;
    processed_links: number;
    total_links: number;
  };
  analysis?: string | null;
  links?: { url: string; evidence_snippet?: string | null }[];
};

export function SharePage() {
  const { token } = useParams();
  const { t, dateLocale } = useLocale();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(data?.job.title);

  useEffect(() => {
    if (!token) return;
    apiRequest<SharePayload>(`/share/${token}`)
      .then((payload) => setData(payload))
      .catch(() => setError(t('share.notFound')));
  }, [token, t]);

  const handleCopyReport = async () => {
    if (!data?.analysis) return;
    try {
      await navigator.clipboard.writeText(data.analysis);
      success(t('job.reportCopied'));
    } catch {
      toastError(t('errors.generic'));
    }
  };

  if (error) {
    return <EmptyState title={t('share.notFound')} message={t('share.publicNote')} />;
  }

  if (!data) {
    return (
      <div className="share-view" aria-busy="true">
        <span className="sr-only">{t('common.loading')}</span>
        <div className="page-header">
          <div>
            <Skeleton width="40%" height="1.5rem" />
            <Skeleton width="22%" height="0.75rem" />
          </div>
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const evidence = (data.links || []).filter((link) => link.evidence_snippet);

  return (
    <div className="share-view">
      <div className="page-header">
        <div>
          <h1>{data.job.title}</h1>
          <p>{t('job.created', { date: formatDate(data.job.created_at, dateLocale) })}</p>
        </div>
        <Link className="btn btn-primary" to="/login">
          {t('share.ctaButton')}
        </Link>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('job.report')}</div>
            <div className="card__meta">{t('job.reportMeta')}</div>
          </div>
          {data.analysis ? (
            <button type="button" className="btn btn-ghost" onClick={handleCopyReport}>
              {t('job.copyReport')}
            </button>
          ) : null}
        </div>
        <div className="card__body">
          <ReportToc markdown={data.analysis} />
          <ReportStatusBanner markdown={data.analysis} />
          {data.analysis ? (
            <ReportSearch markdown={data.analysis} />
          ) : (
            <div className="muted">{t('job.reportEmpty')}</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('job.evidenceTitle')}</div>
            <div className="card__meta">{t('job.evidenceMeta')}</div>
          </div>
        </div>
        <div className="card__body list">
          {evidence.length === 0 ? (
            <div className="muted">{t('job.evidenceEmpty')}</div>
          ) : (
            evidence.map((link) => (
              <div key={`share-${link.url}`} className="list__row list__row--stack">
                <a href={link.url} target="_blank" rel="noreferrer" className="link">
                  {link.url}
                </a>
                <div className="snippet">{link.evidence_snippet}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('share.ctaTitle')}</div>
            <div className="card__meta">{t('share.ctaSubtitle')}</div>
          </div>
        </div>
        <div className="card__body">
          <Link className="btn btn-primary" to="/login">
            {t('share.ctaButton')}
          </Link>
        </div>
      </div>
    </div>
  );
}
