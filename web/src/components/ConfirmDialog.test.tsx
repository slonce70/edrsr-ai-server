import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// `t` echoes the key (with a small map for the labels we assert on) so the
// component renders deterministically without the real i18n table.
const labels: Record<string, string> = {
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
};
vi.mock('../state/LocaleContext', () => ({
  useLocale: () => ({ t: (key: string) => labels[key] ?? key, dateLocale: 'uk-UA' }),
}));

import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog open={false} message="Delete this?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an accessible modal dialog with the message', () => {
    render(
      <ConfirmDialog open message="Delete this analysis?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Delete this analysis?')).toBeInTheDocument();
    // No title provided -> labelled by the message element.
    expect(dialog).toHaveAttribute('aria-labelledby', dialog.getAttribute('aria-describedby'));
  });

  it('labels the dialog by the title when one is provided', () => {
    render(
      <ConfirmDialog
        open
        title="Delete analysis"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(labelledBy).not.toBe(describedBy);
    expect(screen.getByText('Delete analysis').id).toBe(labelledBy);
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open message="Delete?" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open message="Delete?" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open message="Delete?" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses the danger styling and custom labels', () => {
    render(
      <ConfirmDialog
        open
        danger
        message="Delete?"
        confirmLabel="Remove"
        cancelLabel="Keep"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Remove' });
    expect(confirm).toHaveClass('btn-danger');
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });
});
