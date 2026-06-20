import { memo, useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

type MarkdownViewProps = {
  markdown?: string | null;
};

// Memoized: the rendered report can hold live DOM Ranges (e.g. the in-report
// search highlights). Re-rendering this component re-applies dangerouslySetInnerHTML
// and replaces the text nodes, which would collapse any Range pointing into them.
// Since the output depends only on `markdown`, memo() keeps the DOM stable when an
// unrelated parent state change (search query/active match) triggers a re-render.
export const MarkdownView = memo(function MarkdownView({ markdown }: MarkdownViewProps) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let active = true;
    renderMarkdown(markdown || '')
      .then((nextHtml) => {
        if (!active) return;
        setHtml(nextHtml);
      })
      .catch(() => {
        if (!active) return;
        setHtml('');
      });

    return () => {
      active = false;
    };
  }, [markdown]);

  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});
