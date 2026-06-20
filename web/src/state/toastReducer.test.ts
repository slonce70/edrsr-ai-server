import { describe, it, expect } from 'vitest';
import { MAX_TOASTS, toastReducer, type Toast } from './toastReducer';

const toast = (id: string, message = 'm'): Toast => ({ id, message, variant: 'info' });

describe('toastReducer', () => {
  it('appends an added toast to the end', () => {
    const state = [toast('t1')];
    const next = toastReducer(state, { type: 'add', toast: toast('t2') });
    expect(next.map((entry) => entry.id)).toEqual(['t1', 't2']);
  });

  it('drops the oldest and keeps the newest MAX_TOASTS when adding past the cap', () => {
    let state: Toast[] = [];
    for (let i = 1; i <= MAX_TOASTS + 2; i += 1) {
      state = toastReducer(state, { type: 'add', toast: toast(`t${i}`) });
    }
    expect(state).toHaveLength(MAX_TOASTS);
    expect(state.map((entry) => entry.id)).toEqual(['t3', 't4', 't5', 't6']);
  });

  it('dismiss removes the matching id and leaves the others', () => {
    const state = [toast('t1'), toast('t2'), toast('t3')];
    const next = toastReducer(state, { type: 'dismiss', id: 't2' });
    expect(next.map((entry) => entry.id)).toEqual(['t1', 't3']);
  });

  it('dismiss of an unknown id is a no-op', () => {
    const state = [toast('t1'), toast('t2')];
    const next = toastReducer(state, { type: 'dismiss', id: 'missing' });
    expect(next.map((entry) => entry.id)).toEqual(['t1', 't2']);
  });

  it('clear empties the state', () => {
    const state = [toast('t1'), toast('t2')];
    expect(toastReducer(state, { type: 'clear' })).toEqual([]);
  });

  it('never mutates the input array', () => {
    const state = [toast('t1'), toast('t2')];
    const snapshot = [...state];

    const added = toastReducer(state, { type: 'add', toast: toast('t3') });
    expect(added).not.toBe(state);

    const dismissed = toastReducer(state, { type: 'dismiss', id: 't1' });
    expect(dismissed).not.toBe(state);

    const cleared = toastReducer(state, { type: 'clear' });
    expect(cleared).not.toBe(state);

    expect(state).toEqual(snapshot);
  });
});
