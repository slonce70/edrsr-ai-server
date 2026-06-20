import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpModal } from './HelpModal';
import { SHORTCUT_ROUTES, isTypingTarget, matchKey, type ShortcutAction } from '../lib/shortcuts';

/**
 * Installs a single global 'keydown' listener that powers the app's keyboard
 * shortcuts and owns the "?" help overlay.
 *
 * Discipline (mirrors CommandPalette):
 *   * one document listener, added/removed in a single effect.
 *   * shortcuts are ignored while typing in a form field and whenever a
 *     modifier (meta/ctrl/alt) is held, so they never clash with Cmd+K, browser
 *     shortcuts, or normal typing.
 *   * the 'g' chord prefix lives in a ref (no re-render per keystroke) and
 *     expires after CHORD_TIMEOUT_MS via the pure matchKey resolver.
 */
export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  // Latest navigate without re-subscribing the global listener on every render.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // The active chord prefix ('g') and when it was set.
  const prefixRef = useRef<string | null>(null);
  const prefixTimeRef = useRef(0);

  useEffect(() => {
    const perform = (action: ShortcutAction) => {
      if (action === 'help') {
        setHelpOpen(true);
        return;
      }
      navigateRef.current(SHORTCUT_ROUTES[action]);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Never fire while typing or when a modifier is held (Cmd+K, browser
      // shortcuts, IME composition, etc.).
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.isComposing) return;
      if (isTypingTarget(event.target)) return;

      // Normalise: letters compared lowercase; '?' passed through. Ignore keys
      // that are not a single character (Shift, ArrowDown, Enter, …).
      const raw = event.key;
      const key = raw.length === 1 ? raw.toLowerCase() : raw;
      if (key.length !== 1) return;

      const now = event.timeStamp || Date.now();
      const result = matchKey(prefixRef.current, key, now, prefixTimeRef.current);

      if (result.isPrefix) {
        prefixRef.current = key;
        prefixTimeRef.current = now;
        // A bare 'g' is harmless to the page, but claim it so the next key
        // completes the chord cleanly.
        event.preventDefault();
        return;
      }

      // Any non-prefix outcome consumes the prefix.
      prefixRef.current = null;

      if (result.action) {
        event.preventDefault();
        perform(result.action);
      }
    };

    const onOpenEvent = () => setHelpOpen(true);

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-shortcuts-help', onOpenEvent);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-shortcuts-help', onOpenEvent);
    };
  }, []);

  return <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />;
}
