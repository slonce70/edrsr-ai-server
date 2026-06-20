import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { Brand } from './components/Brand';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuth } from './state/AuthContext';
import { useLocale } from './state/LocaleContext';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage }))
);
const AnalysesPage = lazy(() =>
  import('./pages/AnalysesPage').then((module) => ({ default: module.AnalysesPage }))
);
const CreateAnalysisPage = lazy(() =>
  import('./pages/CreateAnalysisPage').then((module) => ({ default: module.CreateAnalysisPage }))
);
const JobDetailPage = lazy(() =>
  import('./pages/JobDetailPage').then((module) => ({ default: module.JobDetailPage }))
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage }))
);
const PromptsPage = lazy(() =>
  import('./pages/PromptsPage').then((module) => ({ default: module.PromptsPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage }))
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage }))
);
const MattersPage = lazy(() =>
  import('./pages/MattersPage').then((module) => ({ default: module.MattersPage }))
);
const MatterDetailPage = lazy(() =>
  import('./pages/MatterDetailPage').then((module) => ({ default: module.MatterDetailPage }))
);
const SharePage = lazy(() =>
  import('./pages/SharePage').then((module) => ({ default: module.SharePage }))
);
const ShareLinksPage = lazy(() =>
  import('./pages/ShareLinksPage').then((module) => ({ default: module.ShareLinksPage }))
);

function RouteFallback() {
  const { t } = useLocale();
  return (
    <div className="center">
      <div className="loader" />
      <div>{t('common.loading')}</div>
    </div>
  );
}

// Self-contained fallback for the PUBLIC /share route: no auth, no links into
// the private app. If a malformed shared report throws during render the client
// sees a branded "couldn't be displayed" card instead of a blank white app.
function SharePublicFallback() {
  const { t } = useLocale();
  return (
    <div className="share-view share-view--error">
      <Brand />
      <div className="card">
        <div className="card__body center" role="alert">
          <h1>{t('share.renderErrorTitle')}</h1>
          <p>{t('share.renderErrorMessage')}</p>
        </div>
      </div>
    </div>
  );
}

function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  const { t } = useLocale();

  if (isLoading) {
    return (
      <div className="center">
        <div className="loader" />
        <div>{t('common.loading')}</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <AppLayout />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route
          path="/share/:token"
          element={
            <ErrorBoundary fallback={<SharePublicFallback />}>
              <SharePage />
            </ErrorBoundary>
          }
        />
        <Route element={<ProtectedLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/analyses" element={<AnalysesPage />} />
          <Route path="/analyses/:jobId" element={<JobDetailPage />} />
          <Route path="/create" element={<CreateAnalysisPage />} />
          <Route path="/matters" element={<MattersPage />} />
          <Route path="/matters/:matterId" element={<MatterDetailPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/share-links" element={<ShareLinksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
