import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocale } from '../state/LocaleContext';
import { findMatches } from '../lib/reportSearch';
import { MarkdownView } from './MarkdownView';

type ReportSearchProps = {
  markdown?: string | null;
};

const HIGHLIGHT_NAME = 'report-search';
const ACTIVE_HIGHLIGHT_NAME = 'report-search-active';

// Feature-detect the CSS Custom Highlight API. In older browsers and the jsdom
// test environment these globals are absent, so the search degrades to a no-op
// (the input still renders, highlighting/scroll simply does nothing).
function highlightsSupported(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight !== 'undefined' &&
    typeof Range !== 'undefined'
  );
}

function clearHighlights() {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_NAME);
  CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
}

type TextNodeEntry = {
  node: Text;
  start: number;
};

// Walk all text nodes under `root`, concatenating their text into one string
// while recording each node's start offset in that concatenation. This lets us
// map a global character offset back to a specific (textNode, localOffset).
function collectTextNodes(root: Node): { text: string; entries: TextNodeEntry[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries: TextNodeEntry[] = [];
  let text = '';
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    entries.push({ node, start: text.length });
    text += node.data;
    current = walker.nextNode();
  }
  return { text, entries };
}

// Locate the text node that contains the global `offset` and return the local
// offset within it. A match may span multiple text nodes, so start and end are
// resolved independently.
function locate(entries: TextNodeEntry[], offset: number): { node: Text; local: number } | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (offset >= entry.start) {
      return { node: entry.node, local: offset - entry.start };
    }
  }
  return null;
}

export function ReportSearch({ markdown }: ReportSearchProps) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rangesRef = useRef<Range[]>([]);
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  // Build the two highlight registrations for the current active match. Pure
  // DOM work over the already-rendered report — the report markup is never
  // mutated (we only construct Range objects pointing into it).
  const applyActiveHighlight = useCallback((ranges: Range[], index: number) => {
    if (!highlightsSupported()) return;
    if (ranges.length === 0) {
      clearHighlights();
      return;
    }
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    const active = ranges[index];
    if (active) {
      CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(active));
    } else {
      CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
    }
  }, []);

  const scrollToActive = useCallback((ranges: Range[], index: number) => {
    const active = ranges[index];
    if (!active) return;
    const target =
      active.startContainer.parentElement ??
      (active.startContainer instanceof Element ? active.startContainer : null);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Rebuild all match ranges whenever the query or the rendered report changes.
  const buildHighlights = useCallback(() => {
    rangesRef.current = [];
    clearHighlights();

    const root = containerRef.current;
    const trimmed = query.trim();
    if (!root || !trimmed) {
      setMatchCount(0);
      setActiveIndex(0);
      return;
    }

    if (!highlightsSupported()) {
      // No-op degradation: still report a (best-effort) count so the UI can
      // show "nothing found", but do not attempt any DOM Range work.
      setMatchCount(0);
      setActiveIndex(0);
      return;
    }

    const { text, entries } = collectTextNodes(root);
    const matches = findMatches(text, trimmed);
    const ranges: Range[] = [];
    for (const match of matches) {
      const startLoc = locate(entries, match.start);
      const endLoc = locate(entries, match.end);
      if (!startLoc || !endLoc) continue;
      try {
        const range = new Range();
        range.setStart(startLoc.node, startLoc.local);
        range.setEnd(endLoc.node, endLoc.local);
        ranges.push(range);
      } catch {
        // Skip ranges that cannot be constructed (e.g. detached nodes).
      }
    }

    rangesRef.current = ranges;
    setMatchCount(ranges.length);
    const nextIndex = ranges.length > 0 ? 0 : 0;
    setActiveIndex(nextIndex);
    applyActiveHighlight(ranges, nextIndex);
    if (ranges.length > 0) scrollToActive(ranges, nextIndex);
  }, [query, applyActiveHighlight, scrollToActive]);

  // Debounce rebuilds slightly so typing stays smooth; also re-run when the
  // report itself re-renders (markdown changes).
  useEffect(() => {
    const handle = window.setTimeout(buildHighlights, 150);
    return () => window.clearTimeout(handle);
  }, [buildHighlights, markdown]);

  // Critical cleanup: CSS.highlights is document-global. Remove our entries on
  // unmount so navigating away never leaves stale highlights behind.
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, []);

  const moveActive = useCallback(
    (delta: number) => {
      const ranges = rangesRef.current;
      if (ranges.length === 0) return;
      setActiveIndex((prev) => {
        const next = (prev + delta + ranges.length) % ranges.length;
        applyActiveHighlight(ranges, next);
        scrollToActive(ranges, next);
        return next;
      });
    },
    [applyActiveHighlight, scrollToActive]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveActive(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
    }
  };

  const trimmedQuery = query.trim();
  const hasMatches = matchCount > 0;
  const showNone = trimmedQuery.length > 0 && !hasMatches;

  return (
    <div className="report-search-wrap">
      <div className="report-search">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('report.searchPlaceholder')}
          aria-label={t('report.searchPlaceholder')}
        />
        <div className="report-search__count" aria-live="polite">
          {showNone
            ? t('report.searchNone')
            : hasMatches
              ? t('report.searchCount', { current: activeIndex + 1, total: matchCount })
              : ''}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => moveActive(-1)}
          disabled={!hasMatches}
          aria-label={t('report.searchPrev')}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => moveActive(1)}
          disabled={!hasMatches}
          aria-label={t('report.searchNext')}
        >
          ↓
        </button>
      </div>
      <div ref={containerRef} className="report-search__body">
        <MarkdownView markdown={markdown} />
      </div>
    </div>
  );
}
