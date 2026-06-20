import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';
import { extractToc } from './reportToc';

describe('renderMarkdown heading ids', () => {
  it('adds an id attribute to a Cyrillic heading and DOMPurify keeps it', async () => {
    const html = await renderMarkdown('## АНАЛІЗ');
    expect(html).toMatch(/id="/);
    expect(html).toContain('id="аналіз"');
  });

  it('renders ids that match the ids extractToc produces (links match headings)', async () => {
    const md = [
      '# АНАЛІЗ СТРАТЕГІЙ',
      '## Огляд',
      '## Огляд',
      '### **Висновок**',
      '## Огляд',
    ].join('\n');

    const html = await renderMarkdown(md);
    const renderedIds = Array.from(html.matchAll(/<h[1-3] id="([^"]+)"/g)).map((m) => m[1]);
    const tocIds = extractToc(md).map((item) => item.id);

    expect(renderedIds).toEqual(tocIds);
  });

  it('does not add ids to h4+ headings', async () => {
    const html = await renderMarkdown('#### Deep');
    expect(html).not.toMatch(/<h4 id=/);
  });
});
