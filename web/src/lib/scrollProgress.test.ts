import { describe, it, expect } from 'vitest';
import { computeScrollProgress } from './scrollProgress';

describe('computeScrollProgress', () => {
  it('returns 0 at the top of the document', () => {
    expect(computeScrollProgress(0, 2000, 800)).toBe(0);
  });

  it('returns 1 at the bottom of the document', () => {
    // scrollable = 2000 - 800 = 1200
    expect(computeScrollProgress(1200, 2000, 800)).toBe(1);
  });

  it('returns ~0.5 midway through the document', () => {
    expect(computeScrollProgress(600, 2000, 800)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 when the page is not scrollable', () => {
    expect(computeScrollProgress(0, 800, 800)).toBe(0);
    expect(computeScrollProgress(0, 500, 800)).toBe(0);
  });

  it('clamps over-scroll (beyond bottom) to 1', () => {
    expect(computeScrollProgress(5000, 2000, 800)).toBe(1);
  });

  it('clamps negative scroll (rubber-band) to 0', () => {
    expect(computeScrollProgress(-120, 2000, 800)).toBe(0);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(computeScrollProgress(NaN, 2000, 800)).toBe(0);
    expect(computeScrollProgress(600, Infinity, 800)).toBe(0);
    expect(computeScrollProgress(600, 2000, NaN)).toBe(0);
  });
});
