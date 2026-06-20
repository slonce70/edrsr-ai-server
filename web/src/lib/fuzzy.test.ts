import { describe, it, expect } from 'vitest';
import { fuzzyMatch, rankItems } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches a subsequence in order', () => {
    const result = fuzzyMatch('Create analysis', 'crt');
    expect(result).not.toBeNull();
    // C(0) r(1) t(4) — greedy match takes the first 't' in "Create".
    expect(result?.indices).toEqual([0, 1, 4]);
  });

  it('returns null when characters are out of order', () => {
    expect(fuzzyMatch('Create', 'etaerc')).toBeNull();
  });

  it('returns null when a query character is missing', () => {
    expect(fuzzyMatch('Create', 'crz')).toBeNull();
  });

  it('returns score 0 and no indices for an empty query (matches everything)', () => {
    expect(fuzzyMatch('anything', '')).toEqual({ score: 0, indices: [] });
  });

  it('returns null for empty text with a non-empty query', () => {
    expect(fuzzyMatch('', 'a')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('CREATE', 'create')).not.toBeNull();
  });

  it('matches Cyrillic case-insensitively (анл in Аналіз)', () => {
    const result = fuzzyMatch('Аналіз', 'анл');
    expect(result).not.toBeNull();
    // А(0) н(1) л(3)
    expect(result?.indices).toEqual([0, 1, 3]);
  });

  it('matches Cyrillic query against a Cyrillic title', () => {
    expect(fuzzyMatch('Аналізи справи', 'справ')).not.toBeNull();
  });

  it('scores consecutive matches higher than scattered ones', () => {
    const consecutive = fuzzyMatch('abcdef', 'abc');
    const scattered = fuzzyMatch('axbxcx', 'abc');
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect((consecutive as { score: number }).score).toBeGreaterThan(
      (scattered as { score: number }).score
    );
  });

  it('boosts matches at a word start over mid-word matches', () => {
    // "cr" at the start of "Create" should beat "cr" buried in "Microfilm".
    const wordStart = fuzzyMatch('Create', 'cr');
    const midWord = fuzzyMatch('Microfilm record', 'cr');
    expect(wordStart).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect((wordStart as { score: number }).score).toBeGreaterThan(
      (midWord as { score: number }).score
    );
  });

  it('rewards a match after a space as a word start', () => {
    // Query "an" -> the standalone word "analysis" should beat the embedded one.
    const afterSpace = fuzzyMatch('New analysis', 'an');
    const embedded = fuzzyMatch('Brand item', 'an');
    expect(afterSpace).not.toBeNull();
    expect(embedded).not.toBeNull();
    expect((afterSpace as { score: number }).score).toBeGreaterThan(
      (embedded as { score: number }).score
    );
  });
});

describe('rankItems', () => {
  const items = [
    { id: 1, name: 'Dashboard' },
    { id: 2, name: 'Create analysis' },
    { id: 3, name: 'Matters' },
    { id: 4, name: 'Settings' },
  ];

  it('filters out non-matching items', () => {
    const ranked = rankItems(items, 'zzz', (i) => i.name);
    expect(ranked).toEqual([]);
  });

  it('returns all items for an empty query', () => {
    const ranked = rankItems(items, '', (i) => i.name);
    expect(ranked).toHaveLength(items.length);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('sorts descending by score', () => {
    const ranked = rankItems(items, 'set', (i) => i.name);
    expect(ranked[0].item.name).toBe('Settings');
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('is stable for equal scores (preserves input order)', () => {
    // Two items that produce an identical score; the earlier one must win.
    const equal = [
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'alpha' },
    ];
    const ranked = rankItems(equal, 'al', (i) => i.name);
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b']);
  });

  it('returns matched indices for highlighting', () => {
    const ranked = rankItems(items, 'cr', (i) => i.name);
    expect(ranked[0].item.name).toBe('Create analysis');
    expect(ranked[0].indices).toEqual([0, 1]);
  });
});
