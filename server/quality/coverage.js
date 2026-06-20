const FAILURE_MARKERS = ['Частина справ не була проаналізована', 'Виявлені проблеми'];

/**
 * Compute real report coverage: how many of the job's source-case URLs are cited in the report.
 * @param {string|null} analysisText
 * @param {string[]} urls - source case URLs for the job
 * @returns {{ analyzed: boolean, total: number, cited: number, coverage: number|null, partial: boolean }}
 */
export function computeReportCoverage(analysisText, urls) {
  const text = String(analysisText || '');
  const list = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u.length > 0);
  const total = list.length;
  if (!text || total === 0) {
    return { analyzed: Boolean(text), total, cited: 0, coverage: null, partial: false };
  }
  const cited = list.filter((u) => text.includes(u)).length;
  const coverage = Math.round((cited / total) * 100);
  const hasFailureMarker = FAILURE_MARKERS.some((m) => text.includes(m));
  return { analyzed: true, total, cited, coverage, partial: coverage < 100 || hasFailureMarker };
}
