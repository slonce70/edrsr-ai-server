export function formatStatus(
  status?: string | null,
  labels: Record<string, string> = {},
  fallback = '—'
) {
  if (!status) return labels.unknown || fallback;
  return labels[status] || status;
}

// Canonical, locale-resolved status label map shared by every formatStatus call
// site (StatusBadge, AnalysesPage, JobDetailPage, MatterDetailPage). Keeping a
// single source prevents a renamed/added status from silently falling back to
// its raw English string in some places but not others.
export function statusLabels(t: (key: string) => string): Record<string, string> {
  return {
    queued: t('status.queued'),
    retrying: t('status.retrying'),
    processing: t('status.processing'),
    downloading: t('status.downloading'),
    analyzing: t('status.analyzing'),
    completed: t('status.completed'),
    error: t('status.error'),
    failed: t('status.failed'),
    cancelled: t('status.cancelled'),
    pending: t('status.pending'),
    unknown: t('status.unknown'),
  };
}

export function formatDate(value?: string | number | null, locale = 'uk-UA') {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateShort(value?: string | number | null, locale = 'uk-UA') {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export function formatDurationSeconds(seconds?: number | null) {
  if (!seconds && seconds !== 0) return '—';
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}m ${String(secs).padStart(2, '0')}s`;
}

export function formatCount(processed?: number | null, total?: number | null) {
  if (typeof total !== 'number') return '—';
  const done = typeof processed === 'number' ? processed : 0;
  return `${done} / ${total}`;
}
