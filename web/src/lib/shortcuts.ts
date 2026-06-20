// Pure, framework-agnostic keyboard-shortcut logic for the app shell.
//
// The model has two layers:
//   * single keys — e.g. 'n' (new analysis), '?' (help).
//   * a 2-key chord with a 'g' prefix — e.g. 'g' then 'a' → analyses. The
//     prefix is only valid for a short window (CHORD_TIMEOUT_MS); after that a
//     stale prefix is dropped so a slow second key never mis-fires.
//
// The component layer feeds raw keys + timing into `matchKey`; everything here
// stays pure so it can be unit-tested without a DOM.

// How long (ms) the 'g' prefix stays active waiting for the second key.
export const CHORD_TIMEOUT_MS = 1000;

// Resolvable actions. Nav actions map 1:1 to AppLayout routes; 'new' is a
// shortcut alias for /create and 'help' opens the HelpModal.
export type ShortcutAction =
  | 'dashboard'
  | 'analyses'
  | 'create'
  | 'matters'
  | 'prompts'
  | 'settings'
  | 'new'
  | 'help';

// Map of a shortcut action to the route it navigates to. 'help' has no route
// (it opens the modal) and is intentionally absent.
export const SHORTCUT_ROUTES: Record<Exclude<ShortcutAction, 'help'>, string> = {
  dashboard: '/dashboard',
  analyses: '/analyses',
  create: '/create',
  matters: '/matters',
  prompts: '/prompts',
  settings: '/settings',
  new: '/create',
};

// Second key (after 'g') → nav action.
const CHORD_MAP: Record<string, ShortcutAction> = {
  a: 'analyses',
  d: 'dashboard',
  c: 'create',
  m: 'matters',
  p: 'prompts',
  s: 'settings',
};

// Single keys (no prefix) → action.
const SINGLE_MAP: Record<string, ShortcutAction> = {
  n: 'new',
  '?': 'help',
};

// The result of feeding one key into the matcher.
//   * action  — a resolved shortcut to perform (clears any prefix).
//   * isPrefix — the key started a chord (caller should remember it + the time).
//   * neither  — the key is irrelevant or cleared a stale/invalid prefix.
export type MatchResult = {
  action?: ShortcutAction;
  isPrefix?: boolean;
};

/**
 * Resolve a single keypress given the current chord prefix and timing.
 *
 * @param prefix   the active prefix key ('g') or null if none.
 * @param key      the pressed key (already lowercased by the caller for letters;
 *                 '?' is passed through as-is).
 * @param now      timestamp of this keypress (ms).
 * @param prefixTime timestamp the prefix was set (ms); ignored when prefix is null.
 *
 * Pure: returns what to do, never mutates. The caller owns the prefix buffer.
 */
export function matchKey(
  prefix: string | null,
  key: string,
  now: number = 0,
  prefixTime: number = 0,
): MatchResult {
  // An active, fresh 'g' prefix: try to complete a chord.
  if (prefix === 'g' && now - prefixTime <= CHORD_TIMEOUT_MS) {
    const chordAction = CHORD_MAP[key];
    if (chordAction) return { action: chordAction };
    // 'g' followed by an unknown key clears the prefix without acting.
    return {};
  }

  // No (fresh) prefix. A bare 'g' opens a new prefix.
  if (key === 'g') return { isPrefix: true };

  const single = SINGLE_MAP[key];
  if (single) return { action: single };

  return {};
}

/**
 * True when the event target is a place the user is typing (input, textarea,
 * select, or any contenteditable element). Shortcuts are suppressed for these
 * so they never clash with form input. Guards null / non-element targets.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
