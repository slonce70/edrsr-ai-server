import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const apiRequest = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

vi.mock('../components/MarkdownView', () => ({
  MarkdownView: ({ markdown }: { markdown?: string | null }) => (
    <div className="markdown">{markdown}</div>
  ),
}));

// Mutable jobId so we can simulate navigating /analyses/A -> /analyses/B
// without unmounting the route component (it is reused across jobId changes).
let currentJobId = 'job-A';
vi.mock('react-router-dom', () => ({
  useParams: () => ({ jobId: currentJobId }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('../state/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token-1' }),
}));

const mockLocale = { t: (key: string) => key, dateLocale: 'uk-UA' };
vi.mock('../state/LocaleContext', () => ({
  useLocale: () => mockLocale,
}));

vi.mock('../state/WorkspaceContext', () => ({
  useWorkspace: () => ({ activeWorkspaceId: 'ws-1' }),
}));

vi.mock('../state/ToastContext', () => ({
  useToast: () => ({
    toasts: [],
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const onJobUpdate = vi.fn(() => () => {});
vi.mock('../state/WebSocketContext', () => ({
  useWebSocket: () => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onJobUpdate,
    clientId: 'client-1',
    status: 'connected',
  }),
}));

import { JobDetailPage } from './JobDetailPage';

function completedJob(id: string, title: string) {
  return {
    id,
    title,
    status: 'completed',
    progress: 100,
    processed_links: 1,
    total_links: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    links: [],
  };
}

describe('JobDetailPage job-scoped reset on jobId change', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    currentJobId = 'job-A';
  });

  afterEach(() => {
    cleanup();
  });

  it('shows job B report (BBB), not the leaked job A report (AAA), after navigating A -> B', async () => {
    // Each completed job returns its own analysis body. Without the reset
    // effect, analysisRef would still hold "AAA" when B loads, suppressing
    // fetchAnalysis(B) and leaving B showing A's report.
    apiRequest.mockImplementation((path: string) => {
      if (path === '/status/job-A') return Promise.resolve(completedJob('job-A', 'Job A'));
      if (path === '/status/job-B') return Promise.resolve(completedJob('job-B', 'Job B'));
      if (path === '/jobs/job-A/analysis') {
        return Promise.resolve({ success: true, analysis: 'AAA' });
      }
      if (path === '/jobs/job-B/analysis') {
        return Promise.resolve({ success: true, analysis: 'BBB' });
      }
      if (path.startsWith('/chat/')) return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const { rerender } = render(<JobDetailPage />);

    // Job A's report body is shown.
    expect(await screen.findByText('AAA')).toBeInTheDocument();

    // Navigate to job B (same component instance, only the jobId param changes).
    currentJobId = 'job-B';
    rerender(<JobDetailPage />);

    // Job B's report body must appear and A's must be gone.
    expect(await screen.findByText('BBB')).toBeInTheDocument();
    expect(screen.queryByText('AAA')).not.toBeInTheDocument();
  });

  it('surfaces the not-found EmptyState for a 404 on B even after A loaded successfully', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/status/job-A') return Promise.resolve(completedJob('job-A', 'Job A'));
      if (path === '/status/job-B') {
        return import('../lib/api').then(({ ApiError }) =>
          Promise.reject(new ApiError('Not found', 404))
        );
      }
      if (path === '/jobs/job-A/analysis') {
        return Promise.resolve({ success: true, analysis: 'AAA' });
      }
      if (path.startsWith('/chat/')) return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const { rerender } = render(<JobDetailPage />);
    expect(await screen.findByText('AAA')).toBeInTheDocument();

    currentJobId = 'job-B';
    rerender(<JobDetailPage />);

    // The reset cleared the stale job, so the 404 EmptyState is not hidden
    // behind job A.
    await waitFor(() => {
      expect(screen.getByText('job.notFoundTitle')).toBeInTheDocument();
    });
    expect(screen.queryByText('AAA')).not.toBeInTheDocument();
  });
});
