import { useEffect, useId, useRef } from 'react';
import { useLocale } from '../state/LocaleContext';

type HelpModalProps = {
  open: boolean;
  onClose: () => void;
};

// One row in the shortcuts list: the key caps to render and the i18n key for
// its description.
type ShortcutRow = {
  keys: string[];
  descKey: string;
};

type ShortcutGroup = {
  labelKey: string;
  rows: ShortcutRow[];
};

// The documented shortcut set, grouped the way it is shown to the user.
// Power features that already exist (⌘K, in-report ToC + search) are listed
// here so the overlay makes them discoverable.
const GROUPS: ShortcutGroup[] = [
  {
    labelKey: 'shortcuts.navGroup',
    rows: [
      { keys: ['g', 'd'], descKey: 'shortcuts.goDashboard' },
      { keys: ['g', 'a'], descKey: 'shortcuts.goAnalyses' },
      { keys: ['g', 'c'], descKey: 'shortcuts.goCreate' },
      { keys: ['g', 'm'], descKey: 'shortcuts.goMatters' },
      { keys: ['g', 'p'], descKey: 'shortcuts.goPrompts' },
      { keys: ['g', 's'], descKey: 'shortcuts.goSettings' },
    ],
  },
  {
    labelKey: 'shortcuts.actionGroup',
    rows: [
      { keys: ['⌘K', 'Ctrl K'], descKey: 'shortcuts.palette' },
      { keys: ['n'], descKey: 'shortcuts.newAnalysis' },
    ],
  },
  {
    labelKey: 'shortcuts.otherGroup',
    rows: [
      { keys: ['?'], descKey: 'shortcuts.help' },
      { keys: [], descKey: 'shortcuts.reportFeatures' },
    ],
  },
];

// Elements that should never receive focus when the dialog opens but are still
// reachable by Tab while trapped.
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();

  // Focus management + body scroll lock while open, mirroring CommandPalette.
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = (document.activeElement as HTMLElement) || null;
    const id = window.requestAnimationFrame(() => {
      closeRef.current?.focus();
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
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
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

  const titleId = `${baseId}-title`;

  return (
    <div
      className="help-backdrop"
      onMouseDown={(event) => {
        // Click on the dimmed backdrop (not the panel) closes the dialog.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <div className="help-header">
          <h2 className="help-title" id={titleId}>
            {t('shortcuts.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-button help-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="help-body">
          {GROUPS.map((group) => (
            <section className="shortcuts-group" key={group.labelKey}>
              <h3 className="shortcuts-group__label">{t(group.labelKey)}</h3>
              <ul className="shortcuts-list">
                {group.rows.map((row) => (
                  <li className="shortcuts-row" key={row.descKey}>
                    <span className="shortcuts-row__keys" aria-hidden={row.keys.length === 0}>
                      {row.keys.length === 0 ? (
                        <span className="shortcuts-row__note">★</span>
                      ) : (
                        row.keys.map((key, i) => (
                          // The two cmdk variants (⌘K / Ctrl K) are separated by
                          // a slash; chord keys are shown side by side.
                          <span className="shortcuts-row__keygroup" key={`${row.descKey}-${i}`}>
                            {i > 0 && group.labelKey === 'shortcuts.actionGroup' ? (
                              <span className="shortcuts-row__sep">/</span>
                            ) : null}
                            {key.split(' ').map((cap, j) => (
                              <kbd className="kbd" key={`${row.descKey}-${i}-${j}`}>
                                {cap}
                              </kbd>
                            ))}
                          </span>
                        ))
                      )}
                    </span>
                    <span className="shortcuts-row__desc">{t(row.descKey)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
