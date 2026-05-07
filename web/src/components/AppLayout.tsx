import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { APP_NAME } from '../lib/config';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { status } = useWebSocket();
  const { t, locale, setLocale, labels } = useLocale();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { to: '/analyses', label: t('nav.analyses') },
    { to: '/create', label: t('nav.create') },
    { to: '/matters', label: t('nav.matters') },
    { to: '/prompts', label: t('nav.prompts') },
    { to: '/share-links', label: t('nav.shareLinks') },
    { to: '/settings', label: t('nav.settings') },
  ];

  const statusLabel =
    status === 'connected'
      ? t('status.connected')
      : status === 'connecting'
        ? t('status.connecting')
        : t('status.offline');

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`drawer-backdrop${isSidebarOpen ? ' drawer-backdrop--open' : ''}`}
        aria-label={t('nav.closeMenu')}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`sidebar${isSidebarOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__header">
          <div className="brand">
            <div className="brand__mark">EA</div>
            <div>
              <div className="brand__name">{APP_NAME}</div>
              <div className="brand__tag">{t('app.sidebarTagline')}</div>
            </div>
          </div>
          <button
            type="button"
            className="icon-button sidebar__close"
            aria-label={t('nav.closeMenu')}
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="workspace-switch">
          <label className="workspace-switch__label">{t('settings.workspaceLabel')}</label>
          <select
            value={activeWorkspaceId || ''}
            onChange={(event) => setActiveWorkspaceId(event.target.value || null)}
            disabled={!workspaces.length}
          >
            {workspaces.length === 0 ? (
              <option value="">{t('common.loading')}</option>
            ) : (
              workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))
            )}
          </select>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="status">
            <span className={`status__dot status__dot--${status}`} />
            <span className="status__label">{statusLabel}</span>
          </div>
          <div className="user-chip">
            <div className="user-chip__label">{user?.email || t('status.unknown')}</div>
            <button className="btn btn-ghost" onClick={() => signOut()}>
              {t('common.signOut')}
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="icon-button topbar__menu"
              aria-label={t('nav.openMenu')}
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <div className="topbar__title">{APP_NAME}</div>
          </div>
          <div className="topbar__actions">
            <span className={`pill pill-${status}`}>{statusLabel}</span>
            <select
              className="locale-switch"
              value={locale}
              onChange={(event) => setLocale(event.target.value as 'uk' | 'ru')}
            >
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
