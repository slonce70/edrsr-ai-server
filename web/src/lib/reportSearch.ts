export type MatchRange = {
  start: number;
  end: number;
};

/**
 * Find all non-overlapping, case-insensitive literal matches of `query` inside
 * `haystack`. Returns character-offset ranges (JS string indices) into the
 * original `haystack`. The query is matched literally (regex-special characters
 * are NOT treated as regex). Unicode/Cyrillic safe — operates on the raw string.
 *
 * Pure and deterministic: no DOM, no side effects.
 */
export function findMatches(haystack: string, query: string): MatchRange[] {
  return findMatchesLowered(haystack.toLowerCase(), haystack.length, query);
}

/**
 * Same matching semantics as `findMatches`, but takes a PRE-lowered haystack so
 * a caller that searches the same large string repeatedly (e.g. per keystroke)
 * can lowercase it once and reuse it. `haystackLength` is the original
 * haystack's length, used only for the early "needle longer than haystack"
 * bail-out; offsets returned still index the original string (valid for the
 * Latin + Cyrillic scripts we care about, where casing does not change length).
 *
 * Pure and deterministic: no DOM, no side effects.
 */
export function findMatchesLowered(
  haystackLower: string,
  haystackLength: number,
  query: string
): MatchRange[] {
  const needle = query.trim();
  if (!needle || !haystackLower) return [];
  if (needle.length > haystackLength) return [];

  const needleLower = needle.toLowerCase();
  // toLowerCase can change string length for some locales; if the lowered
  // needle collapses to empty, there is nothing to match.
  if (!needleLower) return [];

  const matches: MatchRange[] = [];
  let from = 0;
  // indexOf on the lowered strings keeps offsets aligned with the original
  // `haystack` as long as casing does not change length — which holds for the
  // scripts we care about (Latin + Cyrillic). Advancing past each match length
  // guarantees non-overlapping results.
  while (from <= haystackLower.length) {
    const index = haystackLower.indexOf(needleLower, from);
    if (index === -1) break;
    matches.push({ start: index, end: index + needleLower.length });
    from = index + needleLower.length;
  }

  return matches;
}

export type SnippetPart = {
  text: string;
  match: boolean;
};

/**
 * Split a (server-trimmed) snippet into alternating plain / matched segments so
 * a caller can render the matched term highlighted (e.g. wrap `match: true`
 * parts in <mark>). Matching is case-insensitive and literal, reusing
 * findMatches. When the query is empty or has no match, returns the snippet as a
 * single non-matched part.
 *
 * Pure and deterministic: no DOM, no side effects.
 */
export function buildSnippetParts(snippet: string, query: string): SnippetPart[] {
  const text = snippet || '';
  if (!text) return [];
  const ranges = findMatches(text, query);
  if (ranges.length === 0) return [{ text, match: false }];

  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), match: false });
    }
    parts.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }
  return parts;
}
