// Pure, dependency-free fuzzy matching + ranking for the command palette.
// Case-insensitive subsequence matching with a heuristic score that rewards
// consecutive runs, matches at word starts, and earlier positions; gaps are
// penalized. Unicode/Cyrillic safe because all comparisons go through
// String.prototype.toLowerCase().

export type FuzzyResult = {
  score: number;
  indices: number[];
};

// Characters that signal a "word boundary"; a match immediately after one of
// these (or at index 0) is treated as a word start and rewarded.
const BOUNDARY = /[\s\-_/.,:;()[\]{}'"|]/;

function isBoundary(char: string | undefined): boolean {
  return char === undefined || BOUNDARY.test(char);
}

/**
 * Case-insensitive subsequence match.
 * Returns null when the query characters do not appear, in order, in the text.
 * An empty query matches everything with score 0 and no indices.
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  if (query.length === 0) return { score: 0, indices: [] };
  if (text.length === 0) return null;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  // Work in arrays of code points so multi-unit characters compare cleanly.
  const textChars = Array.from(lowerText);
  const queryChars = Array.from(lowerQuery);

  const indices: number[] = [];
  let score = 0;
  let queryIndex = 0;
  let lastMatch = -1;

  for (let i = 0; i < textChars.length && queryIndex < queryChars.length; i += 1) {
    if (textChars[i] !== queryChars[queryIndex]) continue;

    indices.push(i);

    // Base reward for any matched character.
    let charScore = 10;

    // Reward matches at the start of a word (boundary before, or first char).
    if (isBoundary(textChars[i - 1])) {
      charScore += 15;
    }

    // Reward the very first character of the whole text a touch extra.
    if (i === 0) {
      charScore += 5;
    }

    if (lastMatch !== -1) {
      const gap = i - lastMatch - 1;
      if (gap === 0) {
        // Consecutive match: strong bonus so dense runs beat scattered hits.
        charScore += 20;
      } else {
        // Penalize gaps, but never let a single match go negative.
        charScore -= Math.min(gap, 8);
      }
    }

    score += charScore;
    lastMatch = i;
    queryIndex += 1;
  }

  // Not every query character was consumed -> no subsequence match.
  if (queryIndex < queryChars.length) return null;

  // Mild reward for matching earlier in the text overall (shorter prefix to the
  // first match ranks higher), and a slight bias toward shorter text so an
  // exact-ish short label outranks the same query buried in a long one.
  score -= indices[0];
  score -= Math.floor(textChars.length / 50);

  return { score, indices };
}

/**
 * Rank a list of items by fuzzy score against `query`, keeping only matches.
 * Sort is descending by score and stable for equal scores (input order wins).
 */
export function rankItems<T>(
  items: T[],
  query: string,
  getText: (item: T) => string
): Array<{ item: T; score: number; indices: number[] }> {
  const matched = items
    .map((item, order) => {
      const result = fuzzyMatch(getText(item), query);
      if (!result) return null;
      return { item, score: result.score, indices: result.indices, order };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  matched.sort((a, b) => (b.score === a.score ? a.order - b.order : b.score - a.score));

  return matched.map(({ item, score, indices }) => ({ item, score, indices }));
}
