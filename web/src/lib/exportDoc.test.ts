import { describe, it, expect } from 'vitest';
import { buildWordHtml } from './exportDoc';

describe('buildWordHtml', () => {
  it('escapes the title and does not emit it raw', () => {
    const html = buildWordHtml({
      title: 'Report <b> & "quotes"',
      bodyHtml: '<p>body</p>',
    });
    expect(html).toContain('Report &lt;b&gt; &amp; &quot;quotes&quot;');
    expect(html).not.toContain('Report <b> & "quotes"');
  });

  it('includes the body html verbatim', () => {
    const body = '<h2>Heading</h2><p>Some <strong>content</strong></p>';
    const html = buildWordHtml({ title: 'T', bodyHtml: body });
    expect(html).toContain(body);
  });

  it('includes the Word xmlns namespace and a Word-openable structure', () => {
    const html = buildWordHtml({ title: 'T', bodyHtml: '<p>x</p>' });
    expect(html).toContain("xmlns:w='urn:schemas-microsoft-com:office:word'");
    expect(html).toContain("xmlns:o='urn:schemas-microsoft-com:office:office'");
    expect(html).toContain("xmlns='http://www.w3.org/TR/REC-html40'");
    expect(html).toContain("<meta charset='utf-8'>");
    expect(html).toMatch(/^<html /);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('renders the title as an h1', () => {
    const html = buildWordHtml({ title: 'My Title', bodyHtml: '<p>x</p>' });
    expect(html).toContain('<h1>My Title</h1>');
  });

  it('includes the meta div when meta is provided', () => {
    const html = buildWordHtml({
      title: 'T',
      meta: 'Created 2026 | 3 / 3',
      bodyHtml: '<p>x</p>',
    });
    expect(html).toContain("<div class='meta'>Created 2026 | 3 / 3</div>");
  });

  it('omits the meta div when meta is not provided', () => {
    const html = buildWordHtml({ title: 'T', bodyHtml: '<p>x</p>' });
    expect(html).not.toContain("class='meta'");
  });

  it('escapes the meta content', () => {
    const html = buildWordHtml({
      title: 'T',
      meta: 'a & b <c>',
      bodyHtml: '<p>x</p>',
    });
    expect(html).toContain("<div class='meta'>a &amp; b &lt;c&gt;</div>");
  });
});
