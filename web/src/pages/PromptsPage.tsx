import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../state/AuthContext';
import { EmptyState } from '../components/EmptyState';

type Prompt = {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type PromptResponse = {
  success: boolean;
  prompts: Prompt[];
  lastUpdated?: string | null;
};

const emptyForm = { id: '', name: '', content: '' };

export function PromptsPage() {
  const { accessToken } = useAuth();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const hasSelection = Boolean(form.id);

  const loadPrompts = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiRequest<PromptResponse>('/prompts', { token: accessToken });
      setPrompts(data.prompts || []);
      setLastUpdated(data.lastUpdated || null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleSelect = (prompt: Prompt) => {
    setForm({ id: prompt.id, name: prompt.name, content: prompt.content });
    setFormError(null);
  };

  const handleReset = () => {
    setForm(emptyForm);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!accessToken) return;
    if (!form.name.trim() || !form.content.trim()) {
      setFormError('Name and content are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (hasSelection) {
        await apiRequest(`/prompts/${form.id}`, {
          token: accessToken,
          method: 'PATCH',
          body: { name: form.name.trim(), content: form.content.trim() },
        });
      } else {
        await apiRequest(`/prompts`, {
          token: accessToken,
          method: 'POST',
          body: { name: form.name.trim(), content: form.content.trim() },
        });
      }
      await loadPrompts();
      setForm(emptyForm);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!accessToken || !form.id) return;
    if (!window.confirm('Delete this prompt?')) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiRequest(`/prompts/${form.id}`, { token: accessToken, method: 'DELETE' });
      await loadPrompts();
      setForm(emptyForm);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const payload = prompts.map((prompt) => ({ name: prompt.name, content: prompt.content }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edrsr-prompts.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !accessToken) return;
    setSaving(true);
    setFormError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed?.prompts;
      const promptsPayload = (list || [])
        .filter((item: Prompt) => item && item.name && item.content)
        .map((item: Prompt) => ({ name: item.name, content: item.content }));
      if (!promptsPayload.length) {
        throw new Error('No prompts found in file');
      }
      await apiRequest('/prompts/import', {
        token: accessToken,
        method: 'POST',
        body: { prompts: promptsPayload },
      });
      await loadPrompts();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to import prompts');
    } finally {
      setSaving(false);
      event.target.value = '';
    }
  };

  const preview = useMemo(() => {
    if (!form.content) return '';
    return form.content.length > 160 ? `${form.content.slice(0, 160)}...` : form.content;
  }, [form.content]);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Prompts</h1>
          <p>Manage prompt templates shared with the extension and the web portal.</p>
        </div>
        <div className="actions">
          <label className="file">
            <input type="file" accept="application/json" onChange={handleImport} />
            Import JSON
          </label>
          <button className="btn btn-ghost" onClick={handleExport} disabled={!prompts.length}>
            Export
          </button>
        </div>
      </div>
      {loadError ? <div className="card card--error">{loadError}</div> : null}

      {loading ? (
        <div className="card">Loading prompts...</div>
      ) : prompts.length === 0 ? (
        <EmptyState
          title="No prompts yet"
          message="Create your first prompt to reuse it across analyses."
        />
      ) : (
        <div className="grid grid--two">
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">Library</div>
                <div className="card__meta">
                  {prompts.length} prompts
                  {lastUpdated ? ` • Updated ${new Date(lastUpdated).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
            <div className="card__body list">
              {prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  className={`list__row list__row--button${
                    form.id === prompt.id ? ' list__row--active' : ''
                  }`}
                  onClick={() => handleSelect(prompt)}
                >
                  <div>
                    <div className="card__title">{prompt.name}</div>
                    <div className="card__meta">
                      {prompt.updated_at ? new Date(prompt.updated_at).toLocaleString() : ''}
                    </div>
                  </div>
                  <span className="pill">Edit</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">{hasSelection ? 'Edit prompt' : 'New prompt'}</div>
                <div className="card__meta">{preview || 'Fill details to preview'}</div>
              </div>
            </div>
            <div className="card__body stack">
              <label className="field">
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Content</span>
                <textarea
                  rows={8}
                  value={form.content}
                  onChange={(event) => setForm({ ...form, content: event.target.value })}
                />
              </label>
              {formError ? <div className="form__error">{formError}</div> : null}
              <div className="actions">
                <button className="btn btn-ghost" onClick={handleReset} disabled={saving}>
                  Reset
                </button>
                {hasSelection ? (
                  <button className="btn btn-ghost" onClick={handleDelete} disabled={saving}>
                    Delete
                  </button>
                ) : null}
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
