import { describe, it, expect } from 'vitest';
import { slugify, extractToc, assignHeadingIds, pickActiveId } from './reportToc';

describe('pickActiveId', () => {
  it('returns null for an empty list', () => {
    expect(pickActiveId([])).toBeNull();
  });

  it('picks the last heading scrolled past the activation line', () => {
    const headings = [
      { id: 'a', top: -200 },
      { id: 'b', top: -40 },
      { id: 'c', top: 300 },
    ];
    // a and b are above the line (0), c is below -> b is current.
    expect(pickActiveId(headings)).toBe('b');
  });

  it('honours a custom offset (e.g. scroll-margin-top)', () => {
    const headings = [
      { id: 'a', top: -10 },
      { id: 'b', top: 50 },
      { id: 'c', top: 300 },
    ];
    // With offset 90, both a (-10) and b (50) are at/above the line -> b.
    expect(pickActiveId(headings, 90)).toBe('b');
    // With offset 0, only a is above -> a.
    expect(pickActiveId(headings, 0)).toBe('a');
  });

  it('falls back to the first heading when none have been passed yet', () => {
    const headings = [
      { id: 'a', top: 120 },
      { id: 'b', top: 400 },
    ];
    expect(pickActiveId(headings)).toBe('a');
  });

  it('returns the last heading when everything is scrolled above', () => {
    const headings = [
      { id: 'a', top: -500 },
      { id: 'b', top: -300 },
      { id: 'c', top: -100 },
    ];
    expect(pickActiveId(headings)).toBe('c');
  });
});

describe('slugify', () => {
  it('lowercases, trims and dashes non-alphanumeric runs', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
  });

  it('collapses repeats and strips leading/trailing dashes', () => {
    expect(slugify('--A  &&  B--')).toBe('a-b');
  });

  it('keeps Cyrillic/Ukrainian letters and produces a stable non-empty slug', () => {
    const slug = slugify('АНАЛІЗ СТРАТЕГІЙ');
    expect(slug).toBe('аналіз-стратегій');
    expect(slug.length).toBeGreaterThan(0);
    // Deterministic
    expect(slugify('АНАЛІЗ СТРАТЕГІЙ')).toBe(slug);
  });

  it('falls back to "section" for empty / punctuation-only input', () => {
    expect(slugify('')).toBe('section');
    expect(slugify('   ')).toBe('section');
    expect(slugify('!!!')).toBe('section');
  });
});

describe('extractToc', () => {
  it('returns [] for empty / null / undefined markdown', () => {
    expect(extractToc('')).toEqual([]);
    expect(extractToc(null)).toEqual([]);
    expect(extractToc(undefined)).toEqual([]);
  });

  it('extracts h1/h2/h3 with correct levels and slugged ids', () => {
    const md = '# Title\n\n## Section One\n\nbody\n\n### Sub A\n';
    expect(extractToc(md)).toEqual([
      { id: 'title', text: 'Title', level: 1 },
      { id: 'section-one', text: 'Section One', level: 2 },
      { id: 'sub-a', text: 'Sub A', level: 3 },
    ]);
  });

  it('ignores headings deeper than h3 (h4+)', () => {
    const md = '## Keep\n#### Drop\n';
    expect(extractToc(md)).toEqual([{ id: 'keep', text: 'Keep', level: 2 }]);
  });

  it('de-dupes repeated heading slugs with -2/-3 suffixes', () => {
    const md = '## Огляд\n## Огляд\n## Огляд\n';
    const ids = extractToc(md).map((item) => item.id);
    expect(ids).toEqual(['огляд', 'огляд-2', 'огляд-3']);
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '## Real Section\n\n```\n## Not A Heading\n```\n\n## After Fence\n';
    expect(extractToc(md).map((item) => item.text)).toEqual([
      'Real Section',
      'After Fence',
    ]);
  });

  it('ignores headings inside ~~~ fenced code blocks too', () => {
    const md = '## Real\n~~~\n### Fake\n~~~\n';
    expect(extractToc(md).map((item) => item.text)).toEqual(['Real']);
  });

  it('strips inline markdown from the heading label', () => {
    const md = '## **Bold** and `code` and [link](http://x) title\n';
    expect(extractToc(md)).toEqual([
      { id: 'bold-and-code-and-link-title', text: 'Bold and code and link title', level: 2 },
    ]);
  });

  it('strips trailing closing # of closed ATX headings', () => {
    const md = '## Closed Heading ##\n';
    expect(extractToc(md)).toEqual([
      { id: 'closed-heading', text: 'Closed Heading', level: 2 },
    ]);
  });
});

describe('id/link consistency (load-bearing)', () => {
  it('extractToc id sequence equals the renderer assignHeadingIds sequence', () => {
    const md = [
      '# АНАЛІЗ СТРАТЕГІЙ',
      '## Огляд',
      '## Огляд',
      '### **Висновок**',
      '## Огляд',
    ].join('\n');

    // What the TOC links will point to.
    const tocIds = extractToc(md).map((item) => item.id);

    // Independently reconstruct the heading sequence (text + level) and run the
    // SAME shared helper the renderer uses, then compare. If these diverge, TOC
    // links would not match heading ids.
    const headings = [
      { text: 'АНАЛІЗ СТРАТЕГІЙ', level: 1 },
      { text: 'Огляд', level: 2 },
      { text: 'Огляд', level: 2 },
      { text: 'Висновок', level: 3 },
      { text: 'Огляд', level: 2 },
    ];
    const renderIds = assignHeadingIds(headings).map((item) => item.id);

    expect(tocIds).toEqual(renderIds);
    expect(tocIds).toEqual(['аналіз-стратегій', 'огляд', 'огляд-2', 'висновок', 'огляд-3']);
  });
});
