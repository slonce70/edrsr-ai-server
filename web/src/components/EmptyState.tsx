import { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  message?: string;
  action?: ReactNode;
};

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {message ? <div className="empty__message">{message}</div> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}
