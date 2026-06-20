export type LinkInputStats = {
  valid: string[]; // unique valid ЄДРСР /Review/ links, in first-seen order
  ignored: number; // URLs found that are NOT ЄДРСР /Review/ links
  duplicates: number; // valid links that repeated (beyond the first occurrence)
};

const EDRSR_REVIEW = /reyestr\.court\.gov\.ua\/Review\//i;

/**
 * Parse pasted free text into ЄДРСР case links with transparency counts.
 * Mirrors the existing extractLinks behaviour (any http(s) URL, strip trailing
 * punctuation, keep only reyestr /Review/ links, dedupe) but also reports how many
 * URLs were ignored (not ЄДРСР) and how many valid links were duplicates — so the
 * lawyer can trust what the system understood from a messy list.
 */
export function analyzeLinkInput(text: string): LinkInputStats {
  const matches = (text || '').match(/https?:\/\/[^\s,;]+/gi) || [];
  const seen = new Set<string>();
  const valid: string[] = [];
  let ignored = 0;
  let duplicates = 0;
  for (const raw of matches) {
    const url = raw.replace(/[),.]+$/g, '').trim();
    if (!EDRSR_REVIEW.test(url)) {
      ignored += 1;
      continue;
    }
    if (seen.has(url)) {
      duplicates += 1;
      continue;
    }
    seen.add(url);
    valid.push(url);
  }
  return { valid, ignored, duplicates };
}
