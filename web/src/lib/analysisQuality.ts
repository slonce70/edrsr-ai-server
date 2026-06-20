export type AnalysisQualityLevel = 'ok' | 'partial';
export type AnalysisQuality = { level: AnalysisQualityLevel; coverage: number | null };

export type JobQuality = {
  analyzed: boolean;
  total: number;
  cited: number;
  coverage: number | null;
  partial: boolean;
};

// Markers emitted by the backend quality footer / fallback summaries.
// NOTE: do NOT use 'ЗВІТ КОНТРОЛЮ ЯКОСТІ' — it appears on EVERY report.
const SKIPPED_BATCH = 'Частина справ не була проаналізована';
const QC_PROBLEMS = 'Виявлені проблеми';
const COVERAGE_RE = /Покриття даних[^\d]{0,12}(\d{1,3})\s*%/;

export function analyzeReportQuality(markdown: string | null | undefined): AnalysisQuality {
  const text = markdown || '';
  let coverage: number | null = null;

  const match = text.match(COVERAGE_RE);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) coverage = parsed;
  }

  const hasFailureMarker = text.includes(SKIPPED_BATCH) || text.includes(QC_PROBLEMS);
  const coverageBelow100 = coverage !== null && coverage < 100;

  return {
    level: hasFailureMarker || coverageBelow100 ? 'partial' : 'ok',
    coverage,
  };
}
