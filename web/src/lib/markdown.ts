import { headingPlainText, slugify } from './reportToc';

type MarkdownRuntime = {
  render: (markdown?: string | null) => string;
};

let runtimePromise: Promise<MarkdownRuntime> | null = null;

async function loadRuntime(): Promise<MarkdownRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([import('marked'), import('dompurify')]).then(
      ([{ marked, Renderer }, { default: DOMPurify }]) => {
        marked.setOptions({
          gfm: true,
          breaks: true,
        });

        // Per-parse de-dupe state, reset before each parse so the Nth heading
        // with a colliding slug gets '-2', '-3', ... matching assignHeadingIds.
        let seen = new Map<string, number>();

        const renderer = new Renderer();
        const baseHeading = renderer.heading.bind(renderer);
        renderer.heading = function heading(token) {
          const html = baseHeading(token);
          // Only add ids to h1-h3 (the levels surfaced in the TOC).
          if (token.depth < 1 || token.depth > 3) return html;
          // Slugify the SAME plain text the TOC uses (inline markdown stripped),
          // so heading ids match the hrefs produced by extractToc.
          const base = slugify(headingPlainText(token.text));
          const count = seen.get(base) || 0;
          seen.set(base, count + 1);
          const id = count === 0 ? base : `${base}-${count + 1}`;
          // baseHeading emits "<hN>...". Inject the id into the opening tag.
          return html.replace(/^<h([1-6])/, `<h$1 id="${id}"`);
        };

        return {
          render(markdown?: string | null) {
            const content = markdown || '';
            seen = new Map<string, number>();
            const html = marked.parse(content, { renderer }) as string;
            return DOMPurify.sanitize(String(html), { ADD_ATTR: ['id'] });
          },
        };
      }
    );
  }

  return runtimePromise;
}

export async function renderMarkdown(markdown?: string | null) {
  const runtime = await loadRuntime();
  return runtime.render(markdown);
}
