import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setError(t('reset.invalid'));
      }
    });
  }, [t]);

  const handleSubmit = async () => {
    setError(null);
    if (!password || password !== confirm) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    setLoading(true);
    const result = await updatePassword(password);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
    setTimeout(() => navigate('/analyses'), 800);
  };

  return (
    <div className="login">
      <div className="login__panel">
        <h1 className="login__title">{t('reset.title')}</h1>
        <p className="login__subtitle">{t('reset.subtitle')}</p>
        <div className="form stack">
          <label className="field">
            <span>{t('reset.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          <label className="field">
            <span>{t('reset.confirm')}</span>
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error ? <div className="form__error">{error}</div> : null}
          {success ? <div className="form__notice">{t('reset.success')}</div> : null}
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? t('reset.updating') : t('reset.update')}
          </button>
        </div>
      </div>
    </div>
  );
}
