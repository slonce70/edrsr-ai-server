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

vi.mock('../components/MarkdownView', () => ({
  MarkdownView: ({ markdown }: { markdown?: string | null }) => (
    <div className="markdown">{markdown}</div>
  ),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ jobId: 'job-1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('../state/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token-1' }),
}));

vi.mock('../state/LocaleContext', () => ({
  useLocale: () => ({
    t: (key: string) => key,
    dateLocale: 'uk-UA',
  }),
}));

vi.mock('../state/WorkspaceContext', () => ({
  useWorkspace: () => ({ activeWorkspaceId: 'ws-1' }),
}));

const toastError = vi.fn();
vi.mock('../state/ToastContext', () => ({
  useToast: () => ({
    toasts: [],
    notify: vi.fn(),
    success: vi.fn(),
    error: toastError,
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

const completedJob = {
  id: 'job-1',
  title: 'Test job',
  status: 'completed',
  progress: 100,
  processed_links: 3,
  total_links: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  links: [],
};

describe('JobDetailPage error classification', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the localized not-found EmptyState on a 404 status fetch', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/status/')) {
        return Promise.reject(new ApiError('Not found', 404));
      }
      return Promise.resolve(null);
    });
    render(<JobDetailPage />);

    expect(await screen.findByText('job.notFoundTitle')).toBeInTheDocument();
    expect(screen.queryByText('job.loadErrorMessage')).not.toBeInTheDocument();
  });

  it('renders a retryable error card on a 500 status fetch and retries on click', async () => {
    // Fail every status fetch until the user explicitly retries, so concurrent
    // mount-time fetches can't accidentally satisfy the success path.
    let failStatus = true;
    apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/status/')) {
        if (failStatus) return Promise.reject(new ApiError('Server error', 500));
        return Promise.resolve(completedJob);
      }
      if (path.startsWith('/jobs/') && path.endsWith('/analysis')) {
        return Promise.resolve({ success: true, analysis: '' });
      }
      if (path.startsWith('/chat/')) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<JobDetailPage />);

    // 500 -> retryable error card (not the not-found EmptyState).
    expect(await screen.findByText('job.loadErrorMessage')).toBeInTheDocument();
    expect(screen.queryByText('job.notFoundTitle')).not.toBeInTheDocument();

    failStatus = false;
    fireEvent.click(screen.getByText('common.retry'));

    // After retry succeeds the report header renders.
    await waitFor(() => {
      expect(screen.getByText('job.report')).toBeInTheDocument();
    });
  });

  it('shows a scoped retryable report error when the analysis fetch fails', async () => {
    let failAnalysis = true;
    apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/status/')) return Promise.resolve(completedJob);
      if (path.startsWith('/jobs/') && path.endsWith('/analysis')) {
        if (failAnalysis) return Promise.reject(new ApiError('boom', 500));
        return Promise.resolve({ success: true, analysis: 'The report body' });
      }
      if (path.startsWith('/chat/')) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<JobDetailPage />);

    // The report card shows the scoped load error, not "processing"/empty copy.
    expect(await screen.findByText('job.reportLoadError')).toBeInTheDocument();
    expect(screen.queryByText('job.reportEmpty')).not.toBeInTheDocument();

    failAnalysis = false;
    fireEvent.click(screen.getByText('common.retry'));

    await waitFor(() => {
      expect(screen.getByText('The report body')).toBeInTheDocument();
    });
  });

  it('surfaces a toast (not a silent failure) when sending a chat message fails', async () => {
    apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/status/')) return Promise.resolve(completedJob);
      if (path.startsWith('/jobs/') && path.endsWith('/analysis')) {
        return Promise.resolve({ success: true, analysis: 'body' });
      }
      if (path.startsWith('/chat/')) {
        if (options?.method === 'POST') return Promise.reject(new ApiError('down', 500));
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });
    render(<JobDetailPage />);

    const textarea = await screen.findByPlaceholderText('job.chatPlaceholder');
    fireEvent.change(textarea, { target: { value: 'Question?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
  });
});
