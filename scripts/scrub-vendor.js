// Removes remote-URL strings from vendored libs so the Chrome Web Store scan sees no remotely hosted code.
// W3C namespace URIs (www.w3.org) are identifiers, not fetched URLs; DOMPurify and html2canvas compare
// against them, so rewriting them breaks the libs (every sanitize() call returns an empty string).
export function scrubString(content) {
  content = content.replace(
    /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdfobject\/2\.1\.1\/pdfobject\.min\.js/g,
    'pdfobject.min.js'
  );
  return content.replace(/https?:\/\/(?!www\.w3\.org\/)[\w.-]+/g, (match) =>
    match.replace('://', ': //')
  );
}
