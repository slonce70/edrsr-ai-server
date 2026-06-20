import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocumentTitle } from './useDocumentTitle';
import { APP_NAME } from './config';

describe('useDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Initial';
  });

  it('sets the document title to "<title> · APP_NAME"', () => {
    renderHook(() => useDocumentTitle('My Title'));
    expect(document.title).toBe(`My Title · ${APP_NAME}`);
  });

  it('falls back to APP_NAME for an empty title', () => {
    renderHook(() => useDocumentTitle(''));
    expect(document.title).toBe(APP_NAME);
  });

  it('falls back to APP_NAME for an undefined title', () => {
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe(APP_NAME);
  });

  it('restores the previous document title on unmount', () => {
    document.title = 'Previous Title';
    const { unmount } = renderHook(() => useDocumentTitle('Active Title'));
    expect(document.title).toBe(`Active Title · ${APP_NAME}`);
    unmount();
    expect(document.title).toBe('Previous Title');
  });
});
