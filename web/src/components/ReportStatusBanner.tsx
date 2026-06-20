import { analyzeReportQuality } from '../lib/analysisQuality';
import { useLocale } from '../state/LocaleContext';

type ReportStatusBannerProps = {
  markdown?: string | null;
};

export function ReportStatusBanner({ markdown }: ReportStatusBannerProps) {
  const { t } = useLocale();
  const quality = analyzeReportQuality(markdown);

  if (quality.level === 'ok') return null;

  const coverageText =
    quality.coverage !== null ? t('job.quality.coverage', { coverage: quality.coverage }) : '';

  return (
    <div className="report-banner report-banner--warning" role="alert">
      <strong>{t('job.quality.partialTitle')}</strong>
      <span>
        {t('job.quality.partialBody')}
        {coverageText ? ` ${coverageText}` : ''}
      </span>
    </div>
  );
}
