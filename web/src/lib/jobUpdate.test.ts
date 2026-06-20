import { describe, it, expect } from 'vitest';
import { mergeJobUpdate } from './jobUpdate';

describe('mergeJobUpdate', () => {
  it('applies only whitelisted job fields and preserves the rest', () => {
    const prev = { status: 'analyzing', progress: 10, matter_id: 'm1', prompt: 'p' };
    const next = mergeJobUpdate(prev, {
      status: 'completed',
      progress: 100,
      error_message: null,
      type: 'JOB_UPDATE',
      id: 'job-x',
      payload: [{ role: 'ai', content: 'x' }],
      foo: 'bar',
    });
    expect(next).toEqual({
      status: 'completed',
      progress: 100,
      error_message: null,
      matter_id: 'm1',
      prompt: 'p',
    });
  });

  it('ignores undefined values so existing fields are not clobbered', () => {
    const prev = { title: 'Kept', status: 'analyzing' };
    expect(mergeJobUpdate(prev, { title: undefined, status: 'completed' })).toEqual({
      title: 'Kept',
      status: 'completed',
    });
  });

  it('returns a new object (does not mutate prev)', () => {
    const prev = { status: 'queued' };
    const next = mergeJobUpdate(prev, { status: 'analyzing' });
    expect(next).not.toBe(prev);
    expect(prev.status).toBe('queued');
  });
});
