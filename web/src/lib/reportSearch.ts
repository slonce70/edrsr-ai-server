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
  const needle = query.trim();
  if (!needle || !haystack) return [];
  if (needle.length > haystack.length) return [];

  const haystackLower = haystack.toLowerCase();
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
