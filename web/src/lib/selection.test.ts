import { describe, it, expect } from 'vitest';
import { toggle, selectAll, clear, isAllSelected, intersect } from './selection';

describe('selection', () => {
  describe('toggle', () => {
    it('adds an id that is not present', () => {
      const next = toggle(new Set<string>(), 'a');
      expect([...next]).toEqual(['a']);
    });

    it('removes an id that is present', () => {
      const next = toggle(new Set(['a', 'b']), 'a');
      expect([...next].sort()).toEqual(['b']);
    });

    it('returns a new set without mutating the input', () => {
      const prev = new Set(['a']);
      const next = toggle(prev, 'b');
      expect(next).not.toBe(prev);
      expect([...prev]).toEqual(['a']);
    });
  });

  describe('selectAll', () => {
    it('adds all ids', () => {
      const next = selectAll(new Set<string>(), ['a', 'b']);
      expect([...next].sort()).toEqual(['a', 'b']);
    });

    it('is idempotent when ids are already selected', () => {
      const next = selectAll(new Set(['a', 'b']), ['a', 'b']);
      expect([...next].sort()).toEqual(['a', 'b']);
    });

    it('keeps existing ids outside the given list', () => {
      const next = selectAll(new Set(['x']), ['a']);
      expect([...next].sort()).toEqual(['a', 'x']);
    });
  });

  describe('clear', () => {
    it('returns an empty set', () => {
      expect([...clear()]).toEqual([]);
    });
  });

  describe('isAllSelected', () => {
    it('is true when every id is selected', () => {
      expect(isAllSelected(new Set(['a', 'b']), ['a', 'b'])).toBe(true);
    });

    it('is false when some ids are missing', () => {
      expect(isAllSelected(new Set(['a']), ['a', 'b'])).toBe(false);
    });

    it('is false for an empty ids list (edge case)', () => {
      expect(isAllSelected(new Set(['a']), [])).toBe(false);
      expect(isAllSelected(new Set<string>(), [])).toBe(false);
    });
  });

  describe('intersect', () => {
    it('prunes ids that are no longer present', () => {
      const next = intersect(new Set(['a', 'b', 'c']), ['a', 'c']);
      expect([...next].sort()).toEqual(['a', 'c']);
    });

    it('returns an empty set when nothing overlaps', () => {
      expect([...intersect(new Set(['a']), ['b', 'c'])]).toEqual([]);
    });

    it('does not mutate the input set', () => {
      const prev = new Set(['a', 'b']);
      const next = intersect(prev, ['a']);
      expect(next).not.toBe(prev);
      expect([...prev].sort()).toEqual(['a', 'b']);
    });
  });
});
