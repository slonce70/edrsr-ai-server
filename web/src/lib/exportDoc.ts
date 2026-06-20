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

const DOC_STYLE =
  'body{font-family:Arial, sans-serif; padding:32px; color:#1f2937;}' +
  'h1{margin-bottom:16px;}' +
  'h1,h2,h3,h4{color:#0f172a;}' +
  '.meta{color:#555; font-size:12px; margin-bottom:24px;}' +
  'pre,code{white-space:pre-wrap; color:#0f766e;}' +
  'a{color:#0f766e;}';

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
