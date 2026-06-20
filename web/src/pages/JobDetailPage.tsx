import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDate, formatDateShort, formatDurationSeconds, formatStatus } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import { MarkdownView } from '../components/MarkdownView';
import { ReportStatusBanner } from '../components/ReportStatusBanner';
import { buildRetryBody } from './jobRetry';

type JobDetail = {
  id: string;
  title: string;
  status: string;
  progress: number;
  processed_links: number;
  total_links: number;
  prompt?: string | null;
  created_at: string;
  updated_at: string;
  duration?: number | null;
  error_message?: string | null;
  matter_id?: string | null;
};

type LinkInfo = {
  url: string;
  status: string;
  decision_date?: string | null;
  evidence_snippet?: string | null;
};

type ChatMessage = {
  role: 'user' | 'ai';
  content: string;
};

type StatusResponse = JobDetail & {
  links?: LinkInfo[];
};

type ChatResponse = ChatMessage[];

type JobUpdatePayload = {
  id?: string;
  status?: string;
  progress?: number;
  processed_links?: number;
  total_links?: number;
  title?: string;
  duration?: number;
  type?: string;
  payload?: ChatMessage[];
};

const ACTIVE_STATUSES = new Set([
  'queued',
  'retrying',
  'processing',
  'downloading',
  'analyzing',
  'pending',
]);

