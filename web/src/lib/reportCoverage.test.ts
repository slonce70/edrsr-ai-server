import { describe, it, expect } from 'vitest';
import { deriveCompleteness } from './reportCoverage';

describe('deriveCompleteness', () => {
  it('marks a full 25/25 report with no failures and not partial as complete', () => {
    const result = deriveCompleteness({
      processedLinks: 25,
      totalLinks: 25,
      links: Array.from({ length: 25 }, () => ({ status: 'completed' })),
      qualityPartial: false,
    });
    expect(result).toEqual({
      processed: 25,
      total: 25,
      failed: 0,
      pct: 100,
      complete: true,
    });
  });

  it('treats a quality-partial flag as incomplete even at 25/25', () => {
    const result = deriveCompleteness({
      processedLinks: 25,
      totalLinks: 25,
      links: Array.from({ length: 25 }, () => ({ status: 'completed' })),
      qualityPartial: true,
    });
    expect(result.complete).toBe(false);
    expect(result.processed).toBe(25);
    expect(result.total).toBe(25);
    expect(result.failed).toBe(0);
    expect(result.pct).toBe(100);
  });

  it('counts failed links and marks incomplete', () => {
    const links = [
      ...Array.from({ length: 22 }, () => ({ status: 'processed' })),
      { status: 'error' },
      { status: 'failed' },
      { status: 'error' },
    ];
    const result = deriveCompleteness({
      processedLinks: 22,
      totalLinks: 25,
      links,
    });
    expect(result.failed).toBe(3);
    expect(result.processed).toBe(22);
    expect(result.total).toBe(25);
    expect(result.complete).toBe(false);
    expect(result.pct).toBe(88);
  });

  it('normalizes both processed and completed statuses as processed', () => {
    const result = deriveCompleteness({
      links: [{ status: 'processed' }, { status: 'completed' }, { status: 'error' }],
    });
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(3);
    expect(result.complete).toBe(false);
  });

  it('derives counts from processed/total when links are absent', () => {
    const result = deriveCompleteness({ processedLinks: 18, totalLinks: 25 });
    expect(result.processed).toBe(18);
    expect(result.total).toBe(25);
    // failed inferred from the gap when no per-link data is available
    expect(result.failed).toBe(7);
    expect(result.complete).toBe(false);
    expect(result.pct).toBe(72);
  });

  it('is complete when processed equals total with no links and not partial', () => {
    const result = deriveCompleteness({ processedLinks: 10, totalLinks: 10 });
    expect(result).toEqual({
      processed: 10,
      total: 10,
      failed: 0,
      pct: 100,
      complete: true,
    });
  });

  it('is safe with zero total', () => {
    const result = deriveCompleteness({ processedLinks: 0, totalLinks: 0, links: [] });
    expect(result).toEqual({
      processed: 0,
      total: 0,
      failed: 0,
      pct: 0,
      complete: false,
    });
  });

  it('guards null/undefined inputs', () => {
    const result = deriveCompleteness({
      processedLinks: null,
      totalLinks: null,
    });
    expect(result).toEqual({
      processed: 0,
      total: 0,
      failed: 0,
      pct: 0,
      complete: false,
    });
  });

  it('prefers explicit totalLinks over links.length', () => {
    const result = deriveCompleteness({
      totalLinks: 30,
      links: [{ status: 'completed' }, { status: 'completed' }],
    });
    expect(result.total).toBe(30);
    expect(result.processed).toBe(2);
  });

  it('clamps processed to total and computes pct correctly', () => {
    const result = deriveCompleteness({ processedLinks: 12, totalLinks: 8 });
    expect(result.processed).toBe(8);
    expect(result.total).toBe(8);
    expect(result.pct).toBe(100);
    expect(result.complete).toBe(true);
  });
});
