import { analyzeReportQuality } from '../lib/analysisQuality';
import type { JobQuality } from '../lib/analysisQuality';
import { useLocale } from '../state/LocaleContext';

type ReportStatusBannerProps = {
  markdown?: string | null;
  quality?: JobQuality | null;
};

export function ReportStatusBanner({ markdown, quality }: ReportStatusBannerProps) {
  const { t } = useLocale();

  let partial: boolean;
  let coverage: number | null;

  if (quality) {
    partial = quality.partial;
    coverage = quality.coverage;
  } else {
    const textQuality = analyzeReportQuality(markdown);
    partial = textQuality.level === 'partial';
    coverage = textQuality.coverage;
  }

  if (!partial) return null;

  const coverageText = coverage !== null ? t('job.quality.coverage', { coverage }) : '';

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
