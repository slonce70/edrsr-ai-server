import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatCount, formatDate, formatDateShort, formatDurationSeconds } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useAuth } from '../state/AuthContext';
import { useWebSocket } from '../state/WebSocketContext';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import { MarkdownView } from '../components/MarkdownView';

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
};

type LinkInfo = {
  url: string;
  status: string;
  decision_date?: string | null;
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

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'analyzing', 'pending']);

export function JobDetailPage() {
  const { jobId } = useParams();
  const { accessToken } = useAuth();
  const { subscribe, onJobUpdate } = useWebSocket();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkInfo[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  const fetchAnalysis = useCallback(async () => {
    if (!accessToken || !jobId) return;
    try {
      const data = await apiRequest<{ success: boolean; analysis: string }>(
        `/jobs/${jobId}/analysis`,
        { token: accessToken }
      );
      setAnalysis(data.analysis || null);
    } catch {
      // ignore
    }
  }, [accessToken, jobId]);

  const fetchStatus = useCallback(async () => {
    if (!accessToken || !jobId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<StatusResponse>(`/status/${jobId}`, {
        token: accessToken,
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
  }, [accessToken, analysis, fetchAnalysis, jobId]);

  const fetchChat = useCallback(async () => {
    if (!accessToken || !jobId) return;
    try {
      const data = await apiRequest<ChatResponse>(`/chat/${jobId}`, { token: accessToken });
      setChat(data || []);
    } catch {
      // ignore
    }
  }, [accessToken, jobId]);

  useEffect(() => {
    fetchStatus();
    fetchChat();
  }, [fetchStatus, fetchChat]);

  useEffect(() => {
    if (jobId) subscribe(jobId);
  }, [jobId, subscribe]);

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
    const content = analysis || 'No analysis content yet.';
    downloadText(`${safeTitle}.md`, content);
  };

  const handleDownloadLinks = async () => {
    if (!accessToken || !jobId) return;
    try {
      const data = await apiRequest<{
        success: boolean;
        links: { url: string; content: string }[];
      }>(`/jobs/${jobId}/links-content`, { token: accessToken });
      const lines = data.links
        .map((link) => `URL: ${link.url}\n${link.content || ''}\n`)
        .join('\n---\n\n');
      downloadText(`job_${jobId}_links.txt`, lines || 'No links content available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download links');
    }
  };

  const handlePrint = () => {
    const content = analysis || '';
    const html = renderMarkdown(content);
    const printWindow = window.open('', '_blank', 'width=960,height=720');
    if (!printWindow) return;
    printWindow.document.write(
      `<!doctype html><html><head><title>${
        job?.title || 'Report'
      }</title><style>body{font-family:Arial, sans-serif; padding:32px;} h1{margin-bottom:16px;} .meta{color:#555; font-size:12px; margin-bottom:24px;} pre,code{white-space:pre-wrap;} a{color:#0f766e;}</style></head><body>`
    );
    printWindow.document.write(`<h1>${job?.title || 'Report'}</h1>`);
    printWindow.document.write(
      `<div class="meta">Created: ${formatDate(job?.created_at)} | Links: ${formatCount(
        job?.processed_links,
        job?.total_links
      )}</div>`
    );
    printWindow.document.write(html);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const progressLabel = useMemo(() => {
    if (!job) return '';
    return `${formatCount(job.processed_links, job.total_links)} links processed`;
  }, [job]);

  if (loading && !job) {
    return <div className="card">Loading analysis...</div>;
  }

  if (error && !job) {
    return (
      <div className="card card--error">
        <div>{error}</div>
        <Link to="/analyses" className="btn btn-ghost">
          Back to list
        </Link>
      </div>
    );
  }

  if (!job) {
    return <EmptyState title="Analysis not found" message="Pick another job." />;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <Link to="/analyses" className="link">
            Back to analyses
          </Link>
          <h1>{job.title || 'Untitled analysis'}</h1>
          <p>Created {formatDate(job.created_at)}</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-ghost" onClick={handlePrint}>
            Print / Save PDF
          </button>
          <button className="btn btn-ghost" onClick={handleDownloadLinks}>
            Download links TXT
          </button>
          <button className="btn btn-primary" onClick={handleDownloadReport}>
            Download report
          </button>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">Status</div>
              <div className="card__meta">{progressLabel}</div>
            </div>
            <StatusBadge status={job.status} />
          </div>
          <div className="card__body">
            <ProgressBar value={job.progress} />
            <div className="stats">
              <div>
                <span>Updated</span>
                <strong>{formatDate(job.updated_at)}</strong>
              </div>
              <div>
                <span>Duration</span>
                <strong>{formatDurationSeconds(job.duration ?? null)}</strong>
              </div>
              <div>
                <span>Prompt</span>
                <strong>{job.prompt ? 'Custom' : 'Default'}</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">Sources</div>
              <div className="card__meta">{links.length} links</div>
            </div>
          </div>
          <div className="card__body list list--compact">
            {links.length === 0 ? (
              <div className="muted">Links will appear once processing starts.</div>
            ) : (
              links.map((link) => (
                <div key={link.url} className="list__row">
                  <div>
                    <a href={link.url} target="_blank" rel="noreferrer" className="link">
                      {link.url}
                    </a>
                    <div className="meta">{formatDateShort(link.decision_date || null)}</div>
                  </div>
                  <span className={`badge badge-${link.status}`}>{link.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Report</div>
            <div className="card__meta">Markdown report generated by the model.</div>
          </div>
        </div>
        <div className="card__body">
          {analysis ? (
            <MarkdownView markdown={analysis} />
          ) : (
            <div className="muted">The report will appear after processing completes.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Chat</div>
            <div className="card__meta">Ask follow-up questions about the report.</div>
          </div>
        </div>
        <div className="card__body">
          <div className="chat">
            {chat.length === 0 ? (
              <div className="muted">No chat messages yet.</div>
            ) : (
              chat.map((entry, index) => (
                <div
                  key={`${entry.role}-${index}`}
                  className={`chat__row chat__row--${entry.role}`}
                >
                  <div className="chat__bubble">
                    <div className="chat__role">{entry.role === 'ai' ? 'AI' : 'You'}</div>
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
              placeholder="Ask a question about this report"
              rows={3}
            />
            <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="card card--error">{error}</div> : null}
    </div>
  );
}
