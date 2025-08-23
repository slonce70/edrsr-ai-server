// Admin Report Page Script
document.addEventListener('DOMContentLoaded', async function () {
  // Get job ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  if (!jobId) {
    showError('ID задания не найден в URL');
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
      throw new Error('Ошибка загрузки отчета');
    }

    const data = await response.json();
    currentJobData = data.job;
    analysisText = data.analysis;

    renderReport(data.job, data.analysis);
    setupEventListeners();
  } catch (error) {
    showError('Ошибка загрузки отчета: ' + error.message);
  }

  function renderReport(job, analysis) {
    // Update page title
    elements.jobTitle.textContent = job.title || 'Отчет по заданию';
    document.title = `${job.title || 'Отчет'} - EDRSR-AI Admin`;

    // Update status badge
    elements.statusBadge.textContent = getStatusText(job.status);
    elements.statusBadge.className = `status-badge status-${job.status}`;

    // Update metadata
    elements.jobMetadata.innerHTML = `
            <li><strong>ID:</strong> ${job.id}</li>
            <li><strong>Статус:</strong> ${getStatusText(job.status)}</li>
            <li><strong>Создано:</strong> ${formatDateTime(job.created_at)}</li>
            <li><strong>Обновлено:</strong> ${formatDateTime(job.updated_at)}</li>
            <li><strong>Ссылок обработано:</strong> ${job.processed_links} / ${job.total_links}</li>
        `;

    // Render analysis content
    if (window.marked) {
      // Try to render as markdown first
      try {
        elements.analysisResult.innerHTML = marked.parse(analysis);
      } catch (e) {
        // Fall back to plain text with line breaks
        elements.analysisResult.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(analysis)}</pre>`;
      }
    } else {
      // No markdown library, use plain text
      elements.analysisResult.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(analysis)}</pre>`;
    }
  }

  function setupEventListeners() {
    // Copy button
    elements.copyBtn.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(analysisText);
        showSuccess('Отчет скопирован в буфер обмена');
      } catch (error) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = analysisText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showSuccess('Отчет скопирован в буфер обмена');
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

    const fileName = `${currentJobData.title || 'report'}_${currentJobData.id}.txt`;
    const blob = new Blob([analysisText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Отчет загружен');
  }

  function showError(message) {
    elements.analysisResult.innerHTML = `
            <div class="error-message">
                <strong>Ошибка:</strong> ${escapeHtml(message)}
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
    const statusMap = {
      pending: 'Ожидание',
      processing: 'Обработка',
      completed: 'Завершено',
      error: 'Ошибка',
      queued: 'В очереди',
      analyzing: 'Анализ',
    };
    return statusMap[status] || status;
  }

  function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
