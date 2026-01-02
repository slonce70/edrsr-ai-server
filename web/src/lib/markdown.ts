import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(markdown?: string | null) {
  const content = markdown || '';
  const html = marked.parse(content) as string;
  return DOMPurify.sanitize(String(html));
}
