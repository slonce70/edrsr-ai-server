import { describe, it, expect } from 'vitest';
import { activeCount, statusSegments } from './overviewStats';

describe('activeCount', () => {
  it('sums all active status keys', () => {
    expect(
      activeCount({
        queued: 1,
        retrying: 2,
        processing: 3,
        downloading: 4,
        analyzing: 5,
        pending: 6,
      })
    ).toBe(21);
  });
  it('treats missing keys as 0 and ignores non-active keys', () => {
    expect(activeCount({ processing: 2, completed: 10, error: 4 })).toBe(2);
  });
  it('is 0 for an empty map', () => {
    expect(activeCount({})).toBe(0);
  });
  it('ignores non-finite and negative values', () => {
    expect(activeCount({ processing: NaN, queued: -3, pending: 2 })).toBe(2);
  });
});

describe('statusSegments', () => {
  it('buckets statuses into completed / active / error / other', () => {
    const segments = statusSegments(
      { completed: 5, processing: 2, queued: 1, error: 1, failed: 1, pending: 0 },
      10
    );
    const byKey = Object.fromEntries(segments.map((s) => [s.key, s.count]));
    expect(byKey.completed).toBe(5);
    expect(byKey.active).toBe(3);
    expect(byKey.error).toBe(2);
    expect(byKey.other).toBeUndefined();
  });

  it('folds cancelled into the error bucket', () => {
    const segments = statusSegments({ completed: 1, cancelled: 1 }, 2);
    const error = segments.find((s) => s.key === 'error');
    expect(error?.count).toBe(1);
  });

  it('puts unknown statuses into the other bucket', () => {
    const segments = statusSegments({ completed: 2, weird: 3 }, 5);
    const other = segments.find((s) => s.key === 'other');
    expect(other?.count).toBe(3);
  });

  it('computes percentages that sum to ~100', () => {
    const segments = statusSegments({ completed: 5, processing: 3, error: 2 }, 10);
    const sum = segments.reduce((acc, s) => acc + s.pct, 0);
    expect(sum).toBeCloseTo(100, 5);
  });

  it('drops zero-count segments', () => {
    const segments = statusSegments({ completed: 4 }, 4);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ key: 'completed', count: 4, pct: 100 });
  });

  it('is safe with a zero total (no segments, no division by zero)', () => {
    expect(statusSegments({}, 0)).toEqual([]);
  });
});
