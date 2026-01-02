const MARKERS = [
  'СУД ВСТАНОВИВ',
  'СУД ВСТАНОВИЛ',
  'ВСТАНОВИВ',
  'ВСТАНОВИЛ',
  'ПОСТАНОВИВ',
  'ПОСТАНОВИЛ',
  'УХВАЛИВ',
  'УХВАЛИЛ',
  'ВИРІШИВ',
  'ВИРІШИЛ',
  'РЕЗОЛЮТИВНА ЧАСТИНА',
];

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractEvidenceSnippet(content, maxLength = 900) {
  if (!content) return null;
  const normalized = normalizeText(content);
  if (!normalized) return null;

  const upper = normalized.toUpperCase();
  let start = 0;
  for (const marker of MARKERS) {
    const idx = upper.indexOf(marker);
    if (idx >= 0) {
      start = idx;
      break;
    }
  }

  const snippet = normalized.slice(start, start + maxLength).trim();
  if (!snippet) return null;
  return snippet;
}
