import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../state/LocaleContext';
import { ReportStatusBanner } from './ReportStatusBanner';

function renderBanner(markdown: string | null) {
  return render(
    <LocaleProvider>
      <ReportStatusBanner markdown={markdown} />
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
});
