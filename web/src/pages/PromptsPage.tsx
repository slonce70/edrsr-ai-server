import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { apiRequest } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useToast } from '../state/ToastContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { SkeletonList } from '../components/Skeleton';

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
  const { t, dateLocale } = useLocale();
  const { success, error: toastError } = useToast();
  const { activeWorkspaceId, workspaces } = useWorkspace();
  useDocumentTitle(t('prompts.title'));
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [sharedPrompts, setSharedPrompts] = useState<Prompt[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'user' | 'shared'>('user');
  // Holds the message + confirmed action for the styled confirm dialog that
  // replaces the blocking window.confirm(). Null when no dialog is open.
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    danger?: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const hasSelection = Boolean(form.id);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId]
  );
  const canManageShared = ['owner', 'admin'].includes(activeWorkspace?.role || '');

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
      setLoadError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [accessToken, t]);

  const loadSharedPrompts = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId) {
      setSharedPrompts([]);
      setSharedLoading(false);
      return;
    }
    setSharedLoading(true);
    setSharedError(null);
    try {
      const data = await apiRequest<{ success: boolean; prompts: Prompt[] }>('/prompts/shared', {
        token: accessToken,
        workspaceId: activeWorkspaceId,
      });
      setSharedPrompts(data.prompts || []);
    } catch (err) {
      setSharedError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setSharedLoading(false);
    }
  }, [accessToken, activeWorkspaceId, t]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    loadSharedPrompts();
  }, [loadSharedPrompts]);

  useEffect(() => {
    setForm(emptyForm);
    setFormError(null);
    setFormNotice(null);
  }, [activeTab]);

  const handleSelect = (prompt: Prompt) => {
    setForm({ id: prompt.id, name: prompt.name, content: prompt.content });
    setFormError(null);
    setFormNotice(null);
  };

  const handleReset = () => {
    setForm(emptyForm);
    setFormError(null);
    setFormNotice(null);
  };

  const handleSave = async () => {
    if (!accessToken) return;
    if (!form.name.trim() || !form.content.trim()) {
      setFormError(t('prompts.errorRequired'));
      return;
    }
    setSaving(true);
    setFormError(null);
    setFormNotice(null);
    try {
      if (activeTab === 'shared') {
        if (!activeWorkspaceId) {
          setFormError(t('prompts.sharedNoWorkspace'));
          return;
        }
        if (!canManageShared) {
          setFormError(t('prompts.sharedReadOnly'));
          return;
        }
        if (hasSelection) {
          await apiRequest(`/prompts/shared/${form.id}`, {
            token: accessToken,
            method: 'PATCH',
            body: { name: form.name.trim(), content: form.content.trim() },
            workspaceId: activeWorkspaceId,
          });
        } else {
          await apiRequest(`/prompts/shared`, {
            token: accessToken,
            method: 'POST',
            body: { name: form.name.trim(), content: form.content.trim() },
            workspaceId: activeWorkspaceId,
          });
        }
        await loadSharedPrompts();
      } else {
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
      }
      setForm(emptyForm);
      success(t('prompts.saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setFormError(message);
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  const performDelete = async () => {
    if (!accessToken || !form.id) return;
    setSaving(true);
    setFormError(null);
    setFormNotice(null);
    try {
      if (activeTab === 'shared') {
        if (!activeWorkspaceId) {
          setFormError(t('prompts.sharedNoWorkspace'));
          return;
        }
        if (!canManageShared) {
          setFormError(t('prompts.sharedReadOnly'));
          return;
        }
        await apiRequest(`/prompts/shared/${form.id}`, {
          token: accessToken,
          method: 'DELETE',
          workspaceId: activeWorkspaceId,
        });
        await loadSharedPrompts();
      } else {
        await apiRequest(`/prompts/${form.id}`, { token: accessToken, method: 'DELETE' });
        await loadPrompts();
      }
      setForm(emptyForm);
      success(t('prompts.deleted'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setFormError(message);
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!accessToken || !form.id) return;
    setPendingConfirm({
      message: t('prompts.confirmDelete'),
      danger: true,
      confirmLabel: t('common.remove'),
      onConfirm: () => {
        setPendingConfirm(null);
        void performDelete();
      },
    });
  };

  const handleShareToWorkspace = async () => {
    if (!accessToken || !form.id) return;
    if (!activeWorkspaceId) {
      setFormError(t('prompts.sharedNoWorkspace'));
      return;
    }
    if (!canManageShared) {
      setFormError(t('prompts.sharedReadOnly'));
      return;
    }
    setSaving(true);
    setFormError(null);
    setFormNotice(null);
    try {
      const result = await apiRequest<{ success: boolean; renamed?: boolean }>(
        '/prompts/shared/from-user',
        {
          token: accessToken,
          method: 'POST',
          body: { promptId: form.id },
          workspaceId: activeWorkspaceId,
        }
      );
      await loadSharedPrompts();
      const notice = result?.renamed ? t('prompts.shareRenamed') : t('prompts.shareSuccess');
      setFormNotice(notice);
      success(notice);
      setActiveTab('shared');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setFormError(message);
      toastError(message);
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
        throw new Error(t('prompts.errorImportEmpty'));
      }
      await apiRequest('/prompts/import', {
        token: accessToken,
        method: 'POST',
        body: { prompts: promptsPayload },
      });
      await loadPrompts();
      success(t('prompts.imported'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setFormError(message);
      toastError(message);
    } finally {
      setSaving(false);
      event.target.value = '';
    }
  };

  const preview = useMemo(() => {
    if (!form.content) return '';
    return form.content.length > 160 ? `${form.content.slice(0, 160)}...` : form.content;
  }, [form.content]);

  const isSharedView = activeTab === 'shared';
  const visiblePrompts = isSharedView ? sharedPrompts : prompts;
  const isLoadingList = isSharedView ? sharedLoading : loading;
  const listError = isSharedView ? sharedError : loadError;
  const isReadOnlyShared = isSharedView && !canManageShared;

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('prompts.title')}</h1>
          <p>{t('prompts.subtitle')}</p>
          <div className="pill-group">
            <button
              className={`pill pill--button${!isSharedView ? ' pill--active' : ''}`}
              type="button"
              onClick={() => setActiveTab('user')}
            >
              {t('prompts.tabMy')}
            </button>
            <button
              className={`pill pill--button${isSharedView ? ' pill--active' : ''}`}
              type="button"
              onClick={() => setActiveTab('shared')}
            >
              {t('prompts.tabShared')}
            </button>
          </div>
        </div>
        {!isSharedView ? (
          <div className="actions">
            <label className="file">
              <input type="file" accept="application/json" onChange={handleImport} />
              {t('prompts.import')}
            </label>
            <button className="btn btn-ghost" onClick={handleExport} disabled={!prompts.length}>
              {t('prompts.export')}
            </button>
          </div>
        ) : null}
      </div>
      {listError ? <div className="card card--error">{listError}</div> : null}

      {isLoadingList ? (
        <div className="stack" aria-busy="true">
          <span className="sr-only">{t('prompts.loading')}</span>
          <SkeletonList count={5} />
        </div>
      ) : visiblePrompts.length === 0 ? (
        <EmptyState
          title={isSharedView ? t('prompts.sharedEmptyTitle') : t('prompts.emptyTitle')}
          message={isSharedView ? t('prompts.sharedEmptyMessage') : t('prompts.emptyMessage')}
        />
      ) : (
        <div className="grid grid--two">
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">
                  {isSharedView ? t('prompts.sharedLibrary') : t('prompts.library')}
                </div>
                <div className="card__meta">
                  {visiblePrompts.length} {t('prompts.countLabel')}
                  {!isSharedView && lastUpdated
                    ? ` • ${new Date(lastUpdated).toLocaleString(dateLocale)}`
                    : ''}
                </div>
              </div>
            </div>
            <div className="card__body list">
              {visiblePrompts.map((prompt) => (
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
                      {prompt.updated_at
                        ? new Date(prompt.updated_at).toLocaleString(dateLocale)
                        : ''}
                    </div>
                  </div>
                  <span className="pill">
                    {isSharedView ? t('prompts.sharedLabel') : t('prompts.edit')}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">
                  {hasSelection
                    ? isSharedView
                      ? t('prompts.sharedEditPrompt')
                      : t('prompts.editPrompt')
                    : isSharedView
                      ? t('prompts.sharedNewPrompt')
                      : t('prompts.newPrompt')}
                </div>
                <div className="card__meta">{preview || t('prompts.previewEmpty')}</div>
              </div>
            </div>
            <div className="card__body stack">
              <label className="field">
                <span>{t('prompts.name')}</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  disabled={saving || isReadOnlyShared}
                />
              </label>
              <label className="field">
                <span>{t('prompts.content')}</span>
                <textarea
                  rows={8}
                  value={form.content}
                  onChange={(event) => setForm({ ...form, content: event.target.value })}
                  disabled={saving || isReadOnlyShared}
                />
              </label>
              {formNotice ? <div className="form__notice">{formNotice}</div> : null}
              {formError ? <div className="form__error">{formError}</div> : null}
              {isReadOnlyShared ? (
                <div className="form__note">{t('prompts.sharedReadOnly')}</div>
              ) : null}
              <div className="actions">
                <button className="btn btn-ghost" onClick={handleReset} disabled={saving}>
                  {t('prompts.reset')}
                </button>
                {!isSharedView && hasSelection ? (
                  <button
                    className="btn btn-ghost"
                    onClick={handleShareToWorkspace}
                    disabled={saving || !canManageShared}
                    title={canManageShared ? '' : t('prompts.sharedReadOnly')}
                  >
                    {t('prompts.shareToWorkspace')}
                  </button>
                ) : null}
                {hasSelection ? (
                  <button
                    className="btn btn-ghost"
                    onClick={handleDelete}
                    disabled={saving || isReadOnlyShared}
                  >
                    {t('prompts.delete')}
                  </button>
                ) : null}
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || isReadOnlyShared}
                >
                  {saving ? t('prompts.saving') : t('prompts.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingConfirm}
        message={pendingConfirm?.message ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel}
        danger={pendingConfirm?.danger}
        onConfirm={() => pendingConfirm?.onConfirm()}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
