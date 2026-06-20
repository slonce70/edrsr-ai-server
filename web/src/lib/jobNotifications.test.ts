import { describe, it, expect } from 'vitest';
import { createJobNotifyState, reduceJobEvent } from './jobNotifications';

describe('reduceJobEvent', () => {
  it('notifies once on active -> completed for a tracked job', () => {
    const state = createJobNotifyState();
    expect(reduceJobEvent(state, { id: 'a', status: 'processing' }).notify).toBeUndefined();
    const result = reduceJobEvent(state, { id: 'a', status: 'completed', title: 'Case A' });
    expect(result.notify).toEqual({ jobId: 'a', title: 'Case A' });
  });

  it('does not notify for a completed-only job that was never active', () => {
    const state = createJobNotifyState();
    const result = reduceJobEvent(state, { id: 'b', status: 'completed', title: 'Case B' });
    expect(result.notify).toBeUndefined();
  });

  it('notifies once across active -> active -> completed', () => {
    const state = createJobNotifyState();
    expect(reduceJobEvent(state, { id: 'c', status: 'queued' }).notify).toBeUndefined();
    expect(reduceJobEvent(state, { id: 'c', status: 'analyzing' }).notify).toBeUndefined();
    const result = reduceJobEvent(state, { id: 'c', status: 'completed', title: 'Case C' });
    expect(result.notify).toEqual({ jobId: 'c', title: 'Case C' });
  });

  it('notifies only once when two completed events arrive', () => {
    const state = createJobNotifyState();
    reduceJobEvent(state, { id: 'd', status: 'processing' });
    const first = reduceJobEvent(state, { id: 'd', status: 'completed', title: 'Case D' });
    const second = reduceJobEvent(state, { id: 'd', status: 'completed', title: 'Case D' });
    expect(first.notify).toEqual({ jobId: 'd', title: 'Case D' });
    expect(second.notify).toBeUndefined();
  });

  it('tracks multiple jobs independently', () => {
    const state = createJobNotifyState();
    reduceJobEvent(state, { id: 'e', status: 'processing' });
    reduceJobEvent(state, { id: 'f', status: 'downloading' });
    expect(reduceJobEvent(state, { id: 'e', status: 'completed', title: 'E' }).notify).toEqual({
      jobId: 'e',
      title: 'E',
    });
    expect(reduceJobEvent(state, { id: 'f', status: 'completed', title: 'F' }).notify).toEqual({
      jobId: 'f',
      title: 'F',
    });
  });

  it('ignores events missing an id or status', () => {
    const state = createJobNotifyState();
    expect(reduceJobEvent(state, { status: 'completed' }).notify).toBeUndefined();
    expect(reduceJobEvent(state, { id: 'g' }).notify).toBeUndefined();
    expect(state.tracked.size).toBe(0);
  });

  it('does not notify when a tracked job ends in error (only completed toasts)', () => {
    const state = createJobNotifyState();
    reduceJobEvent(state, { id: 'h', status: 'processing' });
    expect(reduceJobEvent(state, { id: 'h', status: 'error' }).notify).toBeUndefined();
  });

  it('prunes a tracked job from the set when it ends in error (no notify)', () => {
    const state = createJobNotifyState();
    reduceJobEvent(state, { id: 'h', status: 'processing' });
    expect(state.tracked.has('h')).toBe(true);
    const result = reduceJobEvent(state, { id: 'h', status: 'error' });
    expect(result.notify).toBeUndefined();
    expect(state.tracked.has('h')).toBe(false);
    expect(state.tracked.size).toBe(0);
  });

  it('prunes a tracked job from the set when it is cancelled (no notify)', () => {
    const state = createJobNotifyState();
    reduceJobEvent(state, { id: 'i', status: 'analyzing' });
    expect(state.tracked.has('i')).toBe(true);
    const result = reduceJobEvent(state, { id: 'i', status: 'cancelled' });
    expect(result.notify).toBeUndefined();
    expect(state.tracked.has('i')).toBe(false);
  });

  it('prunes a tracked job from the set when it ends in failed (no notify)', () => {
    const state = createJobNotifyState();
    reduceJobEvent(state, { id: 'j', status: 'queued' });
    const result = reduceJobEvent(state, { id: 'j', status: 'failed' });
    expect(result.notify).toBeUndefined();
    expect(state.tracked.has('j')).toBe(false);
  });

  it('does not grow the tracked set across many terminal (non-completed) events', () => {
    const state = createJobNotifyState();
    for (let n = 0; n < 100; n += 1) {
      reduceJobEvent(state, { id: `t${n}`, status: 'processing' });
      const status = n % 3 === 0 ? 'error' : n % 3 === 1 ? 'failed' : 'cancelled';
      const result = reduceJobEvent(state, { id: `t${n}`, status });
      expect(result.notify).toBeUndefined();
    }
    expect(state.tracked.size).toBe(0);
  });
});
