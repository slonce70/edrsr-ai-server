// Admin Report Page Script
/* global DOMPurify */
let purifyHookRegistered = false;
const adminI18n = window.AdminI18n || {
  t: (key) => key,
  applyTranslations: () => {},
};
const { t, applyTranslations } = adminI18n;
const TOKEN_STORAGE_KEY = 'admin_token';

document.addEventListener('DOMContentLoaded', async function () {
  applyTranslations(document);
  const decodeTextarea = document.createElement('textarea');
  const escapeDiv = document.createElement('div');

  // DOM elements
  const elements = {
    jobTitle: document.getElementById('jobTitle'),
    jobMetadata: document.getElementById('jobMetadata'),
    analysisResult: document.getElementById('analysisResult'),
    statusBadge: document.getElementById('statusBadge'),
    copyBtn: document.getElementById('copyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    printBtn: document.getElementById('printBtn'),
  };

  let currentJobData = null;
  let analysisText = '';
  let analysisTextForExport = '';

  // Get job ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  if (!jobId) {
    showError(t('messages.reportIdMissing'));
    return;
  }

  // One-time legacy purge: remove any token previously mirrored into localStorage.
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  const authToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);

  if (!authToken) {
    window.location.href = '/admin';
    return;
  }

  // Configure marked.js for rendering markdown
  if (window.marked) {
    const renderer = new marked.Renderer();
    renderer.html = () => '';
    renderer.image = () => '';
    renderer.text = (text) => escapeHtml(text);
    renderer.link = (href, title, text) => {
      const safeHref = sanitizeUrl(href);
      if (!safeHref) return escapeHtml(text);
      const safeTitle = title ? escapeHtml(title) : '';
      return `<a href="${safeHref}" title="${safeTitle}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        text
      )}</a>`;
    };
    marked.setOptions({ renderer, mangle: false, headerIds: false });
  }

  // Load job report
  try {
    const response = await fetch(`/api/admin/jobs/${jobId}/report`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.location.href = '/admin';
        return;
      }
      throw new Error(response.statusText || `HTTP ${response.status}`);
    }

    const data = await response.json();
    currentJobData = data.job;
    analysisText = typeof data.analysis === 'string' ? data.analysis : String(data.analysis || '');
    analysisTextForExport = decodeHtmlEntitiesDeep(analysisText);

    renderReport(data.job, data.analysis);
    setupEventListeners();
  } catch (error) {
    showError(t('messages.reportLoadError', { message: error.message }));
  }

  function renderReport(job, analysis) {
    // Update page title
    elements.jobTitle.textContent = job.title || t('report.title');
    document.title = `${job.title || t('report.reportTitle')} - EDRSR-AI Admin`;

    // Update status badge
    elements.statusBadge.textContent = getStatusText(job.status);
    elements.statusBadge.className = `status-badge status-${job.status}`;

    // Update metadata
    elements.jobMetadata.innerHTML = `
            <li><strong>${t('report.metadataId')}:</strong> ${escapeHtml(job.id)}</li>
            <li><strong>${t('report.metadataStatus')}:</strong> ${escapeHtml(getStatusText(job.status))}</li>
            <li><strong>${t('report.metadataCreated')}:</strong> ${escapeHtml(
              formatReportDateTime(job.created_at)
            )}</li>
            <li><strong>${t('report.metadataUpdated')}:</strong> ${escapeHtml(
              formatReportDateTime(job.updated_at)
            )}</li>
            <li><strong>${t('report.metadataLinks')}:</strong> ${escapeHtml(
              String(job.processed_links)
            )} / ${escapeHtml(String(job.total_links))}</li>
        `;

    const analysisContent = typeof analysis === 'string' ? analysis : analysisText;

    // Render analysis content
    if (window.marked) {
      // Try to render as markdown first
      try {
        elements.analysisResult.innerHTML = sanitizeReportHtml(marked.parse(analysisContent));
      } catch {
        // Fall back to plain text with line breaks
        elements.analysisResult.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(analysisContent)}</pre>`;
      }
    } else {
      // No markdown library, use plain text
      elements.analysisResult.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(analysisContent)}</pre>`;
    }
  }

  function setupEventListeners() {
    // Copy button
    elements.copyBtn.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(analysisTextForExport || analysisText);
        showSuccess(t('messages.reportCopySuccess'));
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = analysisTextForExport || analysisText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showSuccess(t('messages.reportCopySuccess'));
      }
    });

    // Download button
    elements.downloadBtn.addEventListener('click', function () {
      downloadReport();
    });

    // Print button
    elements.printBtn.addEventListener('click', function () {
      window.print();
    });
  }

  function downloadReport() {
    if (!currentJobData || !analysisText) return;

    const baseName = currentJobData.title || t('report.reportTitle');
    const safeBase =
      String(baseName)
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim() || t('report.reportTitle');
    const fileName = `${safeBase}_${currentJobData.id}.txt`;
    const blob = new Blob([analysisTextForExport || analysisText], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess(t('messages.reportDownloadSuccess'));
  }

  function showError(message) {
    elements.analysisResult.innerHTML = `
            <div class="error-message">
                <strong>${t('common.errorLabel')}:</strong> ${escapeHtml(message)}
            </div>
        `;
  }

  function showSuccess(message) {
    // Simple success notification (you could enhance this with a toast)
    const notification = document.createElement('div');
    notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 15px 20px;
            border-radius: 6px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  function getStatusText(status) {
    const key = `report.status.${status}`;
    const value = t(key);
    return value === key ? status : value;
  }

  function formatReportDateTime(dateString) {
    if (!dateString) return t('report.na');
    const date = new Date(dateString);
    return date.toLocaleString('uk-UA');
  }

  function sanitizeUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function sanitizeReportHtml(html) {
    // Blocks raw HTML/script surfaces such as <script, onerror, javascript:, and data:text/html.
    // Delegates to the vetted DOMPurify (Cure53) engine for parity with the React portal.
    // Tags allowed: p, ul, ol, li, strong, em, code, pre, blockquote, a, h1-h4, hr, br,
    // table, thead, tbody, tr, th, td. DOMPurify strips event handlers and script/style/iframe
    // by default; the allowlist + the anchor hook reproduce the old hand-rolled guarantees.
    if (!window.DOMPurify) {
      // Surface a throw so the caller's try/catch falls back to the safe escaped <pre>.
      throw new Error('DOMPurify unavailable');
    }

    // DOMPurify.addHook accumulates, so register the anchor-hardening hook exactly once.
    if (!purifyHookRegistered) {
      DOMPurify.addHook('afterSanitizeAttributes', function (node) {
        if (node.tagName === 'A' || node.nodeName === 'A') {
          const safeHref = sanitizeUrl(node.getAttribute('href') || '');
          if (!safeHref) {
            node.removeAttribute('href');
          } else {
            node.setAttribute('href', safeHref);
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
          }
        }
      });
      purifyHookRegistered = true;
    }

    return DOMPurify.sanitize(String(html || ''), {
      ALLOWED_TAGS: [
        'p',
        'ul',
        'ol',
        'li',
        'strong',
        'em',
        'code',
        'pre',
        'blockquote',
        'a',
        'h1',
        'h2',
        'h3',
        'h4',
        'hr',
        'br',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
    });
  }

  function escapeHtml(text) {
    escapeDiv.textContent = decodeHtmlEntitiesDeep(text);
    return escapeDiv.innerHTML;
  }

  function decodeHtmlEntitiesDeep(text, maxPasses = 3) {
    let current = text == null ? '' : String(text);
    for (let i = 0; i < maxPasses; i++) {
      decodeTextarea.innerHTML = current;
      const decoded = decodeTextarea.value;
      if (decoded === current) break;
      current = decoded;
    }
    return current;
  }
});
