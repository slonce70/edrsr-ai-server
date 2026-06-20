import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { APP_NAME } from '../lib/config';
import { createJobNotifyState, reduceJobEvent } from '../lib/jobNotifications';
import { resolveInitialTheme, type Theme } from '../lib/theme';
import { CommandPalette } from '../components/CommandPalette';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { KeyboardShortcuts } from '../components/KeyboardShortcuts';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { OverviewProvider, useOverview } from '../state/OverviewContext';
import { useToast } from '../state/ToastContext';
import { useWebSocket } from '../state/WebSocketContext';
import { useWorkspace } from '../state/WorkspaceContext';

export function AppLayout() {
  return (
    <OverviewProvider>
      <AppLayoutInner />
    </OverviewProvider>
  );
}

function AppLayoutInner() {
  const { user, signOut } = useAuth();
  const { status, onJobUpdate } = useWebSocket();
  const { activeCount } = useOverview();
  const { success } = useToast();
  const { t, locale, setLocale, labels } = useLocale();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(
      localStorage.getItem('edrsr-ai-theme'),
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    ),
  );
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('edrsr-ai-theme', theme);
  }, [theme]);

  // Global "analysis finished" notification: watch WS job-status updates app-wide
  // and toast once when a job we saw active this session transitions to completed.
  const notifyStateRef = useRef(createJobNotifyState());
  const tRef = useRef(t);
  const successRef = useRef(success);

  // Keep latest t/success in refs so the WS listener stays subscribed across
  // locale/toast re-renders instead of re-registering on every render.
  useEffect(() => {
    tRef.current = t;
    successRef.current = success;
  }, [t, success]);

  useEffect(() => {
    return onJobUpdate((payload) => {
      if (payload.type === 'CHAT_UPDATE') return;
      const result = reduceJobEvent(notifyStateRef.current, {
        id: typeof payload.id === 'string' ? payload.id : undefined,
        status: typeof payload.status === 'string' ? payload.status : undefined,
        title: typeof payload.title === 'string' ? payload.title : undefined,
      });
      if (result.notify) {
        const title = result.notify.title || tRef.current('analyses.untitled');
        successRef.current(tRef.current('job.finishedToast', { title }));
      }
    });
  }, [onJobUpdate]);

  const navItems = [
    { to: '/dashboard', label: t('nav.dashboard') },
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
            {activeCount > 0 ? (
              <Link
                to="/analyses?status=processing"
                className="pill pill-active-jobs"
                aria-label={t('topbar.activeJobsAria', { count: activeCount })}
                title={t('topbar.activeJobsAria', { count: activeCount })}
              >
                <span className="pill-active-jobs__dot" aria-hidden="true" />
                {t('topbar.activeJobs', { count: activeCount })}
              </Link>
            ) : null}
            <span className={`pill pill-${status}`}>{statusLabel}</span>
            <button
              type="button"
              className="btn btn-ghost cmdk-hint"
              aria-label={t('command.placeholder')}
              title={t('command.placeholder')}
              onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            >
              {t('command.hint')}
            </button>
            <button
              type="button"
              className="btn btn-ghost shortcuts-hint"
              aria-label={t('shortcuts.title')}
              title={t('shortcuts.title')}
              onClick={() => window.dispatchEvent(new Event('open-shortcuts-help'))}
            >
              ?
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={t('theme.toggle')}
              title={t('theme.toggle')}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
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
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        theme={theme}
      />
      <KeyboardShortcuts />
    </div>
  );
}
