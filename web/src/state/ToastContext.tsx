/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { Toaster } from '../components/Toaster';
import { translations } from '../i18n/strings';
import { toastReducer, type Toast, type ToastVariant } from './toastReducer';

const AUTO_DISMISS_MS = 5000;
const ERROR_DISMISS_MS = 8000;
const LOCALE_STORAGE_KEY = 'edrsr-ai-locale';

let seq = 0;
const nextId = () => `t${++seq}`;

function resolveDismissLabel(): string {
  const stored =
    typeof window !== 'undefined' ? window.localStorage.getItem(LOCALE_STORAGE_KEY) : null;
  const locale = stored === 'ru' ? 'ru' : 'uk';
  return translations[locale].common.dismiss;
}

type ToastContextValue = {
  toasts: Toast[];
  notify: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    dispatch({ type: 'dismiss', id });
  }, []);

  const notify = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = nextId();
      dispatch({ type: 'add', toast: { id, message, variant } });
      const delay = variant === 'error' ? ERROR_DISMISS_MS : AUTO_DISMISS_MS;
      const timer = setTimeout(() => {
        timers.current.delete(id);
        dispatch({ type: 'dismiss', id });
      }, delay);
      timers.current.set(id, timer);
    },
    []
  );

  const success = useCallback((message: string) => notify(message, 'success'), [notify]);
  const error = useCallback((message: string) => notify(message, 'error'), [notify]);
  const info = useCallback((message: string) => notify(message, 'info'), [notify]);

  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach((timer) => clearTimeout(timer));
      active.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, notify, success, error, info, dismiss }),
    [toasts, notify, success, error, info, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} dismissLabel={resolveDismissLabel()} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
