import { formatStatus } from '../lib/format';
import { useLocale } from '../state/LocaleContext';

type StatusBadgeProps = {
  status?: string | null;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useLocale();
  const safeStatus = status || 'unknown';
  const label = formatStatus(safeStatus, {
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
  });
  return <span className={`badge badge-${safeStatus}`}>{label}</span>;
}
