import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { LocaleProvider } from '../state/LocaleContext';
import { AuthProvider } from '../state/AuthContext';
import { WorkspaceProvider } from '../state/WorkspaceContext';

// Keep the test hermetic: no real network from WorkspaceProvider or the search.
vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(() => Promise.resolve({ success: true, jobs: [], workspaces: [] })),
  ApiError: class ApiError extends Error {},
}));

function renderPalette() {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <CommandPalette onToggleTheme={() => {}} theme="light" />
          </WorkspaceProvider>
        </AuthProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    cleanup();
  });

  it('is closed by default (no dialog rendered)', () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on Cmd/Ctrl+K and shows the search input', () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('opens on the custom open-command-palette event', () => {
    renderPalette();
    fireEvent(window, new Event('open-command-palette'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lists static navigation commands when first opened', () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    // Navigation labels come from nav.* — at least one option is present.
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
  });

  it('closes on Escape', () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves the active option with ArrowDown', () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog');
    const before = screen.getAllByRole('option').findIndex(
      (o) => o.getAttribute('aria-selected') === 'true'
    );
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    const after = screen.getAllByRole('option').findIndex(
      (o) => o.getAttribute('aria-selected') === 'true'
    );
    expect(after).toBe(before + 1);
  });

  it('filters commands as the user types', () => {
    renderPalette();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzznomatch' } });
    expect(input.value).toBe('zzzznomatch');
    // No commands match -> the friendly empty message is shown.
    expect(screen.getByText(/нічого не знайдено|ничего не найдено/i)).toBeInTheDocument();
  });

  it('detaches global listeners on unmount (no dialog after unmount + key)', () => {
    const { unmount } = renderPalette();
    unmount();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
