import { describe, it, expect } from 'vitest';
import { computeJobStats } from './dashboardStats';

describe('computeJobStats', () => {
  it('computes active as total minus completed minus error', () => {
    expect(computeJobStats({ total: 10, completed: 6, error: 1 })).toEqual({
      total: 10,
      completed: 6,
      error: 1,
      active: 3,
    });
  });
  it('clamps active to 0 when completed + error exceeds total', () => {
    expect(computeJobStats({ total: 5, completed: 4, error: 3 }).active).toBe(0);
  });
  it('coerces non-finite and negative inputs to 0', () => {
    expect(computeJobStats({ total: NaN, completed: -2, error: Infinity })).toEqual({
      total: 0,
      completed: 0,
      error: 0,
      active: 0,
    });
  });
  it('floors fractional inputs', () => {
    expect(computeJobStats({ total: 9.9, completed: 2.4, error: 1.6 })).toEqual({
      total: 9,
      completed: 2,
      error: 1,
      active: 6,
    });
  });
});
