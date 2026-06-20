import { describe, it, expect } from 'vitest';
import { findMatches, buildSnippetParts } from './reportSearch';

describe('findMatches', () => {
  it('returns [] for an empty query', () => {
    expect(findMatches('some text', '')).toEqual([]);
  });

  it('returns [] for a whitespace-only query', () => {
    expect(findMatches('some text', '   ')).toEqual([]);
  });

  it('returns [] when there are no matches', () => {
    expect(findMatches('hello world', 'xyz')).toEqual([]);
  });

  it('returns [] when the query is longer than the haystack', () => {
    expect(findMatches('ab', 'abcdef')).toEqual([]);
  });

  it('finds a single match with correct offsets', () => {
    expect(findMatches('hello world', 'world')).toEqual([{ start: 6, end: 11 }]);
  });

  it('finds multiple non-overlapping matches', () => {
    expect(findMatches('foo bar foo baz foo', 'foo')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 16, end: 19 },
    ]);
  });

  it('is case-insensitive for Latin text', () => {
    expect(findMatches('Hello HELLO hello', 'hello')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ]);
  });

  it('is case-insensitive for Cyrillic text (Аналіз matches аналіз)', () => {
    const haystack = 'Аналіз справи: аналіз доказів';
    const matches = findMatches(haystack, 'Аналіз');
    expect(matches).toEqual([
      { start: 0, end: 6 },
      { start: 15, end: 21 },
    ]);
    // Offsets map back to the literal substrings in the original string.
    expect(haystack.slice(0, 6)).toBe('Аналіз');
    expect(haystack.slice(15, 21)).toBe('аналіз');
  });

  it('matches regex-special characters literally, not as a pattern', () => {
    const haystack = 'see (competitive) edge and a.b and a+b';
    expect(findMatches(haystack, '(competitive)')).toEqual([{ start: 4, end: 17 }]);
    // '.' must match a literal dot, not "any char"
    expect(findMatches('axb a.b', 'a.b')).toEqual([{ start: 4, end: 7 }]);
    // '+' must not behave as a quantifier
    expect(findMatches('aaa a+b', 'a+b')).toEqual([{ start: 4, end: 7 }]);
  });

  it('advances past each match so overlapping patterns are non-overlapping', () => {
    // 'aa' in 'aaaa' yields two matches at 0 and 2 (not three overlapping).
    expect(findMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('trims surrounding whitespace in the query before matching', () => {
    expect(findMatches('hello world', '  world  ')).toEqual([{ start: 6, end: 11 }]);
  });
});

describe('buildSnippetParts', () => {
  it('returns [] for an empty snippet', () => {
    expect(buildSnippetParts('', 'foo')).toEqual([]);
  });

  it('returns the whole snippet as one non-match part when query is empty', () => {
    expect(buildSnippetParts('hello world', '')).toEqual([{ text: 'hello world', match: false }]);
  });

  it('returns the whole snippet as one non-match part when there is no match', () => {
    expect(buildSnippetParts('hello world', 'xyz')).toEqual([{ text: 'hello world', match: false }]);
  });

  it('splits around a single match, preserving the original casing', () => {
    expect(buildSnippetParts('see the World now', 'world')).toEqual([
      { text: 'see the ', match: false },
      { text: 'World', match: true },
      { text: ' now', match: false },
    ]);
  });

  it('marks a match at the very start with no leading plain part', () => {
    expect(buildSnippetParts('foobar', 'foo')).toEqual([
      { text: 'foo', match: true },
      { text: 'bar', match: false },
    ]);
  });

  it('marks every occurrence in a multi-match snippet', () => {
    expect(buildSnippetParts('foo bar foo', 'foo')).toEqual([
      { text: 'foo', match: true },
      { text: ' bar ', match: false },
      { text: 'foo', match: true },
    ]);
  });

  it('handles Cyrillic terms (case-insensitive)', () => {
    expect(buildSnippetParts('стаття 205 КК', 'СТАТТЯ')).toEqual([
      { text: 'стаття', match: true },
      { text: ' 205 КК', match: false },
    ]);
  });
});
