import { describe, it, expect } from 'vitest';
import { renderMarkdown, safeHttpUrl } from './markdown';
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

describe('renderMarkdown sanitization (unified policy)', () => {
  it('strips a <script> tag from the input', async () => {
    const html = await renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('alert(1)');
  });

  it('strips <img> (including onerror payloads)', async () => {
    const html = await renderMarkdown('![x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/onerror/i);
  });

  it('hardens an http(s) link with target + rel=noopener noreferrer', async () => {
    const html = await renderMarkdown('[ok](https://example.com)');
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/?"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('drops the href on a javascript: link', async () => {
    const html = await renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('alert(1)');
  });

  it('still renders headings (with ids), tables, code, lists, blockquotes, em/strong', async () => {
    const md = [
      '## Section',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '- item',
      '',
      '> quote',
      '',
      '**bold** and *italic*',
    ].join('\n');
    const html = await renderMarkdown(md);
    expect(html).toMatch(/<h2 id="section"/);
    expect(html).toContain('<table>');
    expect(html).toMatch(/<th[^>]*>A<\/th>/);
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });
});

describe('safeHttpUrl', () => {
  it('accepts http and https', () => {
    expect(safeHttpUrl('http://example.com/')).toBe('http://example.com/');
    expect(safeHttpUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('rejects javascript:, data:, and empty', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
