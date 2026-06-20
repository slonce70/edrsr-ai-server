export const ACTIVE_STATUS_KEYS = [
  'queued',
  'retrying',
  'processing',
  'downloading',
  'analyzing',
  'pending',
] as const;

// Statuses that count toward the "error" bucket. We fold the terminal
// failure states ('error', 'failed') and explicit cancellation ('cancelled')
// together so the distribution bar surfaces all non-successful outcomes.
export const ERROR_STATUS_KEYS = ['error', 'failed', 'cancelled'] as const;

function safe(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function activeCount(statusCounts: Record<string, number>): number {
  return ACTIVE_STATUS_KEYS.reduce((sum, key) => sum + safe(statusCounts[key]), 0);
}

export type StatusSegmentKey = 'completed' | 'active' | 'error' | 'other';

export type StatusSegment = {
  key: StatusSegmentKey;
  count: number;
  pct: number;
};

export function statusSegments(
  statusCounts: Record<string, number>,
  total: number
): StatusSegment[] {
  const safeTotal = safe(total);
  const completed = safe(statusCounts.completed);
  const active = activeCount(statusCounts);
  const error = ERROR_STATUS_KEYS.reduce((sum, key) => sum + safe(statusCounts[key]), 0);
  const other = Math.max(0, safeTotal - completed - active - error);

  const buckets: Array<{ key: StatusSegmentKey; count: number }> = [
    { key: 'completed', count: completed },
    { key: 'active', count: active },
    { key: 'error', count: error },
    { key: 'other', count: other },
  ];

  return buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      key: bucket.key,
      count: bucket.count,
      pct: safeTotal > 0 ? (bucket.count / safeTotal) * 100 : 0,
    }));
}
