import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>safe child</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('safe child')).toBeInTheDocument();
  });

  it('renders the default fallback with reload + recovery link when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /reload|перезавантажити/i })).toBeInTheDocument();
    // Recovery action: a link back to the dashboard so the user isn't stuck.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard');
  });

  it('renders a custom fallback instead of the default when provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>custom public fallback</div>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('custom public fallback')).toBeInTheDocument();
    // The default reload button must NOT render when a custom fallback is used.
    expect(
      screen.queryByRole('button', { name: /reload|перезавантажити/i })
    ).not.toBeInTheDocument();
  });
});
