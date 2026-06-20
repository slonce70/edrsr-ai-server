import type { Toast } from '../state/toastReducer';

type ToasterProps = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  dismissLabel: string;
};

export function Toaster({ toasts, onDismiss, dismissLabel }: ToasterProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.variant}`}>
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            aria-label={dismissLabel}
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
