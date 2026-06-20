import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiRequest = vi.fn();

vi.mock('../lib/api', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

// Render markdown synchronously as plain text so assertions are stable.
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
    onJobUpdate,
    clientId: 'client-1',
    status: 'connected',
  }),
}));

import { JobDetailPage } from './JobDetailPage';

const baseJob = {
  id: 'job-1',
  title: 'Original title',
  status: 'completed',
  progress: 100,
  processed_links: 3,
  total_links: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function mockApi() {
  apiRequest.mockImplementation(
    (path: string, options?: { method?: string; body?: unknown }) => {
      if (path.startsWith('/status/')) {
        return Promise.resolve({ ...baseJob, links: [] });
      }
      if (path.startsWith('/jobs/') && path.endsWith('/analysis')) {
        return Promise.resolve({ success: true, analysis: '' });
      }
      if (path.startsWith('/jobs/') && path.endsWith('/title')) {
        const body = options?.body as { title: string };
        return Promise.resolve({ success: true, job: { ...baseJob, title: body.title } });
      }
      if (path.startsWith('/chat/')) {
        return Promise.resolve([]);
      }
      if (path.startsWith('/matters/')) {
        return Promise.resolve({ success: true, matter: { id: 'm', title: 'M' } });
      }
      return Promise.resolve(null);
    }
  );
}

describe('JobDetailPage title editing', () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it('shows an input pre-filled with the current title when clicking edit', async () => {
    mockApi();
    render(<JobDetailPage />);

    await screen.findByText('Original title');
    fireEvent.click(screen.getByLabelText('job.editTitle'));

    const input = screen.getByLabelText('job.editTitle') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('Original title');
  });

  it('saves the edited title via PATCH and closes edit mode', async () => {
    mockApi();
    render(<JobDetailPage />);

    await screen.findByText('Original title');
    fireEvent.click(screen.getByLabelText('job.editTitle'));

    const input = screen.getByLabelText('job.editTitle');
    fireEvent.change(input, { target: { value: '  Updated title  ' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => {
      const patch = apiRequest.mock.calls.find(
        ([path, opts]) => path === '/jobs/job-1/title' && opts?.method === 'PATCH'
      );
      expect(patch).toBeTruthy();
      expect((patch?.[1] as { body: { title: string } }).body.title).toBe('Updated title');
    });

    // Heading reflects the new title and the edit input is gone.
    await waitFor(() => {
      expect(screen.getByText('Updated title')).toBeInTheDocument();
      expect(screen.queryByText('common.save')).not.toBeInTheDocument();
    });
  });

  it('exits edit mode on Cancel without calling PATCH', async () => {
    mockApi();
    render(<JobDetailPage />);

    await screen.findByText('Original title');
    fireEvent.click(screen.getByLabelText('job.editTitle'));

    const input = screen.getByLabelText('job.editTitle');
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.click(screen.getByText('common.cancel'));

    expect(screen.queryByText('common.save')).not.toBeInTheDocument();
    expect(screen.getByText('Original title')).toBeInTheDocument();
    const patch = apiRequest.mock.calls.find(
      ([path, opts]) => path === '/jobs/job-1/title' && opts?.method === 'PATCH'
    );
    expect(patch).toBeUndefined();
  });
});
