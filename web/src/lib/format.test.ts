import { describe, it, expect } from 'vitest';
import { statusLabels } from './format';

describe('statusLabels', () => {
  it('returns the full status map keyed by status with status.* label values', () => {
    const t = (key: string) => key;
    expect(statusLabels(t)).toEqual({
      queued: 'status.queued',
      retrying: 'status.retrying',
      processing: 'status.processing',
      downloading: 'status.downloading',
      analyzing: 'status.analyzing',
      completed: 'status.completed',
      error: 'status.error',
      failed: 'status.failed',
      cancelled: 'status.cancelled',
      pending: 'status.pending',
      unknown: 'status.unknown',
    });
  });
});
