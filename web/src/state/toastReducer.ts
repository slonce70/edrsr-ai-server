export type ToastVariant = 'success' | 'error' | 'info';

export type Toast = { id: string; message: string; variant: ToastVariant };

export type ToastAction =
  | { type: 'add'; toast: Toast }
  | { type: 'dismiss'; id: string }
  | { type: 'clear' };

export const MAX_TOASTS = 4;

export function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case 'add': {
      const next = [...state, action.toast];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    }
    case 'dismiss':
      return state.filter((toast) => toast.id !== action.id);
    case 'clear':
      return [];
    default:
      return state;
  }
}
