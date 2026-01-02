import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="center">
      <h1>Page not found</h1>
      <p className="muted">The page you requested does not exist.</p>
      <Link className="btn btn-primary" to="/analyses">
        Go to analyses
      </Link>
    </div>
  );
}
