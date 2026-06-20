import { describe, expect, it } from 'vitest';
import { analyzeLinkInput } from './linkInput';

describe('analyzeLinkInput', () => {
  it('extracts valid ЄДРСР Review links from free text', () => {
    const text =
      'Дивись https://reyestr.court.gov.ua/Review/12345678 та https://reyestr.court.gov.ua/Review/87654321.';
    const r = analyzeLinkInput(text);
    expect(r.valid).toEqual([
      'https://reyestr.court.gov.ua/Review/12345678',
      'https://reyestr.court.gov.ua/Review/87654321',
    ]);
    expect(r.ignored).toBe(0);
    expect(r.duplicates).toBe(0);
  });

  it('counts non-ЄДРСР urls as ignored', () => {
    const text =
      'https://reyestr.court.gov.ua/Review/1 https://google.com https://example.org/page';
    const r = analyzeLinkInput(text);
    expect(r.valid).toEqual(['https://reyestr.court.gov.ua/Review/1']);
    expect(r.ignored).toBe(2);
  });

  it('counts repeated valid links as duplicates and keeps one', () => {
    const text =
      'https://reyestr.court.gov.ua/Review/5\nhttps://reyestr.court.gov.ua/Review/5\nhttps://reyestr.court.gov.ua/Review/5';
    const r = analyzeLinkInput(text);
    expect(r.valid).toEqual(['https://reyestr.court.gov.ua/Review/5']);
    expect(r.duplicates).toBe(2);
  });

  it('strips trailing punctuation', () => {
    const r = analyzeLinkInput('(https://reyestr.court.gov.ua/Review/9),');
    expect(r.valid).toEqual(['https://reyestr.court.gov.ua/Review/9']);
  });

  it('handles empty / whitespace / null-ish input', () => {
    expect(analyzeLinkInput('')).toEqual({ valid: [], ignored: 0, duplicates: 0 });
    expect(analyzeLinkInput('   \n  ')).toEqual({ valid: [], ignored: 0, duplicates: 0 });
    // @ts-expect-error guard non-string
    expect(analyzeLinkInput(undefined)).toEqual({ valid: [], ignored: 0, duplicates: 0 });
  });
});
