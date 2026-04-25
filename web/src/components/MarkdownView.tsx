import { useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

type MarkdownViewProps = {
  markdown?: string | null;
};

export function MarkdownView({ markdown }: MarkdownViewProps) {
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
}
