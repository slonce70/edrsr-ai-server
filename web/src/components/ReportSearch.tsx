import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocale } from '../state/LocaleContext';
import { findMatchesLowered } from '../lib/reportSearch';
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

// A snapshot of the live report DOM, walked once per render of the report.
// `lowered` is precomputed so the per-keystroke search never re-lowercases the
// whole report. `entries` maps global offsets back to (textNode, localOffset).
type ReportCache = {
  text: string;
  lowered: string;
  entries: TextNodeEntry[];
};

// Walk all text nodes under `root`, concatenating their text into one string
// while recording each node's start offset in that concatenation. This lets us
// map a global character offset back to a specific (textNode, localOffset).
// Also precomputes the lowercased haystack so per-keystroke search can skip it.
function collectTextNodes(root: Node): ReportCache {
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
  return { text, lowered: text.toLowerCase(), entries };
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
  // Cached snapshot of the walked report DOM. Rebuilt only when the report
  // re-renders (markdown changes), NOT on every keystroke — the memoized
  // MarkdownView keeps the DOM (and these Text nodes) stable across search-state
  // re-renders, so the cache is safe to reuse between keystrokes.
  const cacheRef = useRef<ReportCache | null>(null);
  // Bumped each time the cache effect locks in a new snapshot, so the search
  // effect re-runs against the freshly-walked DOM (matches the old behavior
  // where highlights appeared once the async report finished rendering).
  const [cacheVersion, setCacheVersion] = useState(0);
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

  // Rebuild match ranges for the current `query` against the CACHED report DOM
  // snapshot. The expensive TreeWalker walk + full-string lowercase happen once
  // per report render (see the cache effect below), not per keystroke — only
  // the literal search + Range construction run here.
  const buildHighlights = useCallback(() => {
    rangesRef.current = [];
    clearHighlights();

    // Robustness: the cache is normally populated by the rAF effect below, but
    // the async MarkdownView can finish rendering AFTER that loop gives up,
    // leaving an empty/partial snapshot that never refreshes (markdown didn't
    // change again). So rebuild synchronously here whenever the cache is
    // missing, empty, or stale relative to the live DOM. We compare the FULL
    // cached string against the live textContent (not just length): a new
    // report that happens to render to the byte-identical length would slip
    // past a length-only check and reuse a stale cache (#2). A full string
    // compare is cheap for a legal report and bulletproof — and still skips the
    // TreeWalker walk when the cache is already current (per-keystroke
    // optimization preserved).
    const root = containerRef.current;
    let cache = cacheRef.current;
    if (root && (!cache || cache.entries.length === 0 || cache.text !== (root.textContent ?? ''))) {
      cache = collectTextNodes(root);
      cacheRef.current = cache;
    }

    const trimmed = query.trim();
    if (!cache || !trimmed) {
      setMatchCount(0);
      setActiveIndex(0);
      return;
    }

    if (!highlightsSupported()) {
      // No-op degradation for the Range/Highlight DOM work, but still compute a
      // TRUTHFUL match count from the cached haystack so browsers without the
      // CSS Custom Highlight API show the real count instead of always
      // reporting "Nothing found" even when matches exist (#8). Only the
      // scroll/highlight navigation stays a no-op here.
      const count = findMatchesLowered(cache.lowered, cache.text.length, trimmed).length;
      setMatchCount(count);
      setActiveIndex(0);
      return;
    }

    // Match against the pre-lowered cached haystack; semantics are identical to
    // findMatches (case-insensitive, literal, non-overlapping).
    const matches = findMatchesLowered(cache.lowered, cache.text.length, trimmed);
    const ranges: Range[] = [];
    for (const match of matches) {
      const startLoc = locate(cache.entries, match.start);
      const endLoc = locate(cache.entries, match.end);
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

  // Build (and refresh) the report-DOM cache only when the report re-renders.
  // MarkdownView renders the report ASYNC, so we cannot walk synchronously here;
  // instead we poll on rAF (capped) until the rendered text settles, then snapshot
  // it. Keying on `markdown` guarantees we never reuse stale/detached Text nodes:
  // when the report changes, the old cache is discarded and rebuilt against the
  // fresh DOM. The cache is cleared on unmount.
  useEffect(() => {
    let rafId = 0;
    let attempts = 0;
    let lastText = '';
    let stableFrames = 0;

    const snapshot = () => {
      const root = containerRef.current;
      if (!root) {
        cacheRef.current = null;
        return;
      }
      const next = collectTextNodes(root);
      // The async MarkdownView may not have committed its HTML on the first
      // frames. Wait until the walked text stops changing (or we hit the cap)
      // before locking in the snapshot, so we never cache a partial report.
      if (next.text !== lastText) {
        lastText = next.text;
        stableFrames = 0;
      } else {
        stableFrames += 1;
      }
      cacheRef.current = next;
      // Notify the search effect that a fresh snapshot is available.
      setCacheVersion((v) => v + 1);
      if (stableFrames < 2 && attempts < 30) {
        attempts += 1;
        rafId = requestAnimationFrame(snapshot);
      }
    };

    snapshot();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      cacheRef.current = null;
    };
  }, [markdown]);

  // Debounce rebuilds slightly so typing stays smooth; also re-run when the
  // cache is (re)built — i.e. when the report finishes rendering — so the new
  // snapshot is searched against the current query.
  useEffect(() => {
    const handle = window.setTimeout(buildHighlights, 150);
    return () => window.clearTimeout(handle);
  }, [buildHighlights, cacheVersion]);

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
