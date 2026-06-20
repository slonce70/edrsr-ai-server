import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDate, formatDateShort, formatDurationSeconds, formatStatus } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { BackToTop } from '../components/BackToTop';
import { CoveragePanel } from '../components/CoveragePanel';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { ReadingProgress } from '../components/ReadingProgress';
import { StatusBadge } from '../components/StatusBadge';
import { MarkdownView } from '../components/MarkdownView';
import { ReportSearch } from '../components/ReportSearch';
import { ReportStatusBanner } from '../components/ReportStatusBanner';
import { ReportToc } from '../components/ReportToc';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { buildRetryBody } from './jobRetry';
import { buildWordBlob } from '../lib/exportDoc';
import { mergeJobUpdate } from '../lib/jobUpdate';
import { ACTIVE_STATUS_KEYS } from '../lib/overviewStats';
import { deriveCompleteness } from '../lib/reportCoverage';
import type {
  ChatMessage,
  ChatResponse,
  JobDetail,
  LinkInfo,
  StatusResponse,
} from '../types/api';

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

const ACTIVE_STATUSES = new Set<string>(ACTIVE_STATUS_KEYS);

export function JobDetailPage() {
  const { jobId } = useParams();
  const { accessToken } = useAuth();
  const { subscribe, onJobUpdate, clientId, status } = useWebSocket();
  const { t, dateLocale } = useLocale();
  const { success, error: toastError } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  useDocumentTitle(job?.title || t('analyses.untitled'));
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkInfo[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [matter, setMatter] = useState<{ id: string; title: string } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareDays, setShareDays] = useState(14);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

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
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeWorkspaceId, analysis, fetchAnalysis, jobId, t]);

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

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (!jobId || !accessToken) return;
    if (status === 'connected' && prev !== 'connected') {
      fetchStatus();
      fetchChat();
    }
  }, [status, jobId, accessToken, fetchStatus, fetchChat]);

  useEffect(() => {
    return onJobUpdate((payload: JobUpdatePayload) => {
      if (payload.type === 'CHAT_UPDATE') {
        if (Array.isArray(payload.payload)) setChat(payload.payload);
        return;
      }
      if (!payload.id || payload.id !== jobId) return;
      setJob((prev) =>
        prev ? mergeJobUpdate(prev, payload as Record<string, unknown>) : prev
      );
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

  useEffect(() => {
    const container = chatScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [chat, pendingMessage]);

  const submitMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!accessToken || !jobId || !trimmed || sending) return;
    setPendingMessage(trimmed);
    setMessage('');
    setSending(true);
    try {
      await apiRequest(`/chat/${jobId}`, {
        token: accessToken,
        method: 'POST',
        body: { message: trimmed },
        workspaceId: activeWorkspaceId || undefined,
      });
      await fetchChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
      setMessage(trimmed);
    } finally {
      setPendingMessage('');
      setSending(false);
    }
  };

  const handleSend = () => submitMessage(message);

  const handleSuggestion = (text: string) => {
    void submitMessage(text);
  };

  const handleCopyAnswer = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      success(t('job.answerCopied'));
    } catch {
      toastError(t('errors.generic'));
    }
  };

  const chatSuggestions = useMemo(
    () =>
      [t('job.suggest1'), t('job.suggest2'), t('job.suggest3'), t('job.suggest4')].filter(
        Boolean
      ),
    [t]
  );

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
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

  const downloadBlob = (filename: string, blob: Blob) => {
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

  const handleCopyReport = async () => {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis);
      success(t('job.reportCopied'));
    } catch {
      toastError(t('errors.generic'));
    }
  };

  const handleDownloadWord = async () => {
    const safeTitle = job?.title ? job.title.replace(/[^a-zA-Z0-9_-]+/g, '_') : 'report';
    if (!analysis) {
      downloadText(`${safeTitle}.txt`, t('job.reportEmpty'));
      return;
    }
    try {
      const html = await renderMarkdown(analysis);
      const meta = `${t('job.created', {
        date: formatDate(job?.created_at, dateLocale),
      })} | ${progressLabel}`;
      const blob = buildWordBlob({
        title: job?.title || t('job.report'),
        meta,
        bodyHtml: html,
      });
      downloadBlob(`${safeTitle}.doc`, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    }
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
      setError(err instanceof Error ? err.message : t('errors.generic'));
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
      success(t('share.copied'));
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

  const completeness = useMemo(
    () =>
      deriveCompleteness({
        processedLinks: job?.processed_links,
        totalLinks: job?.total_links,
        links,
        qualityPartial: job?.quality?.partial === true,
      }),
    [job, links]
  );

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
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
      toastError(message);
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
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
      toastError(message);
    } finally {
      setRetrying(false);
    }
  };

  const handleSaveTitle = async () => {
    if (!accessToken || !jobId) return;
    const next = titleDraft.trim();
    if (!next || next === job?.title) {
      setEditingTitle(false);
      return;
    }
    if (next.length > 255) {
      toastError(t('job.titleTooLong'));
      return;
    }
    setSavingTitle(true);
    try {
      const data = await apiRequest<{ success: boolean; job: { title?: string } }>(
        `/jobs/${jobId}/title`,
        {
          token: accessToken,
          method: 'PATCH',
          body: { title: next },
          workspaceId: activeWorkspaceId || undefined,
        }
      );
      setJob((prev) => (prev ? { ...prev, title: data.job?.title ?? next } : prev));
      setEditingTitle(false);
      success(t('job.titleUpdated'));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setSavingTitle(false);
    }
  };

  const handleCancelTitle = () => {
    setEditingTitle(false);
    setTitleDraft('');
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleSaveTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelTitle();
    }
  };

  if (loading && !job) {
    return (
      <div className="stack" aria-busy="true">
        <span className="sr-only">{t('common.loading')}</span>
        <div className="page-header">
          <div>
            <Skeleton width="35%" height="1.5rem" />
            <Skeleton width="20%" height="0.75rem" />
          </div>
        </div>
        <div className="grid grid--two">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard />
      </div>
    );
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
      <ReadingProgress />
      <BackToTop />
      <div className="page-header">
        <div>
          <Link to="/analyses" className="link">
            {t('job.back')}
          </Link>
          {editingTitle ? (
            <div className="title-edit">
              <input
                autoFocus
                value={titleDraft}
                maxLength={255}
                aria-label={t('job.editTitle')}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={handleTitleKeyDown}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveTitle}
                disabled={savingTitle || !titleDraft.trim()}
              >
                {t('common.save')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleCancelTitle}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <div className="title-view">
              <h1>{job.title || t('analyses.untitled')}</h1>
              {accessToken && jobId ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('job.editTitle')}
                  onClick={() => {
                    setTitleDraft(job.title || '');
                    setEditingTitle(true);
                  }}
                >
                  ✎
                </button>
              ) : null}
            </div>
          )}
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
          <button className="btn btn-ghost" onClick={handleDownloadWord}>
            {t('job.downloadWord')}
          </button>
          <button className="btn btn-primary" onClick={handleDownloadReport}>
            {t('job.downloadReport')}
          </button>
        </div>
      </div>

      <div className="job-layout">
        <div className="job-layout__main">
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">{t('job.report')}</div>
                <div className="card__meta">{t('job.reportMeta')}</div>
              </div>
              {analysis ? (
                <button type="button" className="btn btn-ghost" onClick={handleCopyReport}>
                  {t('job.copyReport')}
                </button>
              ) : null}
            </div>
            <div className="card__body">
              <ReportToc markdown={analysis} />
              <ReportStatusBanner markdown={analysis} quality={job.quality} />
              {analysis ? (
                <ReportSearch markdown={analysis} />
              ) : (
                <div className="muted">{t('job.reportEmpty')}</div>
              )}
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
              <div
                className="chat"
                ref={chatScrollRef}
                role="log"
                aria-live="polite"
                aria-relevant="additions"
              >
                {chat.length === 0 && !(sending && pendingMessage) ? (
                  <>
                    <div className="muted">{t('job.chatEmpty')}</div>
                    {analysis && !sending ? (
                      <div className="chat__suggestions-wrap">
                        <div className="chat__suggestions-title">
                          {t('job.suggestionsTitle')}
                        </div>
                        <div className="chat__suggestions">
                          {chatSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              className="chat__suggestion"
                              onClick={() => handleSuggestion(suggestion)}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {chat.map((entry, index) => (
                      <div
                        key={`${entry.role}-${index}`}
                        className={`chat__row chat__row--${entry.role}`}
                      >
                        <div className="chat__bubble">
                          <div className="chat__role">
                            {entry.role === 'ai' ? t('job.chatRoleAi') : t('job.chatRoleUser')}
                          </div>
                          {entry.role === 'ai' ? (
                            <button
                              type="button"
                              className="chat__copy"
                              onClick={() => handleCopyAnswer(entry.content)}
                              aria-label={t('job.copyAnswer')}
                              title={t('job.copyAnswer')}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                          ) : null}
                          <MarkdownView markdown={entry.content} />
                        </div>
                      </div>
                    ))}
                    {sending && pendingMessage ? (
                      <div className="chat__row chat__row--user">
                        <div className="chat__bubble">
                          <div className="chat__role">{t('job.chatRoleUser')}</div>
                          <MarkdownView markdown={pendingMessage} />
                        </div>
                      </div>
                    ) : null}
                    {sending ? (
                      <div className="chat__row chat__row--ai">
                        <div className="chat__bubble">
                          <div className="chat__role">{t('job.chatRoleAi')}</div>
                          <div className="chat__typing" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </div>
                          <span className="sr-only">{t('job.aiTyping')}</span>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="chat__composer">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={t('job.chatPlaceholder')}
                  aria-label={t('job.chatPlaceholder')}
                  rows={3}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleSend}
                  disabled={sending || !message.trim()}
                >
                  {sending ? t('common.loading') : t('job.chatSend')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="job-layout__rail">
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
              <CoveragePanel
                completeness={completeness}
                quality={job.quality}
                onRetry={
                  !completeness.complete && job.status !== 'error' ? handleRetry : undefined
                }
                retrying={retrying}
              />
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
                <div className="card__meta">
                  {t('job.sourcesSummary', {
                    processed: completeness.processed,
                    failed: completeness.failed,
                  })}
                </div>
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
        </aside>
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
