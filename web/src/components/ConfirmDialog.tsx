import { useEffect, useId, useRef } from 'react';
import { useLocale } from '../state/LocaleContext';

type ConfirmDialogProps = {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Elements reachable by Tab while focus is trapped inside the dialog.
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// A reusable styled confirmation modal that replaces the blocking
// window.confirm(). Mirrors the HelpModal/CommandPalette overlay + focus-trap
// pattern: role="dialog" aria-modal, Escape/backdrop/Cancel resolve to cancel,
// Confirm resolves to confirm, focus moves into the dialog (the Cancel button
// for destructive actions) and is trapped, and the previous focus is restored
// on close.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();

  // Focus management + body scroll lock while open, mirroring HelpModal.
  // Default focus lands on Cancel for destructive actions so an accidental
  // Enter does not delete; otherwise it lands on Confirm.
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = (document.activeElement as HTMLElement) || null;
    const id = window.requestAnimationFrame(() => {
      const target = danger ? cancelRef.current : confirmRef.current;
      target?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.cancelAnimationFrame(id);
      document.body.style.overflow = previousOverflow;
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [open, danger]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    // Trap focus within the panel.
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const titleId = title ? `${baseId}-title` : undefined;
  const messageId = `${baseId}-message`;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        // Click on the dimmed backdrop (not the panel) cancels the dialog.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId ?? messageId}
        aria-describedby={messageId}
        onKeyDown={handleKeyDown}
      >
        {title ? (
          <h2 className="confirm-dialog__title" id={titleId}>
            {title}
          </h2>
        ) : null}
        <p className="confirm-dialog__message" id={messageId}>
          {message}
        </p>
        <div className="confirm-dialog__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
