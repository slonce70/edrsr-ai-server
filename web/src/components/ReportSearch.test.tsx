import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../state/LocaleContext';

// Render markdown synchronously as plain text so the report body is in the DOM
// immediately. This keeps the existing render/input tests valid and lets the
// #8 count test assert a truthful match count without waiting on async render.
vi.mock('./MarkdownView', () => ({
  MarkdownView: ({ markdown }: { markdown?: string | null }) => (
    <div className="markdown">{markdown}</div>
  ),
}));

import { ReportSearch } from './ReportSearch';

function renderSearch(markdown: string | null) {
  return render(
    <LocaleProvider>
      <ReportSearch markdown={markdown} />
    </LocaleProvider>
  );
}

describe('ReportSearch', () => {
  // jsdom has no CSS Custom Highlight API, so the feature degrades to a no-op.
  // These tests verify it renders and accepts input without throwing.
  it('renders the search input and the report body without crashing', () => {
    renderSearch('# Аналіз\n\nТекст звіту.');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with null markdown without crashing', () => {
    renderSearch(null);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('accepts typing into the search input without throwing', () => {
    renderSearch('# Аналіз\n\nТекст звіту.');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'звіт' } });
    expect(input.value).toBe('звіт');
  });

  it('clears the query on Escape', () => {
    renderSearch('# Аналіз');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'аналіз' } });
    expect(input.value).toBe('аналіз');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });

  // #8: jsdom has no CSS Custom Highlight API, so highlightsSupported() is
  // false. The count must still be computed truthfully from the cached text so
  // the UI does not show "Nothing found" when matches actually exist.
  it('reports a truthful match count without the Highlight API (no false "nothing found")', async () => {
    // "тест" appears twice in the body -> expect a 1/2 count, not searchNone.
    renderSearch('Перший тест і другий тест у звіті.');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'тест' } });

    await waitFor(() => {
      // searchCount renders as "{{current}}/{{total}}" -> "1/2".
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });
    // The degraded "nothing found" message must NOT be shown when matches exist.
    expect(screen.queryByText('Нічого не знайдено')).not.toBeInTheDocument();
    expect(screen.queryByText('Ничего не найдено')).not.toBeInTheDocument();
  });
});
