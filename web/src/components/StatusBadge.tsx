import { formatStatus, statusLabels } from '../lib/format';
import { useLocale } from '../state/LocaleContext';

type StatusBadgeProps = {
  status?: string | null;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useLocale();
  const safeStatus = status || 'unknown';
  const label = formatStatus(safeStatus, statusLabels(t));
  return <span className={`badge badge-${safeStatus}`}>{label}</span>;
}
