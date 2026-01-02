import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { APP_NAME } from '../lib/config';
import { useAuth } from '../state/AuthContext';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/analyses" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn(email, password);
    if (result?.error) {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <div className="brand__mark">EA</div>
          <div>
            <div className="brand__name">{APP_NAME}</div>
            <div className="brand__tag">Secure workspace for case analysis</div>
          </div>
        </div>
        <h1 className="login__title">Welcome back</h1>
        <p className="login__subtitle">Sign in with the same account used in the extension.</p>
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@firm.com"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error ? <div className="form__error">{error}</div> : null}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className="login__footer">
          Need access? Ask your administrator to enable your account.
        </div>
      </div>
    </div>
  );
}
