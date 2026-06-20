import { describe, it, expect } from 'vitest';
import { framesToReplay } from './wsSubscriptions';

describe('framesToReplay', () => {
  it('returns one subscribe frame per entry, preserving workspaceId', () => {
    const subs = new Map<string, string | null>([
      ['job-1', 'ws-1'],
      ['job-2', 'ws-2'],
    ]);
    expect(framesToReplay(subs)).toEqual([
      { type: 'subscribe', jobId: 'job-1', workspaceId: 'ws-1' },
      { type: 'subscribe', jobId: 'job-2', workspaceId: 'ws-2' },
    ]);
  });

  it('omits workspaceId when null or empty', () => {
    const subs = new Map<string, string | null>([
      ['job-1', null],
      ['job-2', ''],
    ]);
    expect(framesToReplay(subs)).toEqual([
      { type: 'subscribe', jobId: 'job-1', workspaceId: undefined },
      { type: 'subscribe', jobId: 'job-2', workspaceId: undefined },
    ]);
  });

  it('returns an empty array when there are no subscriptions', () => {
    expect(framesToReplay(new Map())).toEqual([]);
  });
});
