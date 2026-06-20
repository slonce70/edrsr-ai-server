import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../state/LocaleContext';
import type { JobQuality } from '../lib/analysisQuality';
import { ReportStatusBanner } from './ReportStatusBanner';

function renderBanner(markdown: string | null, quality?: JobQuality | null) {
  return render(
    <LocaleProvider>
      <ReportStatusBanner markdown={markdown} quality={quality} />
    </LocaleProvider>
  );
}

describe('ReportStatusBanner', () => {
  it('renders nothing for a clean report', () => {
    const { container } = renderBanner('• **Покриття даних:** 100%');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an alert for a partial report', () => {
    renderBanner('⚠️ Частина справ не була проаналізована через тимчасову помилку AI.');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Звіт неповний/)).toBeInTheDocument();
  });

  it('shows coverage when present', () => {
    renderBanner('• **Покриття даних:** 78%');
    expect(screen.getByText(/78%/)).toBeInTheDocument();
  });

  it('prefers structured quality: renders nothing when not partial even if markdown is partial', () => {
    const { container } = renderBanner(
      '⚠️ Частина справ не була проаналізована через тимчасову помилку AI.',
      { analyzed: true, total: 25, cited: 25, coverage: 100, partial: false }
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('prefers structured quality: renders alert and coverage when partial', () => {
    renderBanner('• **Покриття даних:** 100%', {
      analyzed: true,
      total: 25,
      cited: 16,
      coverage: 64,
      partial: true,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/64%/)).toBeInTheDocument();
  });

  it('falls back to markdown when no quality prop is provided', () => {
    renderBanner('⚠️ Частина справ не була проаналізована через тимчасову помилку AI.');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
