// Pure, deterministic report-coverage derivation.
// Tells a lawyer whether the analysis covered every case at a glance.

export type Completeness = {
  processed: number;
  total: number;
  failed: number;
  pct: number;
  complete: boolean;
};

const PROCESSED_STATUSES = new Set(['processed', 'completed']);
const FAILED_STATUSES = new Set(['error', 'failed']);

type DeriveInput = {
  processedLinks?: number | null;
  totalLinks?: number | null;
  links?: { status: string }[];
  qualityPartial?: boolean;
};

function safeCount(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function deriveCompleteness(input: DeriveInput): Completeness {
  const { processedLinks, totalLinks, links, qualityPartial } = input;

  const hasLinks = Array.isArray(links) && links.length > 0;

  // Total: prefer the explicit count, else the number of links.
  const totalFromLinks = Array.isArray(links) ? links.length : 0;
  const total = safeCount(totalLinks) ?? totalFromLinks;

  // Processed: prefer the explicit count, else count processed/completed links.
  const processedFromLinks = hasLinks
    ? links.filter((link) => PROCESSED_STATUSES.has(link.status)).length
    : 0;
  let processed = safeCount(processedLinks) ?? processedFromLinks;
  // Never report more processed than total.
  if (total > 0) processed = Math.min(processed, total);

  // Failed: count error/failed links, else infer from the processed/total gap.
  let failed = hasLinks
    ? links.filter((link) => FAILED_STATUSES.has(link.status)).length
    : 0;
  if (!hasLinks && total > 0 && processed < total) {
    failed = total - processed;
  }

  const pct = total > 0 ? (processed / total) * 100 : 0;
  const complete = total > 0 && processed >= total && !qualityPartial && failed === 0;

  return { processed, total, failed, pct, complete };
}
