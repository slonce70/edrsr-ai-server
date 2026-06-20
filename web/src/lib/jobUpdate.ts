const JOB_UPDATE_FIELDS = [
  'status',
  'progress',
  'processed_links',
  'total_links',
  'title',
  'duration',
  'error_message',
] as const;

export function mergeJobUpdate<T extends Record<string, unknown>>(
  prev: T,
  payload: Record<string, unknown>
): T {
  const next: Record<string, unknown> = { ...prev };
  for (const key of JOB_UPDATE_FIELDS) {
    if (key in payload && payload[key] !== undefined) {
      next[key] = payload[key];
    }
  }
  return next as T;
}
