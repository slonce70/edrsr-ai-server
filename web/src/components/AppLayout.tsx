import { NavLink, Outlet } from 'react-router-dom';
import { APP_NAME } from '../lib/config';
import { useAuth } from '../state/AuthContext';
import { useWebSocket } from '../state/WebSocketContext';

const navItems = [
  { to: '/analyses', label: 'Analyses' },
  { to: '/create', label: 'Create' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/settings', label: 'Settings' },
];

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { status } = useWebSocket();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark">EA</div>
          <div>
            <div className="brand__name">{APP_NAME}</div>
            <div className="brand__tag">Legal research workspace</div>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="status">
            <span className={`status__dot status__dot--${status}`} />
            <span className="status__label">
              {status === 'connected' ? 'Live updates' : 'Offline'}
            </span>
          </div>
          <div className="user-chip">
            <div className="user-chip__label">{user?.email || 'Unknown user'}</div>
            <button className="btn btn-ghost" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar__title">{APP_NAME}</div>
          <div className="topbar__actions">
            <span className={`pill pill-${status}`}>{status}</span>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
