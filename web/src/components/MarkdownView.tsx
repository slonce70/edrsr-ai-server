import { renderMarkdown } from '../lib/markdown';

type MarkdownViewProps = {
  markdown?: string | null;
};

export function MarkdownView({ markdown }: MarkdownViewProps) {
  const html = renderMarkdown(markdown || '');
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
