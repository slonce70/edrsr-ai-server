import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { rankItems } from '../lib/fuzzy';
import { useAuth } from '../state/AuthContext';
import { useLocale } from '../state/LocaleContext';
import { useWorkspace } from '../state/WorkspaceContext';
import { StatusBadge } from './StatusBadge';
import type { JobSummary } from '../types/api';

type CommandPaletteProps = {
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
};

// A static command: a navigation entry or an action. Both share the same shape
// so the list can render and activate them uniformly.
type Command = {
  id: string;
  label: string;
  kind: 'nav' | 'action';
  perform: () => void;
};

type JobsResponse = {
  success: boolean;
  jobs: JobSummary[];
};

const SEARCH_LIMIT = 6;
const SEARCH_DEBOUNCE_MS = 200;
const MIN_SEARCH_LEN = 2;

// Highlight the matched characters from a fuzzy result inside the label.
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const chars = Array.from(text);
  const marked = new Set(indices);
  const nodes: React.ReactNode[] = [];
  let buffer = '';
  let bufferMarked = false;

  const flush = (key: number) => {
    if (!buffer) return;
    nodes.push(bufferMarked ? <mark key={key}>{buffer}</mark> : <span key={key}>{buffer}</span>);
    buffer = '';
  };

  chars.forEach((char, i) => {
    const isMarked = marked.has(i);
    if (isMarked !== bufferMarked) {
      flush(i);
      bufferMarked = isMarked;
    }
    buffer += char;
  });
  flush(chars.length);

  return <>{nodes}</>;
}

