import { formatStatus } from '../lib/format';

type StatusBadgeProps = {
  status?: string | null;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const safeStatus = status || 'unknown';
  return <span className={`badge badge-${safeStatus}`}>{formatStatus(safeStatus)}</span>;
}
