import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';

type Prompt = {
  id: string;
  name: string;
  content: string;
};

type PromptResponse = {
  success: boolean;
  prompts: Prompt[];
};

type PromptDefinitionsLocale = {
  groups?: Record<string, Record<string, string>>;
  descriptions?: Record<string, string>;
};

type PromptDefinitionsPayload = {
  version?: number;
  defaultLocale?: string;
  locales?: Record<string, PromptDefinitionsLocale>;
  groups?: Record<string, Record<string, string>>;
  descriptions?: Record<string, string>;
};

type PromptDefinitionsResponse = {
  success: boolean;
  definitions: PromptDefinitionsPayload | null;
};

type MatterSummary = {
  id: string;
  title: string;
};

type MattersResponse = {
  success: boolean;
  matters: MatterSummary[];
};

const MAX_LINKS = 300;
const BUILTIN_PROMPT_PREFIX = 'builtin:';

function pickDefinitionsForLocale(definitions: PromptDefinitionsPayload | null, locale: string) {
  if (!definitions) return null;
  if (definitions.groups && definitions.descriptions) {
    return {
      groups: definitions.groups || {},
      descriptions: definitions.descriptions || {},
    };
  }
  const locales = definitions.locales || {};
  const preferred =
    locales[locale] || locales[definitions.defaultLocale || 'uk'] || locales.uk || null;
  if (!preferred) return null;
  return {
    groups: preferred.groups || {},
    descriptions: preferred.descriptions || {},
  };
}

