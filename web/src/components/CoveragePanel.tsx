import type { JobQuality } from '../lib/analysisQuality';
import type { Completeness } from '../lib/reportCoverage';
import { useLocale } from '../state/LocaleContext';
import { ProgressBar } from './ProgressBar';

type CoveragePanelProps = {
  completeness: Completeness;
  quality?: JobQuality | null;
  onRetry?: () => void;
  retrying?: boolean;
};

export function CoveragePanel({ completeness, quality, onRetry, retrying }: CoveragePanelProps) {
  const { t } = useLocale();
  const { processed, total, failed, pct, complete } = completeness;

  const processedLabel = t('job.coverageProcessed', { processed, total });
  const coverage = quality?.coverage;
  const showCoveragePercent = !complete && typeof coverage === 'number';

  const ariaParts = [
    complete ? t('job.reportComplete') : t('job.reportIncomplete'),
    processedLabel,
  ];
  if (!complete && failed > 0) ariaParts.push(t('job.coverageFailed', { failed }));
  const ariaLabel = ariaParts.join('. ');

  const meterTone = complete ? 'success' : failed > 0 ? 'error' : 'busy';

  return (
    <div className="coverage-panel">
      <div
        className={`coverage-state coverage-state--${complete ? 'complete' : 'incomplete'}`}
        aria-label={ariaLabel}
      >
        <span className="coverage-state__icon" aria-hidden="true">
          {complete ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          )}
        </span>
        <span className="coverage-state__text">
          <strong>{complete ? t('job.reportComplete') : t('job.reportIncomplete')}</strong>
          <span className="coverage-state__detail">
            {processedLabel}
            {!complete && failed > 0 ? ` · ${t('job.coverageFailed', { failed })}` : ''}
            {showCoveragePercent
              ? ` · ${t('job.coveragePercent', { pct: Math.round(coverage as number) })}`
              : ''}
          </span>
        </span>
      </div>

      <div
        className={`coverage-meter coverage-meter--${meterTone}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={ariaLabel}
      >
        <ProgressBar value={pct} />
      </div>

      {!complete && onRetry ? (
        <button
          type="button"
          className="btn btn-primary coverage-panel__retry"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? t('job.retrying') : t('job.retryAnalysis')}
        </button>
      ) : null}
    </div>
  );
}
