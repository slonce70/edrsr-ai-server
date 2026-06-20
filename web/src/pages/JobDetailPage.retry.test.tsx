import { describe, it, expect } from 'vitest';
import { buildRetryBody } from './jobRetry';

describe('buildRetryBody', () => {
  it('includes the websocket clientId', () => {
    expect(buildRetryBody('abc-123')).toEqual({ clientId: 'abc-123' });
  });
  it('throws when there is no clientId yet', () => {
    expect(() => buildRetryBody(null)).toThrow();
  });
});
