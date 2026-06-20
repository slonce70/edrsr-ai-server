import { APP_NAME } from '../lib/config';
import { useLocale } from '../state/LocaleContext';

// Shared brand lockup (avatar mark + wordmark + tagline). Reused by the
// authenticated sidebar (AppLayout) and the public SharePage masthead so the
// brand stays consistent across the app and the client-facing deliverable.
export function Brand({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <div className={className ? `brand ${className}` : 'brand'}>
      <div className="brand__mark">EA</div>
      <div>
        <div className="brand__name">{APP_NAME}</div>
        <div className="brand__tag">{t('app.sidebarTagline')}</div>
      </div>
    </div>
  );
}