export function JobDetailPage() {
  const { jobId } = useParams();
  const { accessToken } = useAuth();
  const { subscribe, onJobUpdate, clientId } = useWebSocket();
  const { t, dateLocale } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkInfo[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [matter, setMatter] = useState<{ id: string; title: string } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareDays, setShareDays] = useState(14);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fetchAnalysis = useCallback(async () => {
    if (!accessToken || !jobId) return;
    try {
      const data = await apiRequest<{ success: boolean; analysis: string }>(
        `/jobs/${jobId}/analysis`,
        { token: accessToken, workspaceId: activeWorkspaceId || undefined }
      );
      setAnalysis(data.analysis || null);
    } catch {
      // ignore
    }
  }, [accessToken, activeWorkspaceId, jobId]);

  const fetchStatus = useCallback(async () => {
    if (!accessToken || !jobId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<StatusResponse>(`/status/${jobId}`, {
        token: accessToken,
        workspaceId: activeWorkspaceId || undefined,
        query: { include: ['links'] },
      });
      setJob(data);
      setLinks(data.links ?? []);
      if (data.status === 'completed' && !analysis) {
        fetchAnalysis();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load job';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeWorkspaceId, analysis, fetchAnalysis, jobId]);

  const fetchChat = useCallback(async () => {
    if (!accessToken || !jobId) return;
    try {
      const data = await apiRequest<ChatResponse>(`/chat/${jobId}`, {
        token: accessToken,
        workspaceId: activeWorkspaceId || undefined,
      });
      setChat(data || []);
    } catch {
      // ignore
    }
  }, [accessToken, activeWorkspaceId, jobId]);

  useEffect(() => {
    fetchStatus();
    fetchChat();
  }, [fetchStatus, fetchChat]);

  useEffect(() => {
    if (!accessToken || !job?.matter_id || !activeWorkspaceId) {
      setMatter(null);
      return;
    }
    apiRequest<{ success: boolean; matter: { id: string; title: string } }>(
      `/matters/${job.matter_id}`,
      { token: accessToken, workspaceId: activeWorkspaceId }
    )
      .then((data) => setMatter(data.matter))
      .catch(() => setMatter(null));
  }, [accessToken, activeWorkspaceId, job?.matter_id]);

  useEffect(() => {
    if (jobId) subscribe(jobId, activeWorkspaceId);
  }, [activeWorkspaceId, jobId, subscribe]);

  useEffect(() => {
    return onJobUpdate((payload: JobUpdatePayload) => {
      if (payload.type === 'CHAT_UPDATE') {
        if (Array.isArray(payload.payload)) setChat(payload.payload);
        return;
      }
      if (!payload.id || payload.id !== jobId) return;
      setJob((prev) => (prev ? { ...prev, ...payload } : prev));
      if (payload.status === 'completed') {
        fetchAnalysis();
      }
    });
  }, [jobId, onJobUpdate, fetchAnalysis]);

  useEffect(() => {
    if (!job || !jobId || !accessToken) return;
    if (!ACTIVE_STATUSES.has(job.status)) return;
    const interval = window.setInterval(() => {
      fetchStatus();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [job, jobId, accessToken, fetchStatus]);

  const handleSend = async () => {
    if (!accessToken || !jobId || !message.trim()) return;
    setSending(true);
    try {
      await apiRequest(`/chat/${jobId}`, {
        token: accessToken,
        method: 'POST',
        body: { message: message.trim() },
        workspaceId: activeWorkspaceId || undefined,
      });
      setMessage('');
      fetchChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const downloadText = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadReport = () => {
    const safeTitle = job?.title ? job.title.replace(/[^a-zA-Z0-9_-]+/g, '_') : 'report';
    const content = analysis || t('job.reportEmpty');
    downloadText(`${safeTitle}.txt`, content);
  };

  const handleDownloadLinks = async () => {
    if (!accessToken || !jobId) return;
    try {
      const data = await apiRequest<{
        success: boolean;
        links: { url: string; content: string }[];
      }>(`/jobs/${jobId}/links-content`, {
        token: accessToken,
        workspaceId: activeWorkspaceId || undefined,
      });
      const lines = data.links
        .map((link) => `URL: ${link.url}\n${link.content || ''}\n`)
        .join('\n---\n\n');
      downloadText(`job_${jobId}_links.txt`, lines || 'No links content available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download links');
    }
  };

  const handlePrint = async () => {
    const content = analysis || '';
    const printWindow = window.open('', '_blank', 'width=960,height=720');
    if (!printWindow) return;

    let html = '';
    try {
      html = await renderMarkdown(content);
    } catch {
      html = '';
    }

    const printDocument = printWindow.document;
    printDocument.open();
    printDocument.close();
    printDocument.title = job?.title || t('job.report');

    while (printDocument.head.firstChild) {
      printDocument.head.removeChild(printDocument.head.firstChild);
    }

    const style = printDocument.createElement('style');
    style.textContent =
      'body{font-family:Arial, sans-serif; padding:32px;} h1{margin-bottom:16px;} .meta{color:#555; font-size:12px; margin-bottom:24px;} pre,code{white-space:pre-wrap;} a{color:#0f766e;}';
    printDocument.head.appendChild(style);

    while (printDocument.body.firstChild) {
      printDocument.body.removeChild(printDocument.body.firstChild);
    }

    const heading = printDocument.createElement('h1');
    heading.textContent = job?.title || t('job.report');
    printDocument.body.appendChild(heading);

    const meta = `${t('job.created', {
      date: formatDate(job?.created_at, dateLocale),
    })} | ${progressLabel}`;
    const metaElement = printDocument.createElement('div');
    metaElement.className = 'meta';
    metaElement.textContent = meta;
    printDocument.body.appendChild(metaElement);

    const reportBody = printDocument.createElement('div');
    reportBody.innerHTML = html;
    printDocument.body.appendChild(reportBody);

    printWindow.focus();
    printWindow.print();
  };

  const handleCreateShareLink = async () => {
    if (!accessToken || !jobId) return;
    setShareLoading(true);
    setShareNotice(null);
    try {
      const data = await apiRequest<{
        success: boolean;
        share?: { url?: string | null };
        token?: string;
      }>(`/share-links`, {
        token: accessToken,
        method: 'POST',
        workspaceId: activeWorkspaceId || undefined,
        body: { jobId, expiresInDays: shareDays },
      });
      const url =
        data.share?.url || (data.token ? `${window.location.origin}/share/${data.token}` : null);
      setShareUrl(url);
      setShareNotice(t('share.created'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNotice(t('share.copied'));
    } catch {
      setShareNotice(shareUrl);
    }
  };

  const progressLabel = useMemo(() => {
    if (!job) return '';
    return t('job.progress', {
      processed: typeof job.processed_links === 'number' ? job.processed_links : 0,
      total: typeof job.total_links === 'number' ? job.total_links : 0,
    });
  }, [job, t]);

  const evidenceLinks = useMemo(() => links.filter((link) => link.evidence_snippet), [links]);

  const handleDeleteJob = async () => {
    if (!accessToken || !jobId) return;
    if (!window.confirm(t('job.deleteConfirm'))) return;
    setDeleting(true);
    setError(null);
    try {
      await apiRequest(`/jobs/${jobId}`, {
        token: accessToken,
        method: 'DELETE',
        workspaceId: activeWorkspaceId || undefined,
      });
      navigate('/analyses');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setDeleting(false);
    }
  };

  const handleRetry = async () => {
    if (!accessToken || !jobId) return;
    setError(null);
    setRetrying(true);
    try {
      await apiRequest(`/retry/${jobId}`, {
        token: accessToken,
        method: 'POST',
        body: buildRetryBody(clientId),
        workspaceId: activeWorkspaceId || undefined,
      });
      navigate('/analyses');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setRetrying(false);
    }
  };

  if (loading && !job) {
    return <div className="card">{t('common.loading')}</div>;
  }

  if (error && !job) {
    return (
      <div className="card card--error">
        <div>{error}</div>
        <Link to="/analyses" className="btn btn-ghost">
          {t('job.back')}
        </Link>
      </div>
    );
  }

  if (!job) {
    return <EmptyState title={t('job.notFoundTitle')} message={t('job.notFoundMessage')} />;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <Link to="/analyses" className="link">
            {t('job.back')}
          </Link>
          <h1>{job.title || t('analyses.untitled')}</h1>
          <p>{t('job.created', { date: formatDate(job.created_at, dateLocale) })}</p>
          {matter ? (
            <Link to={`/matters/${matter.id}`} className="pill">
              {matter.title}
            </Link>
          ) : null}
        </div>
        <div className="page-header__actions">
          <button className="btn btn-ghost" onClick={handlePrint}>
            {t('job.printPdf')}
          </button>
          <button className="btn btn-ghost" onClick={handleDownloadLinks}>
            {t('job.downloadLinks')}
          </button>
          <button className="btn btn-primary" onClick={handleDownloadReport}>
            {t('job.downloadReport')}
          </button>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('job.status')}</div>
              <div className="card__meta">{progressLabel}</div>
            </div>
            <StatusBadge status={job.status} />
          </div>
          <div className="card__body">
            <ProgressBar value={job.progress} />
            <div className="stats">
              <div>
                <span>{t('job.updated')}</span>
                <strong>{formatDate(job.updated_at, dateLocale)}</strong>
              </div>
              <div>
                <span>{t('job.duration')}</span>
                <strong>{formatDurationSeconds(job.duration ?? null)}</strong>
              </div>
              <div>
                <span>{t('job.prompt')}</span>
                <strong>{job.prompt ? t('job.promptCustom') : t('job.promptDefault')}</strong>
              </div>
            </div>
            {job.status === 'error' && job.error_message ? (
              <div className="card--error job-error">
                <strong>{t('job.errorReasonTitle')}</strong>
                <div className="job-error__message">{job.error_message}</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRetry}
                  disabled={retrying || !clientId}
                >
                  {retrying ? t('job.retrying') : t('job.retry')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('job.sources')}</div>
              <div className="card__meta">{t('job.sourcesCount', { count: links.length })}</div>
            </div>
          </div>
          <div className="card__body list list--compact">
            {links.length === 0 ? (
              <div className="muted">{t('job.linksEmpty')}</div>
            ) : (
              links.map((link) => {
                const normalizedStatus = link.status === 'processed' ? 'completed' : link.status;

                return (
                  <div key={link.url} className="list__row">
                    <div>
                      <a href={link.url} target="_blank" rel="noreferrer" className="link">
                        {link.url}
                      </a>
                      <div className="meta">
                        {formatDateShort(link.decision_date || null, dateLocale)}
                      </div>
                    </div>
                    <span className={`badge badge-${normalizedStatus}`}>
                      {formatStatus(normalizedStatus, {
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
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('job.report')}</div>
            <div className="card__meta">{t('job.reportMeta')}</div>
          </div>
        </div>
        <div className="card__body">
          <ReportStatusBanner markdown={analysis} />
          {analysis ? (
            <MarkdownView markdown={analysis} />
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
          {evidenceLinks.length === 0 ? (
            <div className="muted">{t('job.evidenceEmpty')}</div>
          ) : (
            evidenceLinks.map((link) => (
              <div key={`evidence-${link.url}`} className="list__row list__row--stack">
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
            <div className="card__title">{t('share.title')}</div>
            <div className="card__meta">{t('share.subtitle')}</div>
          </div>
        </div>
        <div className="card__body stack">
          <label className="field">
            <span>{t('share.expiresIn')}</span>
            <select
              value={shareDays}
              onChange={(event) => setShareDays(Number(event.target.value))}
            >
              <option value={7}>7</option>
              <option value={14}>14</option>
              <option value={30}>30</option>
            </select>
          </label>
          <button
            className="btn btn-primary"
            onClick={handleCreateShareLink}
            disabled={shareLoading}
          >
            {shareLoading ? t('common.loading') : t('share.create')}
          </button>
          {shareUrl ? (
            <div className="share-link">
              <input value={shareUrl} readOnly />
              <button className="btn btn-ghost" onClick={handleCopyShare}>
                {t('common.copy')}
              </button>
            </div>
          ) : null}
          {shareNotice ? <div className="form__notice">{shareNotice}</div> : null}
          <div className="muted">{t('share.publicNote')}</div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('job.chatTitle')}</div>
            <div className="card__meta">{t('job.chatMeta')}</div>
          </div>
        </div>
        <div className="card__body">
          <div className="chat">
            {chat.length === 0 ? (
              <div className="muted">{t('job.chatEmpty')}</div>
            ) : (
              chat.map((entry, index) => (
                <div
                  key={`${entry.role}-${index}`}
                  className={`chat__row chat__row--${entry.role}`}
                >
                  <div className="chat__bubble">
                    <div className="chat__role">
                      {entry.role === 'ai' ? t('job.chatRoleAi') : t('job.chatRoleUser')}
                    </div>
                    <div>{entry.content}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="chat__composer">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t('job.chatPlaceholder')}
              rows={3}
            />
            <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? t('common.loading') : t('job.chatSend')}
            </button>
          </div>
        </div>
      </div>

      <div className="card card--danger">
        <div className="card__header">
          <div>
            <div className="card__title">{t('job.deleteTitle')}</div>
            <div className="card__meta">{t('job.deleteMeta')}</div>
          </div>
          <button className="btn btn-danger" onClick={handleDeleteJob} disabled={deleting}>
            {deleting ? t('common.loading') : t('job.delete')}
          </button>
        </div>
      </div>

      {error ? <div className="card card--error">{error}</div> : null}
    </div>
  );
}
