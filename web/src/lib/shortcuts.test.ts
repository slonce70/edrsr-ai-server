import { describe, it, expect } from 'vitest';
import { matchKey, isTypingTarget, CHORD_TIMEOUT_MS, SHORTCUT_ROUTES } from './shortcuts';

describe('matchKey', () => {
  it("resolves 'g' then 'a' to analyses", () => {
    // First press: 'g' opens a prefix.
    const first = matchKey(null, 'g', 0, 0);
    expect(first).toEqual({ isPrefix: true });
    // Second press within the window: completes the chord.
    const second = matchKey('g', 'a', 100, 0);
    expect(second).toEqual({ action: 'analyses' });
  });

  it("treats a bare 'g' as a prefix, not an action", () => {
    expect(matchKey(null, 'g', 0, 0)).toEqual({ isPrefix: true });
  });

  it("maps every chord key to its nav action", () => {
    expect(matchKey('g', 'd', 50, 0)).toEqual({ action: 'dashboard' });
    expect(matchKey('g', 'c', 50, 0)).toEqual({ action: 'create' });
    expect(matchKey('g', 'm', 50, 0)).toEqual({ action: 'matters' });
    expect(matchKey('g', 'p', 50, 0)).toEqual({ action: 'prompts' });
    expect(matchKey('g', 's', 50, 0)).toEqual({ action: 'settings' });
  });

  it("clears the prefix when 'g' is followed by an unknown key", () => {
    expect(matchKey('g', 'z', 50, 0)).toEqual({});
  });

  it("resolves a single 'n' to new analysis (create)", () => {
    expect(matchKey(null, 'n', 0, 0)).toEqual({ action: 'new' });
  });

  it("resolves '?' to help", () => {
    expect(matchKey(null, '?', 0, 0)).toEqual({ action: 'help' });
  });

  it('drops a stale prefix and re-evaluates the key on its own', () => {
    // 'g' set at t=0, second key arrives just past the timeout: the prefix is
    // stale, so 'a' is evaluated as a single key (which is a no-op).
    const stale = matchKey('g', 'a', CHORD_TIMEOUT_MS + 1, 0);
    expect(stale).toEqual({});
    // A stale prefix followed by 'n' resolves 'n' as a single key.
    expect(matchKey('g', 'n', CHORD_TIMEOUT_MS + 1, 0)).toEqual({ action: 'new' });
    // A stale prefix followed by another 'g' re-opens a prefix.
    expect(matchKey('g', 'g', CHORD_TIMEOUT_MS + 1, 0)).toEqual({ isPrefix: true });
  });

  it('returns an empty result for irrelevant keys', () => {
    expect(matchKey(null, 'x', 0, 0)).toEqual({});
  });

  it("'new' and nav routes are wired to real paths", () => {
    expect(SHORTCUT_ROUTES.new).toBe('/create');
    expect(SHORTCUT_ROUTES.analyses).toBe('/analyses');
  });
});

describe('isTypingTarget', () => {
  it('is true for input, textarea and select', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
  });

  it('is true for a contenteditable element', () => {
    const div = document.createElement('div');
    // jsdom does not derive isContentEditable from the attribute, so stub it.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTypingTarget(div)).toBe(true);
  });

  it('is false for non-editable elements', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
  });

  it('is false for null and non-element targets', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(new EventTarget())).toBe(false);
  });
});
