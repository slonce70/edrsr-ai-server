import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { API_BASE } from '../lib/config';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWorkspace } from '../state/WorkspaceContext';

type HealthResponse = {
  status: string;
};

type Member = {
  user_id: string;
  role: string;
  email?: string | null;
};

export function SettingsPage() {
  const { accessToken, user } = useAuth();
  const { t } = useLocale();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  useDocumentTitle(t('settings.title'));
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<HealthResponse>('/health/light')
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  const loadMembers = useCallback(async () => {
    if (!accessToken || !activeWorkspaceId) return;
    setMembersLoading(true);
    setMembersError(null);
    try {
      const data = await apiRequest<{ success: boolean; members: Member[] }>(
        `/workspaces/${activeWorkspaceId}/members`,
        { token: accessToken, workspaceId: activeWorkspaceId }
      );
      setMembers(data.members || []);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : t('errors.generic'));
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [accessToken, activeWorkspaceId, t]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleAddMember = async () => {
    if (!accessToken || !activeWorkspaceId || !memberEmail.trim()) return;
    try {
      await apiRequest(`/workspaces/${activeWorkspaceId}/members`, {
        token: accessToken,
        method: 'POST',
        body: { email: memberEmail.trim(), role: memberRole },
        workspaceId: activeWorkspaceId,
      });
      setMemberEmail('');
      setMemberRole('member');
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : t('errors.generic'));
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    if (!accessToken || !activeWorkspaceId) return;
    try {
      await apiRequest(`/workspaces/${activeWorkspaceId}/members/${userId}`, {
        token: accessToken,
        method: 'PATCH',
        body: { role },
        workspaceId: activeWorkspaceId,
      });
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : t('errors.generic'));
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!accessToken || !activeWorkspaceId) return;
    if (!window.confirm(t('settings.removeConfirm'))) return;
    try {
      await apiRequest(`/workspaces/${activeWorkspaceId}/members/${userId}`, {
        token: accessToken,
        method: 'DELETE',
        workspaceId: activeWorkspaceId,
      });
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : t('errors.generic'));
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('settings.account')}</div>
              <div className="card__meta">{t('settings.accountMeta')}</div>
            </div>
          </div>
          <div className="card__body stats">
            <div>
              <span>{t('common.email')}</span>
              <strong>{user?.email || '—'}</strong>
            </div>
            <div>
              <span>{t('settings.userId')}</span>
              <strong className="mono">{user?.id || '—'}</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">{t('settings.apiStatus')}</div>
              <div className="card__meta">{t('settings.apiMeta', { base: API_BASE })}</div>
            </div>
          </div>
          <div className="card__body stats">
            <div>
              <span>{t('common.status')}</span>
              <strong>{health?.status || t('status.unknown')}</strong>
            </div>
            <div>
              <span>{t('settings.help')}</span>
              <strong>support@edrsr-ai-server.fun</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">{t('settings.team')}</div>
            <div className="card__meta">{t('settings.teamMeta')}</div>
          </div>
        </div>
        <div className="card__body stack">
          <label className="field">
            <span>{t('settings.workspaceLabel')}</span>
            <select
              value={activeWorkspaceId || ''}
              onChange={(event) => setActiveWorkspaceId(event.target.value || null)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>

          <div className="row">
            <input
              className="input"
              value={memberEmail}
              onChange={(event) => setMemberEmail(event.target.value)}
              placeholder={t('settings.memberEmailPlaceholder')}
            />
            <select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
              <option value="member">{t('settings.roleMember')}</option>
              <option value="admin">{t('settings.roleAdmin')}</option>
            </select>
            <button className="btn btn-primary" onClick={handleAddMember}>
              {t('settings.addMember')}
            </button>
          </div>

          {membersError ? <div className="form__error">{membersError}</div> : null}
          {membersLoading ? (
            <div className="muted">{t('common.loading')}</div>
          ) : (
            <div className="list list--compact">
              {members.map((member) => (
                <div key={member.user_id} className="list__row">
                  <div>
                    <div>{member.email || member.user_id}</div>
                    <div className="meta">
                      {member.role === 'owner'
                        ? t('settings.roleOwner')
                        : member.role === 'admin'
                          ? t('settings.roleAdmin')
                          : t('settings.roleMember')}
                    </div>
                  </div>
                  <div className="row">
                    <select
                      value={member.role}
                      onChange={(event) => handleRoleChange(member.user_id, event.target.value)}
                    >
                      <option value="member">{t('settings.roleMember')}</option>
                      <option value="admin">{t('settings.roleAdmin')}</option>
                      <option value="owner">{t('settings.roleOwner')}</option>
                    </select>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleRemoveMember(member.user_id)}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
