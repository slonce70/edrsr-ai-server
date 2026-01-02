import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { APP_NAME, API_BASE } from '../lib/config';
import { useAuth } from '../state/AuthContext';

type MeResponse = {
  success: boolean;
  user: { id: string; email: string };
};

type HealthResponse = {
  status: string;
};

export function SettingsPage() {
  const { accessToken, user } = useAuth();
  const [serverUser, setServerUser] = useState<MeResponse['user'] | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    apiRequest<MeResponse>('/me', { token: accessToken })
      .then((data) => setServerUser(data.user))
      .catch(() => setServerUser(null));
  }, [accessToken]);

  useEffect(() => {
    apiRequest<HealthResponse>('/health/light')
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Account and environment details for {APP_NAME}.</p>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">Account</div>
              <div className="card__meta">Supabase session details.</div>
            </div>
          </div>
          <div className="card__body stats">
            <div>
              <span>Email</span>
              <strong>{user?.email || '—'}</strong>
            </div>
            <div>
              <span>User ID</span>
              <strong className="mono">{user?.id || '—'}</strong>
            </div>
            <div>
              <span>Server profile</span>
              <strong>{serverUser?.email || 'Not loaded'}</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <div>
              <div className="card__title">API status</div>
              <div className="card__meta">Connected to {API_BASE}</div>
            </div>
          </div>
          <div className="card__body stats">
            <div>
              <span>Status</span>
              <strong>{health?.status || 'Unknown'}</strong>
            </div>
            <div>
              <span>Help</span>
              <strong>support@edrsr-ai-server.fun</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
