export const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  analyzing: 'Analyzing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  pending: 'Pending',
};

export function formatStatus(status?: string | null) {
  if (!status) return 'Unknown';
  return STATUS_LABELS[status] || status;
}

export function formatDate(value?: string | number | null) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateShort(value?: string | number | null) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
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