function findPromptLabel(groups: Record<string, Record<string, string>> | undefined, key: string) {
  if (!groups || !key) return null;
  for (const group of Object.values(groups)) {
    if (group && typeof group === 'object' && key in group) return group[key] || null;
  }
  return null;
}

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
  const { t, locale } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  useDocumentTitle(t('create.title'));
  const [rawInput, setRawInput] = useState('');
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [sharedPrompts, setSharedPrompts] = useState<Prompt[]>([]);
  const [promptSelection, setPromptSelection] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptDefinitionsRaw, setPromptDefinitionsRaw] = useState<PromptDefinitionsPayload | null>(
    null
  );
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [matterId, setMatterId] = useState('');
  const [autoTitle, setAutoTitle] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedLinks = useMemo(() => extractLinks(rawInput), [rawInput]);
  const promptDefinitions = useMemo(
    () => pickDefinitionsForLocale(promptDefinitionsRaw, locale),
    [promptDefinitionsRaw, locale]
  );
  const selectedBuiltinKey = useMemo(() => {
    if (!promptSelection.startsWith(BUILTIN_PROMPT_PREFIX)) return '';
    return promptSelection.slice(BUILTIN_PROMPT_PREFIX.length);
  }, [promptSelection]);
  const selectedBuiltinDescription = selectedBuiltinKey
    ? (promptDefinitions?.descriptions || {})[selectedBuiltinKey] || ''
    : '';

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const matterParam = params.get('matterId');
    if (matterParam) setMatterId(matterParam);
  }, [location.search]);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<PromptDefinitionsResponse>('/prompts/definitions', { signal: controller.signal })
      .then((data) => setPromptDefinitionsRaw(data.definitions || null))
      .catch(() => setPromptDefinitionsRaw(null));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    apiRequest<PromptResponse>('/prompts', { token: accessToken })
      .then((data) => setPrompts(data.prompts || []))
      .catch(() => setPrompts([]));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !activeWorkspaceId) {
      setSharedPrompts([]);
      return;
    }
    apiRequest<PromptResponse>('/prompts/shared', {
      token: accessToken,
      workspaceId: activeWorkspaceId,
    })
      .then((data) => setSharedPrompts(data.prompts || []))
      .catch(() => setSharedPrompts([]));
  }, [accessToken, activeWorkspaceId]);

  useEffect(() => {
    if (!accessToken || !activeWorkspaceId) return;
    apiRequest<MattersResponse>('/matters', {
      token: accessToken,
      workspaceId: activeWorkspaceId,
    })
      .then((data) => setMatters(data.matters || []))
      .catch(() => setMatters([]));
  }, [accessToken, activeWorkspaceId]);

  const allPrompts = useMemo(() => [...prompts, ...sharedPrompts], [prompts, sharedPrompts]);

  useEffect(() => {
    if (!promptSelection) {
      setPromptContent('');
      return;
    }
    if (promptSelection.startsWith(BUILTIN_PROMPT_PREFIX)) {
      setPromptContent('');
      return;
    }
    const found = allPrompts.find((prompt) => prompt.id === promptSelection);
    setPromptContent(found?.content || '');
  }, [promptSelection, allPrompts]);

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
      setError(t('create.errorNoLinks'));
      return;
    }
    if (detectedLinks.length > MAX_LINKS) {
      setError(t('create.errorTooMany', { count: detectedLinks.length, max: MAX_LINKS }));
      return;
    }

    setLoading(true);
    try {
      const selectedPrompt = allPrompts.find((prompt) => prompt.id === promptSelection);
      const isBuiltinPrompt = promptSelection.startsWith(BUILTIN_PROMPT_PREFIX);
      const builtinKey = isBuiltinPrompt ? promptSelection.slice(BUILTIN_PROMPT_PREFIX.length) : '';
      const builtinLabel = isBuiltinPrompt
        ? findPromptLabel(promptDefinitions?.groups, builtinKey)
        : null;

      const payload = {
        links: detectedLinks.map((url) => ({ url })),
        prompt: isBuiltinPrompt ? builtinKey || null : promptContent.trim() || null,
        prompt_label: isBuiltinPrompt
          ? builtinLabel || builtinKey || null
          : selectedPrompt?.name || null,
        auto_title_enabled: autoTitle,
        clientId: clientId || undefined,
        matterId: matterId || undefined,
        workspaceId: activeWorkspaceId || undefined,
      };
      const data = await apiRequest<{ success: boolean; jobId: string }>('/collect', {
        token: accessToken,
        method: 'POST',
        body: payload,
      });
      navigate(`/analyses/${data.jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('create.title')}</h1>
          <p>{t('create.subtitle')}</p>
        </div>
        <div className="pill-group">
          <span className="pill">{t('create.detected', { count: detectedLinks.length })}</span>
          <span className={`pill pill-${status}`}>
            {status === 'connected'
              ? t('status.connected')
              : status === 'connecting'
                ? t('status.connecting')
                : t('status.offline')}
          </span>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('create.inputTitle')}</div>
              <div className="card__meta">{t('create.inputMeta')}</div>
            </div>
          </div>
          <div className="card__body stack">
            <textarea
              rows={10}
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder={t('create.inputPlaceholder')}
            />
            <div className="row">
              <label className="file">
                <input type="file" accept=".csv,.txt" onChange={handleFile} />
                {t('create.import')}
              </label>
              <div className="muted">
                {t('create.detectedMeta', { count: detectedLinks.length, max: MAX_LINKS })}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('create.promptTitle')}</div>
              <div className="card__meta">{t('create.promptMeta')}</div>
            </div>
          </div>
          <div className="card__body stack">
            <label className="field">
              <span>{t('create.promptTemplate')}</span>
              <select
                value={promptSelection}
                onChange={(event) => setPromptSelection(event.target.value)}
              >
                <option value="">{t('create.promptDefault')}</option>
                {promptDefinitions?.groups
                  ? Object.entries(promptDefinitions.groups)
                      .map(([groupLabel, groupPrompts]) => {
                        const entries = Object.entries(groupPrompts || {}).filter(
                          ([key]) => key !== 'custom'
                        );
                        if (entries.length === 0) return null;
                        return (
                          <optgroup key={groupLabel} label={groupLabel}>
                            {entries.map(([key, label]) => (
                              <option key={key} value={`${BUILTIN_PROMPT_PREFIX}${key}`}>
                                {label}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })
                      .filter(Boolean)
                  : null}
                {prompts.length > 0 ? (
                  <optgroup label={t('create.promptMyGroup')}>
                    {prompts.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {sharedPrompts.length > 0 ? (
                  <optgroup label={t('create.promptSharedGroup')}>
                    {sharedPrompts.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            {selectedBuiltinDescription ? (
              <div className="muted">{selectedBuiltinDescription}</div>
            ) : null}
            <label className="field">
              <span>{t('create.matterLabel')}</span>
              <select value={matterId} onChange={(event) => setMatterId(event.target.value)}>
                <option value="">{t('create.matterPlaceholder')}</option>
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('create.promptText')}</span>
              <textarea
                rows={6}
                value={promptContent}
                onChange={(event) => setPromptContent(event.target.value)}
                placeholder={t('create.promptPlaceholder')}
                disabled={!!selectedBuiltinKey}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoTitle}
                onChange={(event) => setAutoTitle(event.target.checked)}
              />
              <span>{t('create.autoTitle')}</span>
            </label>
          </div>
        </div>
      </div>

      {error ? <div className="card card--error">{error}</div> : null}

      <div className="actions">
        <button className="btn btn-ghost" onClick={() => setRawInput('')} disabled={loading}>
          {t('create.clear')}
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? t('create.starting') : t('create.start')}
        </button>
      </div>
    </div>
  );
}
