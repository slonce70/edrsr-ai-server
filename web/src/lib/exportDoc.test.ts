import { describe, it, expect } from 'vitest';
import { buildSourcesFooterHtml, buildWordHtml } from './exportDoc';

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

describe('buildSourcesFooterHtml', () => {
  const labels = { sourcesTitle: 'Джерела' };

  it('includes the heading and each url', () => {
    const html = buildSourcesFooterHtml({
      links: [
        { url: 'https://example.com/a' },
        { url: 'https://example.com/b' },
      ],
      labels,
    });
    expect(html).toContain('<h2>Джерела</h2>');
    expect(html).toContain('https://example.com/a');
    expect(html).toContain('https://example.com/b');
    expect(html).toContain('<ol>');
  });

  it('escapes urls containing < and &', () => {
    const html = buildSourcesFooterHtml({
      links: [{ url: 'https://example.com/?a=1&b=2<script>' }],
      labels,
    });
    expect(html).toContain('https://example.com/?a=1&amp;b=2&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('appends the decision date when provided', () => {
    const html = buildSourcesFooterHtml({
      links: [{ url: 'https://example.com/a', decision_date: '2024-01-15' }],
      labels,
    });
    expect(html).toContain('https://example.com/a · 2024-01-15');
  });

  it('includes the coverage note when given', () => {
    const html = buildSourcesFooterHtml({
      links: [{ url: 'https://example.com/a' }],
      coverageNote: 'Покриття: 3/5',
      labels,
    });
    expect(html).toContain("<p class='sources-coverage'>Покриття: 3/5</p>");
  });

  it('omits the coverage note when not given', () => {
    const html = buildSourcesFooterHtml({
      links: [{ url: 'https://example.com/a' }],
      labels,
    });
    expect(html).not.toContain('sources-coverage');
  });

  it('returns an empty string (no <ol>) when links is empty', () => {
    expect(buildSourcesFooterHtml({ links: [], labels })).toBe('');
  });
});
