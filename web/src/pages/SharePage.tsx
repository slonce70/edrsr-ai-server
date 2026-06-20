import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDate } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { buildSourcesFooterHtml, buildWordBlob, PRINT_STYLE } from '../lib/exportDoc';
import { downloadBlob } from '../lib/download';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { ReportSearch } from '../components/ReportSearch';
import { ReportStatusBanner } from '../components/ReportStatusBanner';
import { ReportToc } from '../components/ReportToc';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { BackToTop } from '../components/BackToTop';
import { ReadingProgress } from '../components/ReadingProgress';

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

  const buildShareSourcesFooter = () => {
    if (!data) return '';
    const total = data.job.total_links;
    const coverageNote =
      typeof total === 'number' && total > 0
        ? t('job.exportCoverage', { processed: data.job.processed_links, total })
        : undefined;
    return buildSourcesFooterHtml({
      links: (data.links || []).map((link) => ({ url: link.url, decision_date: undefined })),
      coverageNote,
      labels: { sourcesTitle: t('job.exportSourcesTitle') },
    });
  };

  const handleDownloadWord = async () => {
    if (!data?.analysis) return;
    const safeTitle = data.job.title
      ? data.job.title.replace(/[^a-zA-Z0-9_-]+/g, '_')
      : 'report';
    try {
      const html = await renderMarkdown(data.analysis);
      const meta = t('job.created', { date: formatDate(data.job.created_at, dateLocale) });
      const blob = buildWordBlob({
        title: data.job.title || t('job.report'),
        meta,
        bodyHtml: `${html}${buildShareSourcesFooter()}`,
      });
      downloadBlob(`${safeTitle}.doc`, blob);
    } catch {
      toastError(t('errors.generic'));
    }
  };

  const handlePrint = async () => {
    if (!data?.analysis) return;
    const printWindow = window.open('', '_blank', 'width=960,height=720');
    if (!printWindow) return;

    let html = '';
    try {
      html = await renderMarkdown(data.analysis);
    } catch {
      toastError(t('errors.generic'));
      return;
    }

    const printDocument = printWindow.document;
    printDocument.open();
    printDocument.close();
    printDocument.title = data.job.title || t('job.report');

    while (printDocument.head.firstChild) {
      printDocument.head.removeChild(printDocument.head.firstChild);
    }

    const style = printDocument.createElement('style');
    style.textContent = PRINT_STYLE;
    printDocument.head.appendChild(style);

    while (printDocument.body.firstChild) {
      printDocument.body.removeChild(printDocument.body.firstChild);
    }

    const heading = printDocument.createElement('h1');
    heading.textContent = data.job.title || t('job.report');
    printDocument.body.appendChild(heading);

    const metaElement = printDocument.createElement('div');
    metaElement.className = 'meta';
    metaElement.textContent = t('job.created', {
      date: formatDate(data.job.created_at, dateLocale),
    });
    printDocument.body.appendChild(metaElement);

    const reportBody = printDocument.createElement('div');
    reportBody.innerHTML = `${html}${buildShareSourcesFooter()}`;
    printDocument.body.appendChild(reportBody);

    printWindow.focus();
    printWindow.print();
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
      <ReadingProgress />
      <BackToTop />
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
            <div className="card__actions">
              <button type="button" className="btn btn-primary" onClick={handleDownloadWord}>
                {t('job.downloadWord')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handlePrint}>
                {t('job.printPdf')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleCopyReport}>
                {t('job.copyReport')}
              </button>
            </div>
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
