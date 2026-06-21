import { headingPlainText, slugify } from './reportToc';

type MarkdownRuntime = {
  render: (markdown?: string | null) => string;
};

let runtimePromise: Promise<MarkdownRuntime> | null = null;
// Guard so the anchor-hardening hook is registered on DOMPurify exactly once.
let anchorHookRegistered = false;

// The unified markdown-report sanitization policy, shared (by value) with the
// admin (server/public/admin/report.js) and extension (extension/results.js)
// renderers. Covers all marked GFM output; h1-h6 so the portal TOC keeps
// working; NO img, NO raw HTML. `id` is allowed so heading anchors survive.
const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'id'];

/**
 * Validate a link href: only http/https survive. Returns the normalized URL
 * string, or null if the protocol is anything else (javascript:, data:, etc.).
 * Pure + dependency-free so it is unit-testable. Mirrors the admin's sanitizeUrl.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const base =
      typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function loadRuntime(): Promise<MarkdownRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([import('marked'), import('dompurify')]).then(
      ([{ marked, Renderer }, { default: DOMPurify }]) => {
        marked.setOptions({
          gfm: true,
          breaks: true,
        });

        // Harden anchors after sanitization, mirroring the admin's hook:
        // drop non-http(s) hrefs, force target=_blank + rel=noopener noreferrer.
        // addHook accumulates, so register it exactly once per module.
        if (!anchorHookRegistered) {
          DOMPurify.addHook('afterSanitizeAttributes', (node) => {
            if (node.nodeName === 'A') {
              const el = node as Element;
              const safeHref = safeHttpUrl(el.getAttribute('href'));
              if (!safeHref) {
                el.removeAttribute('href');
              } else {
                el.setAttribute('href', safeHref);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
              }
            }
          });
          anchorHookRegistered = true;
        }

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
            return DOMPurify.sanitize(String(html), {
              ALLOWED_TAGS,
              ALLOWED_ATTR,
              // Defense in depth: img/style/raw-HTML are not in ALLOWED_TAGS, but
              // forbid them explicitly so legal reports stay text+tables+links.
              FORBID_TAGS: ['img', 'style', 'iframe', 'script'],
              ALLOW_DATA_ATTR: false,
            });
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
