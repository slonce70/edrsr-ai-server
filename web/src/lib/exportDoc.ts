type WordDocOptions = {
  title: string;
  meta?: string;
  bodyHtml: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Print-window stylesheet shared by the report Print/PDF flows (JobDetail +
// Share). Mirrors DOC_STYLE plus list styling for the sources footer.
export const PRINT_STYLE =
  'body{font-family:Arial, sans-serif; padding:32px;} ' +
  'h1{margin-bottom:16px;} ' +
  '.meta{color:#555; font-size:12px; margin-bottom:24px;} ' +
  'pre,code{white-space:pre-wrap;} ' +
  'a{color:#0f766e;} ' +
  'table{width:100%; border-collapse:collapse; margin:0 0 14px; font-size:14px;} ' +
  'th,td{border:1px solid #d0d7de; padding:8px 12px; text-align:left; vertical-align:top;} ' +
  'thead th{background:#f6f8fa; font-weight:600;} ' +
  '.sources-footer{margin-top:24px;} ' +
  '.sources-footer ol{padding-left:20px;} ' +
  '.sources-footer li{margin-bottom:4px; word-break:break-all;}';

const DOC_STYLE =
  'body{font-family:Arial, sans-serif; padding:32px; color:#1f2937;}' +
  'h1{margin-bottom:16px;}' +
  'h1,h2,h3,h4{color:#0f172a;}' +
  '.meta{color:#555; font-size:12px; margin-bottom:24px;}' +
  'pre,code{white-space:pre-wrap; color:#0f766e;}' +
  'a{color:#0f766e;}' +
  'table{width:100%; border-collapse:collapse; margin:0 0 14px; font-size:14px;}' +
  'th,td{border:1px solid #d0d7de; padding:8px 12px; text-align:left; vertical-align:top; color:#1f2937;}' +
  'thead th{background:#f6f8fa; font-weight:600;}';

export function buildWordHtml(opts: WordDocOptions): string {
  const title = escapeHtml(opts.title);
  const metaBlock = opts.meta ? `<div class='meta'>${escapeHtml(opts.meta)}</div>` : '';
  return (
    "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
    "xmlns:w='urn:schemas-microsoft-com:office:word' " +
    "xmlns='http://www.w3.org/TR/REC-html40'>" +
    `<head><meta charset='utf-8'><title>${title}</title><style>${DOC_STYLE}</style></head>` +
    `<body><h1>${title}</h1>${metaBlock}${opts.bodyHtml}</body>` +
    '</html>'
  );
}

export function buildWordBlob(opts: WordDocOptions): Blob {
  const html = buildWordHtml(opts);
  return new Blob([html], { type: 'application/msword' });
}

type SourcesFooterOptions = {
  links: { url: string; decision_date?: string | null }[];
  coverageNote?: string;
  labels: { sourcesTitle: string; coverageLabel?: string };
};

// Builds the provenance footer appended to exported/printed reports so the
// deliverable carries its own source list. Pure + HTML-escaped; returns '' when
// there are no links so empty reports stay clean.
export function buildSourcesFooterHtml(opts: SourcesFooterOptions): string {
  const { links, coverageNote, labels } = opts;
  if (!links || links.length === 0) return '';

  const heading = `<h2>${escapeHtml(labels.sourcesTitle)}</h2>`;
  const coverage = coverageNote
    ? `<p class='sources-coverage'>${escapeHtml(coverageNote)}</p>`
    : '';
  const items = links
    .map((link) => {
      const url = escapeHtml(link.url);
      const date = link.decision_date ? ` · ${escapeHtml(link.decision_date)}` : '';
      return `<li>${url}${date}</li>`;
    })
    .join('');

  return `<div class='sources-footer'>${heading}${coverage}<ol>${items}</ol></div>`;
}
