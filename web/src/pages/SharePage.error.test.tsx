import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ApiError } from '../lib/api';

const apiRequest = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'tok-1' }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('../state/LocaleContext', () => ({
  useLocale: () => ({
    t: (key: string) => key,
    dateLocale: 'uk-UA',
  }),
}));

vi.mock('../state/ToastContext', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SharePage } from './SharePage';

describe('SharePage error branching', () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows not-found copy on a 404', async () => {
    apiRequest.mockRejectedValue(new ApiError('Share link not found', 404));
    render(<SharePage />);
    expect(await screen.findByText('share.notFound')).toBeInTheDocument();
  });

  it('shows revoked copy on a 410 revoked', async () => {
    apiRequest.mockRejectedValue(
      new ApiError('Share link revoked', 410, { error: 'Share link revoked' })
    );
    render(<SharePage />);
    expect(await screen.findByText('share.revoked')).toBeInTheDocument();
    expect(screen.queryByText('share.notFound')).not.toBeInTheDocument();
  });

  it('shows expired copy on a 410 expired', async () => {
    apiRequest.mockRejectedValue(
      new ApiError('Share link expired', 410, { error: 'Share link expired' })
    );
    render(<SharePage />);
    expect(await screen.findByText('share.expired')).toBeInTheDocument();
    expect(screen.queryByText('share.notFound')).not.toBeInTheDocument();
  });

  it('shows a retryable generic error on a 500 and retries on click', async () => {
    let attempts = 0;
    apiRequest.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new ApiError('Server error', 500));
      return Promise.resolve({
        success: true,
        share: { expires_at: '2026-12-31T00:00:00Z' },
        job: {
          id: 'job-1',
          title: 'Shared report',
          created_at: '2026-01-01T00:00:00Z',
          processed_links: 1,
          total_links: 1,
        },
        analysis: null,
        links: [],
      });
    });
    render(<SharePage />);

    expect(await screen.findByText('share.genericErrorTitle')).toBeInTheDocument();
    expect(screen.queryByText('share.notFound')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('common.retry'));

    await waitFor(() => {
      expect(screen.getByText('Shared report')).toBeInTheDocument();
    });
  });
});
