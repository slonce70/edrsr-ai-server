import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob, downloadText } from './download';

describe('download helpers', () => {
  const revoke = vi.fn();
  let anchors: HTMLAnchorElement[] = [];
  let createElement: typeof document.createElement;

  beforeEach(() => {
    // jsdom does not implement object URLs; define stubs so the click path runs.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = revoke;
    revoke.mockClear();
    anchors = [];
    // Capture created anchors and neutralise click so no navigation happens.
    createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === 'a') {
        el.click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloadText sets the download attribute and triggers a click', () => {
    downloadText('report.txt', 'hello');

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('report.txt');
    expect(anchors[0].click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:mock');
  });

  it('downloadBlob sets the download attribute and triggers a click', () => {
    downloadBlob('report.doc', new Blob(['x'], { type: 'application/msword' }));

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('report.doc');
    expect(anchors[0].click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:mock');
  });
});
