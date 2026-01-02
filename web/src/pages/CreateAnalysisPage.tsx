import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../state/AuthContext';
import { useWebSocket } from '../state/WebSocketContext';

type Prompt = {
  id: string;
  name: string;
  content: string;
};

type PromptResponse = {
  success: boolean;
  prompts: Prompt[];
};

const MAX_LINKS = 300;

function extractLinks(text: string) {
  const matches = text.match(/https?:\/\/[^\s,;]+/gi) || [];
  const cleaned = matches
    .map((url) => url.replace(/[),.]+$/g, '').trim())
    .filter((url) => /reyestr\.court\.gov\.ua\/Review\//i.test(url));
  return Array.from(new Set(cleaned));
}

export function CreateAnalysisPage() {
  const { accessToken } = useAuth();
  const { clientId, status } = useWebSocket();
  const navigate = useNavigate();
  const [rawInput, setRawInput] = useState('');
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptId, setPromptId] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [autoTitle, setAutoTitle] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedLinks = useMemo(() => extractLinks(rawInput), [rawInput]);

  useEffect(() => {
    if (!accessToken) return;
    apiRequest<PromptResponse>('/prompts', { token: accessToken })
      .then((data) => setPrompts(data.prompts || []))
      .catch(() => setPrompts([]));
  }, [accessToken]);

  useEffect(() => {
    if (!promptId) {
      setPromptContent('');
      return;
    }
    const found = prompts.find((prompt) => prompt.id === promptId);
    setPromptContent(found?.content || '');
  }, [promptId, prompts]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawInput((prev) => (prev ? `${prev}\n${text}` : text));
    event.target.value = '';
  };

  const handleSubmit = async () => {
    if (!accessToken) return;
    setError(null);
    if (detectedLinks.length === 0) {
      setError('Paste at least one EDRSR link (reyestr.court.gov.ua/Review/...).');
      return;
    }
    if (detectedLinks.length > MAX_LINKS) {
      setError(`Too many links (${detectedLinks.length}). Maximum is ${MAX_LINKS}.`);
      return;
    }

    setLoading(true);
    try {
      const selectedPrompt = prompts.find((prompt) => prompt.id === promptId);
      const payload = {
        links: detectedLinks.map((url) => ({ url })),
        prompt: promptContent.trim() || null,
        prompt_label: selectedPrompt?.name || null,
        auto_title_enabled: autoTitle,
        clientId: clientId || undefined,
      };
      const data = await apiRequest<{ success: boolean; jobId: string }>('/collect', {
        token: accessToken,
        method: 'POST',
        body: payload,
      });
      navigate(`/analyses/${data.jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create analysis';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Create analysis</h1>
          <p>Paste links from EDRSR and launch a new research job.</p>
        </div>
        <div className="pill-group">
          <span className="pill">Detected: {detectedLinks.length}</span>
          <span className={`pill pill-${status}`}>{status}</span>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">Input links</div>
              <div className="card__meta">
                One link per line. Only reyestr.court.gov.ua/Review URLs are used.
              </div>
            </div>
          </div>
          <div className="card__body stack">
            <textarea
              rows={10}
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="https://reyestr.court.gov.ua/Review/12345678"
            />
            <div className="row">
              <label className="file">
                <input type="file" accept=".csv,.txt" onChange={handleFile} />
                Import CSV/TXT
              </label>
              <div className="muted">
                {detectedLinks.length} unique links detected (max {MAX_LINKS}).
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">Prompt</div>
              <div className="card__meta">Choose a saved prompt or write your own.</div>
            </div>
          </div>
          <div className="card__body stack">
            <label className="field">
              <span>Prompt template</span>
              <select value={promptId} onChange={(event) => setPromptId(event.target.value)}>
                <option value="">Default prompt</option>
                {prompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Prompt text</span>
              <textarea
                rows={6}
                value={promptContent}
                onChange={(event) => setPromptContent(event.target.value)}
                placeholder="Optional custom prompt for this run"
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoTitle}
                onChange={(event) => setAutoTitle(event.target.checked)}
              />
              <span>Auto-generate analysis title</span>
            </label>
          </div>
        </div>
      </div>

      {error ? <div className="card card--error">{error}</div> : null}

      <div className="actions">
        <button className="btn btn-ghost" onClick={() => setRawInput('')} disabled={loading}>
          Clear
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Starting...' : 'Start analysis'}
        </button>
      </div>
    </div>
  );
}
