import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { useAuth } from './state/AuthContext';
import { useLocale } from './state/LocaleContext';
import { AnalysesPage } from './pages/AnalysesPage';
import { CreateAnalysisPage } from './pages/CreateAnalysisPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { LoginPage } from './pages/LoginPage';
import { PromptsPage } from './pages/PromptsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { MattersPage } from './pages/MattersPage';
import { MatterDetailPage } from './pages/MatterDetailPage';
import { SharePage } from './pages/SharePage';

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/analyses" replace />} />
        <Route path="/analyses" element={<AnalysesPage />} />
        <Route path="/analyses/:jobId" element={<JobDetailPage />} />
        <Route path="/create" element={<CreateAnalysisPage />} />
        <Route path="/matters" element={<MattersPage />} />
        <Route path="/matters/:matterId" element={<MatterDetailPage />} />
        <Route path="/prompts" element={<PromptsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
