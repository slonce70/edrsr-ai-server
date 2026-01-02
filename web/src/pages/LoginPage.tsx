import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { APP_NAME } from '../lib/config';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';

export function LoginPage() {
  const { user, signIn, signUp, sendMagicLink, resetPassword } = useAuth();
  const { t, locale, setLocale, labels } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magic' | 'signup' | 'reset'>('password');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/analyses" replace />;

  const handleModeChange = (next: typeof mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    if (next !== 'password') setPassword('');
  };

  const mapAuthError = (message: string) => {
    const lower = message.toLowerCase();
    if (
      lower.includes('invalid login credentials') ||
      lower.includes('invalid email or password')
    ) {
      return t('errors.invalidCredentials');
    }
    if (lower.includes('email not confirmed')) return t('errors.emailNotConfirmed');
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return t('errors.rateLimited');
    }
    return t('errors.generic');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    let result: { error?: string } | null = null;
    if (mode === 'password') {
      result = await signIn(email, password);
    } else if (mode === 'magic') {
      result = await sendMagicLink(email);
      if (!result?.error) setNotice(t('login.magicSent'));
    } else if (mode === 'signup') {
      result = await signUp(email);
      if (!result?.error) setNotice(t('login.magicSent'));
    } else if (mode === 'reset') {
      result = await resetPassword(email);
      if (!result?.error) setNotice(t('login.resetSent'));
    }
    if (result?.error) setError(mapAuthError(result.error));
    setLoading(false);
  };

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__locale">
          <select value={locale} onChange={(event) => setLocale(event.target.value as 'uk' | 'ru')}>
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="login__brand">
          <div className="brand__mark">EA</div>
          <div>
            <div className="brand__name">{APP_NAME}</div>
            <div className="brand__tag">{t('app.tagline')}</div>
          </div>
        </div>
        <h1 className="login__title">{t('login.title')}</h1>
        <p className="login__subtitle">{t('login.subtitle')}</p>
        <div className="login__tabs">
          {(['password', 'magic', 'signup', 'reset'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab${mode === tab ? ' tab--active' : ''}`}
              onClick={() => handleModeChange(tab)}
            >
              {tab === 'password'
                ? t('login.passwordTab')
                : tab === 'magic'
                  ? t('login.magicTab')
                  : tab === 'signup'
                    ? t('login.signupTab')
                    : t('login.resetTab')}
            </button>
          ))}
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>{t('login.emailLabel')}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('login.emailPlaceholder')}
              required
            />
          </label>
          {mode === 'password' ? (
            <label className="field">
              <span>{t('login.passwordLabel')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                required
              />
            </label>
          ) : null}
          {error ? <div className="form__error">{error}</div> : null}
          {notice ? <div className="form__notice">{notice}</div> : null}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading
              ? mode === 'password'
                ? t('login.signingIn')
                : t('common.loading')
              : mode === 'password'
                ? t('login.signIn')
                : mode === 'magic'
                  ? t('login.sendLink')
                  : mode === 'signup'
                    ? t('login.signUp')
                    : t('login.sendReset')}
          </button>
        </form>
        <div className="login__footer">{t('login.footer')}</div>
      </div>
    </div>
  );
}
