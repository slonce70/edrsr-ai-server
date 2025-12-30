// Admin Report Page Script
const adminI18n = window.AdminI18n || {
  t: (key) => key,
  applyTranslations: () => {},
};
const { t, applyTranslations } = adminI18n;

document.addEventListener('DOMContentLoaded', async function () {
  applyTranslations(document);
  // Get job ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  if (!jobId) {
    showError(t('messages.reportIdMissing'));
    return;
  }

  // Get auth token from localStorage
  const authToken = localStorage.getItem('admin_token');
  if (!authToken) {
    window.location.href = '/admin';
    return;
  }

  // Configure marked.js for rendering markdown
  if (window.marked) {
    const renderer = new marked.Renderer();
    renderer.link = (href, title, text) => {
      if (href.startsWith('http')) {
        return `<a href="${href}" title="${title || ''}" target="_blank">${text}</a>`;
      }
      return text;
    };
    marked.setOptions({ renderer });
  }

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

  // Load job report
  try {
    const response = await fetch(`/api/admin/jobs/${jobId}/report`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('admin_token');
        window.location.href = '/admin';
        return;
      }
      throw new Error(response.statusText || `HTTP ${response.status}`);
    }

    const data = await response.json();
    currentJobData = data.job;
    analysisText = typeof data.analysis === 'string' ? data.analysis : String(data.analysis || '');

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
            <li><strong>${t('report.metadataId')}:</strong> ${job.id}</li>
            <li><strong>${t('report.metadataStatus')}:</strong> ${getStatusText(job.status)}</li>
            <li><strong>${t('report.metadataCreated')}:</strong> ${formatReportDateTime(job.created_at)}</li>
            <li><strong>${t('report.metadataUpdated')}:</strong> ${formatReportDateTime(job.updated_at)}</li>
            <li><strong>${t('report.metadataLinks')}:</strong> ${job.processed_links} / ${job.total_links}</li>
        `;

    const analysisContent = typeof analysis === 'string' ? analysis : analysisText;

    // Render analysis content
    if (window.marked) {
      // Try to render as markdown first
      try {
        elements.analysisResult.innerHTML = marked.parse(analysisContent);
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
        await navigator.clipboard.writeText(analysisText);
        showSuccess(t('messages.reportCopySuccess'));
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = analysisText;
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
    const blob = new Blob([analysisText], { type: 'text/plain;charset=utf-8' });
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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
