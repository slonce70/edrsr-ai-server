import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const apiRequest = vi.fn();

vi.mock('../lib/api', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

// Render markdown synchronously as plain text so chat assertions are stable.
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
  title: 'Test job',
  status: 'completed',
  progress: 100,
  processed_links: 3,
  total_links: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function mockApi(initialChat: { role: string; content: string }[] = []) {
  let chat = [...initialChat];
  apiRequest.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    if (path === 'placeholder') return Promise.resolve(null);
    if (path.startsWith('/status/')) {
      return Promise.resolve({ ...baseJob, links: [] });
    }
    if (path.startsWith('/jobs/') && path.endsWith('/analysis')) {
      return Promise.resolve({ success: true, analysis: '' });
    }
    if (path.startsWith('/chat/')) {
      if (options?.method === 'POST') {
        const body = options.body as { message: string };
        chat = [...chat, { role: 'user', content: body.message }, { role: 'ai', content: 'reply' }];
        return Promise.resolve({ success: true });
      }
      return Promise.resolve(chat);
    }
    if (path.startsWith('/matters/')) {
      return Promise.resolve({ success: true, matter: { id: 'm', title: 'M' } });
    }
    return Promise.resolve(null);
  });
}

describe('JobDetailPage chat', () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it('sends the message via Enter and reconciles without a duplicate bubble', async () => {
    mockApi();
    render(<JobDetailPage />);

    const textarea = await screen.findByPlaceholderText('job.chatPlaceholder');
    fireEvent.change(textarea, { target: { value: 'Hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      const post = apiRequest.mock.calls.find(
        ([path, opts]) => path === '/chat/job-1' && opts?.method === 'POST'
      );
      expect(post).toBeTruthy();
      expect((post?.[1] as { body: { message: string } }).body.message).toBe('Hello there');
    });

    // After reconciliation the canonical list shows exactly one user bubble + AI reply.
    await waitFor(() => {
      const chatContainer = document.querySelector('.chat') as HTMLElement;
      expect(within(chatContainer).getAllByText('Hello there')).toHaveLength(1);
      expect(within(chatContainer).getByText('reply')).toBeInTheDocument();
    });
  });

  it('does not send on Shift+Enter', async () => {
    mockApi();
    render(<JobDetailPage />);

    const textarea = await screen.findByPlaceholderText('job.chatPlaceholder');
    fireEvent.change(textarea, { target: { value: 'Draft' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    const post = apiRequest.mock.calls.find(
      ([path, opts]) => path === '/chat/job-1' && opts?.method === 'POST'
    );
    expect(post).toBeUndefined();
  });

  it('disables the send button when the composer is empty', async () => {
    mockApi();
    render(<JobDetailPage />);

    const sendButton = await screen.findByText('job.chatSend');
    expect(sendButton).toBeDisabled();
  });
});