export function CommandPalette({ onToggleTheme, theme }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { accessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();

  // Stable handle to the latest setOpen-with-side-effects logic without
  // re-subscribing the global listeners on every render.
  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  // --- Static commands (navigation + actions), rebuilt when locale/theme change.
  const commands = useMemo<Command[]>(() => {
    const navItems: Array<{ to: string; key: string }> = [
      { to: '/dashboard', key: 'nav.dashboard' },
      { to: '/analyses', key: 'nav.analyses' },
      { to: '/create', key: 'nav.create' },
      { to: '/matters', key: 'nav.matters' },
      { to: '/prompts', key: 'nav.prompts' },
      { to: '/share-links', key: 'nav.shareLinks' },
      { to: '/settings', key: 'nav.settings' },
    ];

    const navCommands: Command[] = navItems.map((item) => ({
      id: `nav:${item.to}`,
      label: t(item.key),
      kind: 'nav',
      perform: () => navigate(item.to),
    }));

    const actionCommands: Command[] = [
      {
        id: 'action:new-analysis',
        label: t('command.newAnalysis'),
        kind: 'action',
        perform: () => navigate('/create'),
      },
      {
        id: 'action:toggle-theme',
        // Surface the target theme so the row reads like "Switch to dark theme".
        label: `${t('command.toggleTheme')} (${theme === 'dark' ? t('theme.light') : t('theme.dark')})`,
        kind: 'action',
        perform: onToggleTheme,
      },
    ];

    return [...navCommands, ...actionCommands];
  }, [t, navigate, onToggleTheme, theme]);

  const rankedCommands = useMemo(
    () => rankItems(commands, query, (cmd) => cmd.label),
    [commands, query]
  );

  // --- Debounced analyses search (only when the query is long enough).
  useEffect(() => {
    if (!open) return undefined;
    const trimmed = query.trim();
    if (trimmed.length < MIN_SEARCH_LEN || !accessToken) {
      setJobs([]);
      setJobsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    setJobsLoading(true);

    const timer = window.setTimeout(() => {
      apiRequest<JobsResponse>('/jobs', {
        token: accessToken,
        workspaceId: activeWorkspaceId || undefined,
        query: { search: trimmed, limit: SEARCH_LIMIT },
        signal: controller.signal,
      })
        .then((data) => {
          if (cancelled) return;
          setJobs(data.jobs || []);
        })
        .catch(() => {
          // Errors are intentionally swallowed: just show no analyses.
          if (cancelled) return;
          setJobs([]);
        })
        .finally(() => {
          if (cancelled) return;
          setJobsLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, accessToken, activeWorkspaceId]);

  // --- Flattened, ordered list of selectable rows (commands then analyses).
  type Row =
    | { type: 'command'; command: Command; indices: number[] }
    | { type: 'job'; job: JobSummary };

  const rows = useMemo<Row[]>(() => {
    const commandRows: Row[] = rankedCommands.map((r) => ({
      type: 'command',
      command: r.item,
      indices: r.indices,
    }));
    const jobRows: Row[] = jobs.map((job) => ({ type: 'job', job }));
    return [...commandRows, ...jobRows];
  }, [rankedCommands, jobs]);

  // Keep the active index in range as the result set changes.
  useEffect(() => {
    setActiveIndex((prev) => {
      if (rows.length === 0) return 0;
      return Math.min(prev, rows.length - 1);
    });
  }, [rows.length]);

  const activate = useCallback(
    (row: Row) => {
      if (row.type === 'command') {
        row.command.perform();
      } else {
        navigate(`/analyses/${row.job.id}`);
      }
      closePalette();
    },
    [navigate, closePalette]
  );

  // --- Open/close lifecycle: focus management + reset on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = (document.activeElement as HTMLElement) || null;
      // Defer focus to the next frame so the input is mounted.
      const id = window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        window.cancelAnimationFrame(id);
        document.body.style.overflow = previousOverflow;
      };
    }
    // Reset state when closing and restore focus if practical.
    setQuery('');
    setActiveIndex(0);
    setJobs([]);
    setJobsLoading(false);
    const previous = previousFocusRef.current;
    if (previous && typeof previous.focus === 'function') {
      previous.focus();
    }
    return undefined;
  }, [open]);

  // --- Global shortcuts: Cmd/Ctrl+K to toggle open, custom event to open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const onOpenEvent = () => setOpen(true);

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-command-palette', onOpenEvent);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-command-palette', onOpenEvent);
    };
  }, []);

  // Scroll the active option into view as it changes.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelector<HTMLElement>(`#${CSS.escape(`${baseId}-opt-${activeIndex}`)}`);
    // scrollIntoView is missing in some test environments (jsdom); guard it.
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open, baseId, rows.length]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (rows.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % rows.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      setActiveIndex((prev) => (prev - 1 + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) activate(row);
      return;
    }
    if (event.key === 'Tab') {
      // Focus is trapped: the input is the only focusable control, so keep it.
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  if (!open) return null;

  const listId = `${baseId}-list`;
  const activeOptionId = rows.length > 0 ? `${baseId}-opt-${activeIndex}` : undefined;

  // Split rows back into rendered groups while preserving global indices.
  const commandRows = rows
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.type === 'command');
  const jobRows = rows
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.type === 'job');

  const navRows = commandRows.filter(
    (entry) => entry.row.type === 'command' && entry.row.command.kind === 'nav'
  );
  const actionRows = commandRows.filter(
    (entry) => entry.row.type === 'command' && entry.row.command.kind === 'action'
  );

  const renderCommandRow = (entry: { row: Row; index: number }) => {
    if (entry.row.type !== 'command') return null;
    const { command, indices } = entry.row;
    const isActive = entry.index === activeIndex;
    return (
      <li
        key={command.id}
        id={`${baseId}-opt-${entry.index}`}
        role="option"
        aria-selected={isActive}
        className={`cmdk-item${isActive ? ' cmdk-item--active' : ''}`}
        onMouseMove={() => setActiveIndex(entry.index)}
        onClick={() => activate(entry.row)}
      >
        <span className="cmdk-item__label">
          <Highlight text={command.label} indices={indices} />
        </span>
        <span className="cmdk-item__tag">
          {command.kind === 'nav' ? t('command.navGroup') : t('command.actionGroup')}
        </span>
      </li>
    );
  };

  const hasResults = rows.length > 0;

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(event) => {
        // Click on the dimmed backdrop (not the panel) closes the palette.
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('command.placeholder')}
        onKeyDown={handleKeyDown}
      >
        <div className="cmdk-search">
          <span className="cmdk-search__icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            placeholder={t('command.placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <ul ref={listRef} className="cmdk-list" role="listbox" id={listId} aria-label={t('command.placeholder')}>
          {navRows.length > 0 ? (
            <li className="cmdk-group" role="presentation">
              {t('command.navGroup')}
            </li>
          ) : null}
          {navRows.map(renderCommandRow)}

          {actionRows.length > 0 ? (
            <li className="cmdk-group" role="presentation">
              {t('command.actionGroup')}
            </li>
          ) : null}
          {actionRows.map(renderCommandRow)}

          {query.trim().length >= MIN_SEARCH_LEN ? (
            <li className="cmdk-group" role="presentation">
              {t('command.analysesGroup')}
              {jobsLoading ? <span className="cmdk-group__spinner" aria-hidden="true" /> : null}
            </li>
          ) : null}
          {jobRows.map((entry) => {
            if (entry.row.type !== 'job') return null;
            const { job } = entry.row;
            const isActive = entry.index === activeIndex;
            return (
              <li
                key={`job:${job.id}`}
                id={`${baseId}-opt-${entry.index}`}
                role="option"
                aria-selected={isActive}
                className={`cmdk-item${isActive ? ' cmdk-item--active' : ''}`}
                onMouseMove={() => setActiveIndex(entry.index)}
                onClick={() => activate(entry.row)}
              >
                <span className="cmdk-item__label">
                  {job.title || t('command.analysesGroup')}
                </span>
                <StatusBadge status={job.status} />
              </li>
            );
          })}

          {!hasResults && !jobsLoading ? (
            <li className="cmdk-empty" role="presentation">
              {t('command.empty')}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
