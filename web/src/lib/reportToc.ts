export type TocItem = { id: string; text: string; level: number };

/**
 * Convert heading text to a URL-safe, deterministic slug.
 * Unicode-aware: keeps Latin/Cyrillic/Ukrainian letters and digits, replaces
 * everything else with '-', collapses repeats, trims leading/trailing '-'.
 * Falls back to 'section' when nothing usable remains.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    // Replace any run of chars that are NOT unicode letters/numbers with '-'.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * Reduce inline markdown in a heading to plain text for the TOC label:
 * strip emphasis (*, _), inline code (`), and link/image syntax.
 * Exported so the markdown renderer computes ids from the IDENTICAL plain text
 * that the TOC uses, keeping heading ids and TOC links in sync.
 */
export function headingPlainText(raw: string): string {
  return raw
    // Images: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links: [label](url) -> label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Inline code: `code` -> code
    .replace(/`([^`]*)`/g, '$1')
    // Bold/italic emphasis markers
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assign stable, de-duplicated ids to a sequence of headings.
 * This is the single source of truth for id generation: BOTH the TOC extractor
 * and the markdown renderer call into the same de-dupe sequence (a slug that
 * repeats gets '-2', '-3', ... in order), guaranteeing TOC links match the ids
 * rendered onto the headings.
 */
export function assignHeadingIds(headings: { text: string; level: number }[]): TocItem[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const base = slugify(heading.text);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    return { id, text: heading.text, level: heading.level };
  });
}

/**
 * Extract a Table of Contents from markdown. Parses ATX headings (#, ##, ###)
 * at line starts, ignoring any inside fenced code blocks, returns only h1-h3.
 */
/**
 * Pick the "active" heading id for scroll-spy from a list of headings and their
 * current top offsets (relative to the viewport top, e.g. boundingClientRect.top).
 *
 * Rule: the active heading is the LAST one whose top has scrolled at/above the
 * activation line (`offset`, default 0 = viewport top). That is the section the
 * reader is currently inside. When nothing has been passed yet (we are still
 * above the first heading), fall back to the first heading so the TOC is never
 * blank while the report is in view. Returns null only for an empty list.
 *
 * Pure + deterministic so it can be unit-tested without a DOM.
 */
export function pickActiveId(
  headings: { id: string; top: number }[],
  offset = 0,
): string | null {
  if (headings.length === 0) return null;
  let activeId = headings[0].id;
  for (const heading of headings) {
    // A small epsilon keeps a heading "active" the moment it reaches the line.
    if (heading.top <= offset + 1) {
      activeId = heading.id;
    } else {
      break;
    }
  }
  return activeId;
}

export function extractToc(markdown: string | null | undefined): TocItem[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const headings: { text: string; level: number }[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const headingMatch = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (!headingMatch) continue;

    const level = headingMatch[1].length;
    // Strip trailing closing '#' sequence (closed ATX headings), then inline md.
    const rawText = headingMatch[2].replace(/\s+#+\s*$/, '').trim();
    const text = headingPlainText(rawText);
    if (!text) continue;

    headings.push({ text, level });
  }

  return assignHeadingIds(headings);
}
