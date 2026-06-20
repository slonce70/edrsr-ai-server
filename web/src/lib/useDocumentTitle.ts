import { useEffect } from 'react';
import { APP_NAME } from './config';

/**
 * Sets the browser tab title to `${title} · ${APP_NAME}` (or just APP_NAME when
 * title is empty), restoring the previous title on unmount. Additive UX/a11y
 * improvement so multiple open analyses are distinguishable by tab.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    const previous = document.title;
    const trimmed = (title || '').trim();
    document.title = trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
