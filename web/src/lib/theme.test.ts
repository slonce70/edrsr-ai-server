import { describe, it, expect } from 'vitest';
import { resolveInitialTheme } from './theme';

describe('resolveInitialTheme', () => {
  it('uses a stored preference when valid', () => {
    expect(resolveInitialTheme('dark', false)).toBe('dark');
    expect(resolveInitialTheme('light', true)).toBe('light');
  });
  it('falls back to OS preference when nothing is stored', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme(null, false)).toBe('light');
  });
  it('ignores invalid stored values', () => {
    expect(resolveInitialTheme('purple', true)).toBe('dark');
  });
});
