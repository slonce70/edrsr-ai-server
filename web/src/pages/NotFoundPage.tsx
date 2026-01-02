import { Link } from 'react-router-dom';
import { useLocale } from '../state/LocaleContext';

export function NotFoundPage() {
  const { t } = useLocale();
  return (
    <div className="center">
      <h1>{t('common.notFoundTitle')}</h1>
      <p className="muted">{t('common.notFoundMessage')}</p>
      <Link className="btn btn-primary" to="/analyses">
        {t('common.goToAnalyses')}
      </Link>
    </div>
  );
}
