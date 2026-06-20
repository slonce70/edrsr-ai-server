import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocaleProvider } from '../state/LocaleContext';
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
});
