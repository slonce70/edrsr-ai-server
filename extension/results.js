// --- EDRSR-AI Results Page Script v2.0 ---
/* global html2canvas */
// This script uses a modern, robust architecture with a long-lived port
// connection to the service worker for receiving job data.
import { getPromptName } from './prompt-definitions.js';

document.addEventListener('DOMContentLoaded', () => {
  // --- Minimal HTML sanitizer (DOMPurify alternative for MV3) ---
  const ALLOWED_TAGS = new Set([
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
  ]);
  const ALLOWED_ATTRS = {
    a: new Set(['href', 'title']),
    '*': new Set([]),
  };
  function isAllowedAttr(tag, attr) {
    return (ALLOWED_ATTRS[tag] && ALLOWED_ATTRS[tag].has(attr)) || ALLOWED_ATTRS['*'].has(attr);
  }
  function sanitizeHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null, false);
    const toStrip = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        toStrip.push(el);
        continue;
      }
      // Strip disallowed attributes
      for (const { name } of Array.from(el.attributes)) {
        if (!isAllowedAttr(tag, name)) el.removeAttribute(name);
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        try {
          const u = new URL(href, location.origin);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            el.removeAttribute('href');
          } else {
            el.setAttribute('rel', 'noopener noreferrer');
            el.setAttribute('target', '_blank');
          }
        } catch {
          el.removeAttribute('href');
        }
      }
    }
    // Replace stripped nodes with their text content
    for (const el of toStrip) {
      const span = doc.createElement('span');
      span.textContent = el.textContent || '';
      el.replaceWith(span);
    }
    return doc.body.innerHTML;
  }

  // --- Marked.js Configuration for new tabs ---
  // HTML escape helper to prevent XSS
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  const renderer = new marked.Renderer();
  renderer.link = (href, title, text) => {
    // Validate and sanitize URL
    let safeHref = '';
    try {
      const url = new URL(href, window.location.origin);
      // Only allow http/https protocols
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        safeHref = url.href;
      }
    } catch {
      // Invalid URL - don't render link
      return escapeHtml(text);
    }

    if (!safeHref) {
      return escapeHtml(text);
    }

    // Escape attributes to prevent XSS
    const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(safeHref)}"${safeTitle} target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  };
  marked.setOptions({ renderer });

  // jsPDF is now statically included via results.html
  let reportRendered = false;
  let unicodeFontReady = false;

  const elements = {
    jobTitle: document.getElementById('jobTitle'),
    jobMetadata: document.getElementById('jobMetadata'),
    analysisResult: document.getElementById('analysisResult'),
    statusBadge: document.getElementById('statusBadge'),
    copyBtn: document.getElementById('copyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadPdfBtn: document.getElementById('downloadPdfBtn'),
    pdfBtnText: document.querySelector('#downloadPdfBtn .btn-text'),
    pdfBtnSpinner: document.querySelector('#downloadPdfBtn .spinner'),
    pdfTypeSelect: document.getElementById('pdfTypeSelect'),
    chatArea: document.getElementById('chatArea'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    chatHistory: document.getElementById('chatHistory'),
    chatThinking: document.getElementById('chatThinking'),
    chatSendBtn: document.getElementById('chatSendBtn'),
  };

  const checkEnablePdfButton = () => {
    // Enable button when report is rendered; we'll lazy-load libs if user picks image
    if (reportRendered) {
      elements.downloadPdfBtn.disabled = false;
      elements.pdfBtnText.textContent = '📄 Скачать отчёт';
    }
  };

  // No-op placeholder retained for compatibility (jsPDF is preloaded)
  async function ensureImageLibsLoaded() {
    return true;
  }

  async function ensureUnicodeFontRegistered(pdf) {
    if (unicodeFontReady) return true;
    try {
      const regularUrl = chrome.runtime.getURL('fonts/NotoSans-Regular.ttf');
      const boldUrl = chrome.runtime.getURL('fonts/NotoSans-Bold.ttf');

      const [regResp, boldResp] = await Promise.all([
        fetch(regularUrl).catch(() => null),
        fetch(boldUrl).catch(() => null),
      ]);
      if (!regResp || !regResp.ok || !boldResp || !boldResp.ok) {
        throw new Error('Packaged fonts not found');
      }

      const [regBuf, boldBuf] = await Promise.all([regResp.arrayBuffer(), boldResp.arrayBuffer()]);

      const toBase64 = (buffer) => {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
      };

      const regBase64 = toBase64(regBuf);
      const boldBase64 = toBase64(boldBuf);

      pdf.addFileToVFS('NotoSans-Regular.ttf', regBase64);
      pdf.addFileToVFS('NotoSans-Bold.ttf', boldBase64);
      pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
      pdf.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');

      unicodeFontReady = true;
      return true;
    } catch (e) {
      console.error('Failed to load/register Noto Sans font:', e);
      unicodeFontReady = false;
      return false;
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');
  let currentJobData = null;

  if (!jobId) {
    document.body.innerHTML = '<h1>Ошибка: ID задания не найден.</h1>';
    return;
  }

  // --- Port Connection to Service Worker ---
  const port = chrome.runtime.connect({ name: 'results' });

  // Request initial job data
  port.postMessage({ type: 'GET_JOB_FOR_RESULTS_PAGE', payload: { jobId } });

  port.onMessage.addListener((message) => {
    console.log('[RESULTS] Received message from service worker:', message);
    const { type, payload } = message;

    if (type === 'JOB_UPDATE' && payload && payload.id === jobId) {
      currentJobData = payload;
      renderPage(payload);
    } else if (type === 'CHAT_UPDATE') {
      renderChat(payload);
      elements.chatThinking.style.display = 'none';
      elements.chatInput.disabled = false;
      elements.chatSendBtn.disabled = false;
    } else if (type === 'REDIRECT') {
      console.log(`[RESULTS] Redirecting to ${payload.url}`);
      window.location.href = payload.url;
    } else if (type === 'ERROR') {
      alert(`Ошибка: ${payload.message}`);
    }
  });

  // --- UI Rendering ---
  function renderPage(job) {
    if (!job) {
      elements.jobTitle.textContent = `Задание ${jobId.substring(0, 8)}...`;
      elements.statusBadge.textContent = 'Загрузка...';
      elements.statusBadge.className = 'status-badge status-loading';
      return;
    }

    currentJobData = job; // Make sure currentJobData is updated
    elements.jobTitle.textContent = job.title || `Отчёт анализа задания: ${job.id}`;
    elements.statusBadge.textContent = job.status;
    elements.statusBadge.className = `status-badge status-${job.status}`;

    // The report title is now part of the analysis content itself.
    // No longer need to set it separately.

    // Render metadata
    const metadataHTML = `
      <li><strong>Статус:</strong> ${job.status}</li>
      <li><strong>Создано:</strong> ${new Date(job.created_at).toLocaleString('ru-RU')}</li>
      <li><strong>Всего ссылок:</strong> ${job.total_links}</li>
      <li><strong>Обработано:</strong> ${job.processed_links || 0}</li>
      <li><strong>Длительность:</strong> ${job.duration || 'N/A'} сек.</li>
    `;
    elements.jobMetadata.innerHTML = metadataHTML;

    // Render analysis
    if (job.analysis) {
      let analysisContent = job.analysis;

      // Prepend the user's prompt to the analysis if it exists
      if (job.prompt && job.prompt.trim() !== '') {
        const promptMarkdown = `### Пользовательский запрос\n\n> ${job.prompt}\n\n---\n\n`;
        analysisContent = promptMarkdown + analysisContent;
      }

      elements.analysisResult.innerHTML = sanitizeHtml(marked.parse(analysisContent));
      elements.downloadBtn.style.display = 'block';
      reportRendered = true;
      checkEnablePdfButton();
    } else if (job.status === 'error') {
      elements.analysisResult.innerHTML = `
        <div class="error-container">
          <p class="error-message"><strong>Ошибка:</strong> ${job.error_message || 'Неизвестная ошибка'}</p>
          <button id="retryBtn" class="button button-primary" data-job-id="${job.id}">&#x21BB; Повторить попытку</button>
        </div>
      `;
      elements.downloadBtn.style.display = 'none';

      // Attach event listener for the new button
      const retryBtn = document.getElementById('retryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', handleRetry);
      }
    } else {
      elements.analysisResult.innerHTML = '<p>Анализ ещё не завершён...</p>';
      elements.downloadBtn.style.display = 'none';
    }

    // Show chat if analysis is complete
    if (job.analysis) {
      elements.chatArea.style.display = 'block';
      elements.chatInput.disabled = false;
      elements.chatSendBtn.disabled = false;
      port.postMessage({ type: 'GET_CHAT_HISTORY', payload: { jobId } });
    } else {
      elements.chatArea.style.display = 'none';
    }
  }

  function setupTitleEditor() {
    const header = document.querySelector('.header');
    if (header.querySelector('.edit-icon')) return; // Already setup

    const editIcon = document.createElement('span');
    editIcon.innerHTML = '&#x270E;';
    editIcon.className = 'edit-icon';
    editIcon.title = 'Редактировать название';

    const editContainer = document.createElement('div');
    editContainer.className = 'title-edit-container hidden';

    const input = document.createElement('input');
    input.type = 'text';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✔';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✖';

    editContainer.appendChild(input);
    editContainer.appendChild(saveBtn);
    editContainer.appendChild(cancelBtn);

    elements.jobTitle.insertAdjacentElement('afterend', editIcon);
    header.appendChild(editContainer);

    editIcon.addEventListener('click', () => {
      elements.jobTitle.classList.add('hidden');
      editIcon.classList.add('hidden');
      editContainer.classList.remove('hidden');
      input.value = currentJobData?.title || '';
      input.focus();
    });

    cancelBtn.addEventListener('click', () => {
      editContainer.classList.add('hidden');
      elements.jobTitle.classList.remove('hidden');
      editIcon.classList.remove('hidden');
    });

    saveBtn.addEventListener('click', () => {
      const newTitle = input.value.trim();
      if (newTitle && currentJobData) {
        port.postMessage({
          type: 'UPDATE_JOB_TITLE',
          payload: { jobId: currentJobData.id, title: newTitle },
        });
      }
      editContainer.classList.add('hidden');
      elements.jobTitle.classList.remove('hidden');
      editIcon.classList.remove('hidden');
    });
  }

  function renderChat(history) {
    elements.chatHistory.innerHTML = '';
    if (!history) return;
    history.forEach((msg) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `chat-message ${msg.role}`;

      const roleDiv = document.createElement('div');
      roleDiv.className = 'role';
      roleDiv.textContent = msg.role === 'user' ? 'Вы:' : 'AI:';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'content';
      contentDiv.innerHTML = sanitizeHtml(marked.parse(msg.content));

      msgDiv.appendChild(roleDiv);
      msgDiv.appendChild(contentDiv);
      elements.chatHistory.appendChild(msgDiv);
    });
    elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
  }

  // --- Event Handlers ---
  function handleRetry(event) {
    const jobIdToRetry = event.target.getAttribute('data-job-id');
    if (jobIdToRetry) {
      console.log(`[RESULTS] Retrying job: ${jobIdToRetry}`);
      port.postMessage({ type: 'RETRY_JOB', payload: { jobId: jobIdToRetry } });
      // Optionally, update UI to show it's retrying
      elements.analysisResult.innerHTML = '<p>Повторная попытка задания...</p>';
      elements.statusBadge.textContent = 'queued';
      elements.statusBadge.className = 'status-badge status-queued';
    }
  }

  elements.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = elements.chatInput.value.trim();
    if (!message) return;

    // Immediately display the user's message
    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'chat-message user';

    const userRoleDiv = document.createElement('div');
    userRoleDiv.className = 'role';
    userRoleDiv.textContent = 'Ви:';

    const userContentDiv = document.createElement('div');
    userContentDiv.className = 'content';
    userContentDiv.innerHTML = sanitizeHtml(marked.parse(message)); // Sanitize user message

    userMsgDiv.appendChild(userRoleDiv);
    userMsgDiv.appendChild(userContentDiv);
    elements.chatHistory.appendChild(userMsgDiv);
    elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;

    port.postMessage({ type: 'SEND_CHAT_MESSAGE', payload: { jobId, message } });
    elements.chatInput.value = '';
    elements.chatInput.disabled = true;
    elements.chatSendBtn.disabled = true;
    elements.chatThinking.style.display = 'flex';
  });

  elements.copyBtn.addEventListener('click', () => {
    if (currentJobData?.analysis) {
      navigator.clipboard.writeText(currentJobData.analysis);
      elements.copyBtn.textContent = '✅ Скопировано!';
      setTimeout(() => {
        elements.copyBtn.textContent = '📋 Копировать отчёт';
      }, 2000);
    }
  });

  elements.downloadPdfBtn.addEventListener('click', async () => {
    elements.downloadPdfBtn.disabled = true;
    const pdfType = elements.pdfTypeSelect.value;
    elements.pdfBtnText.textContent = pdfType === 'text' ? 'Генерація TXT...' : 'Генерація PDF...';
    elements.pdfBtnSpinner.style.display = 'inline-block';

    if (pdfType === 'text') {
      // Keep TXT download as before
      generateTextPDF();
    } else {
      // Generate a text-based PDF (not image), with basic formatting and clickable links
      try {
        await generateRichTextPDF();
      } catch (e) {
        console.error('Error generating text PDF:', e);
        alert('Не удалось создать PDF. Проверьте консоль для деталей.');
        elements.downloadPdfBtn.disabled = false;
        elements.pdfBtnText.textContent = '📄 Скачать отчёт';
        elements.pdfBtnSpinner.style.display = 'none';
      }
    }
  });

  function generateTextPDF() {
    try {
      // Create a simple text-based PDF using a different approach
      const reportContent = generateReportText();

      // Create blob and download as text file first (for debugging)
      const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${jobId}-text.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating text PDF:', err);
      alert('Не удалось создать текстовый отчёт. Проверьте консоль для деталей.');
    } finally {
      elements.downloadPdfBtn.disabled = false;
      elements.pdfBtnText.textContent = '📄 Скачать отчёт';
      elements.pdfBtnSpinner.style.display = 'none';
    }
  }

  function generateReportText() {
    let content = '';

    // Add title
    const title = currentJobData?.title || `Отчёт анализа задания: ${jobId}`;
    content += title + '\n';
    content += '='.repeat(title.length) + '\n\n';

    // Add metadata
    if (currentJobData) {
      content += 'МЕТАДАННЫЕ\n';
      content += '----------\n';
      content += `Статус: ${currentJobData.status}\n`;
      content += `Создано: ${new Date(currentJobData.created_at).toLocaleString('ru-RU')}\n`;
      content += `Всего ссылок: ${currentJobData.total_links}\n`;
      content += `Обработано: ${currentJobData.processed_links || 0}\n`;
      content += `Длительность: ${currentJobData.duration || 'N/A'} сек.\n\n`;
    }

    // Add user prompt if exists
    if (currentJobData?.prompt && currentJobData.prompt.trim() !== '') {
      content += 'ПОЛЬЗОВАТЕЛЬСКИЙ ЗАПРОС\n';
      content += '-----------------------\n';
      content += currentJobData.prompt + '\n\n';
    }

    // Add analysis content
    if (currentJobData?.analysis) {
      content += 'РЕЗУЛЬТАТЫ АНАЛИЗА\n';
      content += '-------------------\n';
      content += convertMarkdownToText(currentJobData.analysis);
    }

    return content;
  }

  function convertMarkdownToText(markdown) {
    return (
      markdown
        // Remove HTML tags
        .replace(/<[^>]*>/g, '')
        // Convert headers
        .replace(/^### (.*$)/gm, '\n$1\n' + '-'.repeat(20) + '\n')
        .replace(/^## (.*$)/gm, '\n$1\n' + '='.repeat(30) + '\n')
        .replace(/^# (.*$)/gm, '\n$1\n' + '='.repeat(40) + '\n')
        // Convert bold and italic
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        // Convert lists
        .replace(/^[\s]*[-*+]\s+/gm, '• ')
        .replace(/^\d+\.\s+/gm, '• ')
        // Clean up extra whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  // --- Text-based PDF (with formatting + clickable links) ---
  async function generateRichTextPDF() {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) throw new Error('jsPDF is not loaded');

    const pdf = new jsPDF('p', 'mm', 'a4');
    await ensureUnicodeFontRegistered(pdf);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // Styles
    const headingColor = [38, 70, 167]; // blue-ish
    const textColor = [0, 0, 0];
    const linkColor = [35, 99, 173];

    const baseFontSize = 11;
    const lineHeight = 5.5; // mm

    const checkPageBreak = (extraHeight = lineHeight) => {
      if (y + extraHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
    };

    const addHeading = (text, level = 2) => {
      const sizes = { 1: 16, 2: 14, 3: 12 };
      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'bold');
      pdf.setTextColor(...headingColor);
      pdf.setFontSize(sizes[level] || 12);
      const lines = pdf.splitTextToSize(text, contentWidth);
      lines.forEach((ln) => {
        checkPageBreak();
        pdf.text(ln, margin, y);
        y += lineHeight;
      });
      y += 1.5;
      pdf.setTextColor(...textColor);
      pdf.setFontSize(baseFontSize);
      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'normal');
    };

    const addLabelValue = (label, value) => {
      checkPageBreak();
      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'bold');
      const labelText = `${label}:`;
      pdf.text(labelText, margin, y);
      const x2 = margin + pdf.getTextWidth(labelText + ' ');
      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'normal');
      pdf.text(String(value || ''), x2, y);
      y += lineHeight;
    };

    const renderParagraphWithLinks = (text, opts = {}) => {
      const indent = opts.indent || 0; // in mm
      const xStart = margin + indent;
      const xMax = pageWidth - margin;
      let x = xStart;

      // Tokenize text for [label](url) and raw URLs
      const tokens = [];
      const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
      let last = 0;
      let m;
      while ((m = regex.exec(text)) !== null) {
        if (m.index > last) tokens.push({ type: 'text', text: text.slice(last, m.index) });
        if (m[2]) tokens.push({ type: 'link', text: m[1], url: m[2] });
        else tokens.push({ type: 'link', text: m[3], url: m[3] });
        last = regex.lastIndex;
      }
      if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });

      // Split tokens into words while preserving link grouping
      const words = [];
      tokens.forEach((t) => {
        if (t.type === 'link') {
          const parts = t.text.split(/(\s+)/);
          for (const p of parts) {
            if (!p) continue;
            words.push({ type: /\s+/.test(p) ? 'space' : 'link', text: p, url: t.url });
          }
        } else {
          const parts = t.text.split(/(\s+)/);
          for (const p of parts) {
            if (!p) continue;
            words.push({ type: /\s+/.test(p) ? 'space' : 'text', text: p });
          }
        }
      });

      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'normal');
      pdf.setFontSize(baseFontSize);
      pdf.setTextColor(...textColor);

      checkPageBreak();
      // y is managed via outer scope and checkPageBreak

      for (const w of words) {
        const wText = w.text;
        const wWidth = pdf.getTextWidth(wText);

        if (x + wWidth > xMax) {
          // New line
          y += lineHeight;
          checkPageBreak();
          x = xStart;
          // Skip spaces at line start
          if (w.type === 'space') continue;
        }

        if (w.type === 'link') {
          pdf.setTextColor(...linkColor);
          pdf.textWithLink(wText, x, y, { url: w.url });
          pdf.setTextColor(...textColor);
        } else if (w.type === 'text') {
          pdf.text(wText, x, y);
        } else if (w.type === 'space') {
          // draw a space as normal text to advance x
          pdf.text(wText, x, y);
        }
        x += wWidth;
      }
      y += lineHeight;
    };

    const addBulletPoint = (text) => {
      // Bullet • with small indent
      checkPageBreak();
      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'normal');
      pdf.text('•', margin, y);
      renderParagraphWithLinks(cleanMarkdownText(text), { indent: 4 });
    };

    const addWrappedText = (text) => {
      renderParagraphWithLinks(text);
    };

    // Title
    const title = currentJobData?.title || `Отчёт анализа задания: ${jobId}`;
    addHeading(title, 1);

    // Divider
    pdf.setDrawColor(102, 126, 234);
    pdf.setLineWidth(0.5);
    checkPageBreak(2);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 4;

    // Metadata
    if (currentJobData) {
      addHeading('МЕТАДАННЫЕ', 3);
      pdf.setFontSize(baseFontSize);
      addLabelValue('Статус', currentJobData.status);
      addLabelValue('Создано', new Date(currentJobData.created_at).toLocaleString('ru-RU'));
      addLabelValue('Всего ссылок', currentJobData.total_links);
      addLabelValue('Обработано', currentJobData.processed_links || 0);
      addLabelValue('Длительность', `${currentJobData.duration || 'N/A'} сек.`);
      y += 2;
    }

    // Prompt
    if (currentJobData?.prompt && currentJobData.prompt.trim() !== '') {
      addHeading('ПОЛЬЗОВАТЕЛЬСКИЙ ЗАПРОС', 3);
      addWrappedText(currentJobData.prompt.trim());
      y += 2;
    }

    // Analysis
    if (currentJobData?.analysis) {
      addHeading('РЕЗУЛЬТАТЫ АНАЛИЗА', 2);
      parseAndRenderMarkdown(
        currentJobData.analysis,
        pdf,
        margin,
        contentWidth,
        lineHeight,
        checkPageBreak,
        addHeading,
        addWrappedText,
        addBulletPoint
      );
    }

    // Footer page numbers
    const pageCount = pdf.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      pdf.setPage(p);
      pdf.setFont(unicodeFontReady ? 'NotoSans' : 'helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(120);
      const footer = `Стр. ${p} из ${pageCount}`;
      const w = pdf.getTextWidth(footer);
      pdf.text(footer, pageWidth - margin - w, pageHeight - 8);
      pdf.setTextColor(0, 0, 0);
    }

    // Save
    const safeTitle = (currentJobData?.title || 'report').replace(/[^\w-]+/g, '_');
    pdf.save(`${safeTitle}_${jobId}.pdf`);

    // UI restore
    elements.downloadPdfBtn.disabled = false;
    elements.pdfBtnText.textContent = '📄 Скачать отчёт';
    elements.pdfBtnSpinner.style.display = 'none';
  }

  // Enhanced markdown parser for PDF generation
  function parseAndRenderMarkdown(
    markdown,
    pdf,
    margin,
    contentWidth,
    lineHeight,
    checkPageBreak,
    addHeading,
    addWrappedText,
    addBulletPoint
  ) {
    // Split content into lines for processing
    const lines = markdown.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines but add some spacing
      if (!line) {
        checkPageBreak(lineHeight * 0.5);
        continue;
      }

      // Headers
      if (line.startsWith('### ')) {
        addHeading(line.substring(4), 3);
      } else if (line.startsWith('## ')) {
        addHeading(line.substring(3), 2);
      } else if (line.startsWith('# ')) {
        addHeading(line.substring(2), 1);
      }
      // Bullet points
      else if (line.match(/^[\s]*[-*+]\s+/)) {
        const text = line.replace(/^[\s]*[-*+]\s+/, '');
        addBulletPoint(cleanMarkdownText(text));
      }
      // Numbered lists
      else if (line.match(/^\d+\.\s+/)) {
        const text = line.replace(/^\d+\.\s+/, '');
        addBulletPoint(cleanMarkdownText(text));
      }
      // Regular text
      else {
        const cleanText = cleanMarkdownText(line);
        if (cleanText) {
          addWrappedText(cleanText);
        }
      }
    }
  }

  // Helper function to clean markdown formatting from text
  function cleanMarkdownText(text) {
    return (
      text
        // Remove HTML tags
        .replace(/<[^>]*>/g, '')
        // Convert bold and italic (keep the text, remove formatting)
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        // Remove code formatting
        .replace(/`([^`]+)`/g, '$1')
        // Clean up extra whitespace
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  function generateImagePDF() {
    try {
      const jsPDF = window.jspdf.jsPDF;
      const reportElement = elements.analysisResult;

      const originalBg = reportElement.style.backgroundColor;
      reportElement.style.backgroundColor = 'white';

      html2canvas(reportElement, {
        useCORS: true,
        logging: false,
        scale: 1.5, // Reduced scale for smaller file size
        quality: 0.8, // Reduced quality for smaller file size
      })
        .then((canvas) => {
          reportElement.style.backgroundColor = originalBg;

          const imgData = canvas.toDataURL('image/jpeg', 0.8); // Use JPEG with compression

          // A4 page size in mm: 210 x 297
          const pdf = new jsPDF('p', 'mm', 'a4');
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();

          // Set margins
          const margin = 10;
          const contentWidth = pageWidth - margin * 2;
          const contentHeight = pageHeight - margin * 2;

          // Calculate image scaling
          const imgWidth = canvas.width;
          const imgHeight = canvas.height;
          const imgRatio = imgWidth / imgHeight;

          const pdfImgWidth = contentWidth;
          const pdfImgHeight = contentWidth / imgRatio;

          // Split across pages if needed
          let yOffset = 0;
          let pageNum = 1;

          while (yOffset < imgHeight) {
            if (pageNum > 1) {
              pdf.addPage();
            }

            const remainingImgHeight = imgHeight - yOffset;
            const maxImgHeightForPage = (contentHeight * imgWidth) / contentWidth;
            const imgHeightForThisPage = Math.min(remainingImgHeight, maxImgHeightForPage);

            const pdfHeightForThisPage = (imgHeightForThisPage * contentWidth) / imgWidth;

            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = imgWidth;
            croppedCanvas.height = imgHeightForThisPage;
            const croppedCtx = croppedCanvas.getContext('2d');

            croppedCtx.drawImage(
              canvas,
              0,
              yOffset,
              imgWidth,
              imgHeightForThisPage,
              0,
              0,
              imgWidth,
              imgHeightForThisPage
            );

            const croppedImgData = croppedCanvas.toDataURL('image/jpeg', 0.8);
            pdf.addImage(
              croppedImgData,
              'JPEG',
              margin,
              margin,
              contentWidth,
              pdfHeightForThisPage
            );

            yOffset += imgHeightForThisPage;
            pageNum++;
          }

          pdf.save(`report-${jobId}-image.pdf`);
        })
        .catch((err) => {
          console.error('Error generating image PDF:', err);
          alert('Не удалось создать PDF изображение. Проверьте консоль для деталей.');
          reportElement.style.backgroundColor = originalBg;
        })
        .finally(() => {
          elements.downloadPdfBtn.disabled = false;
          elements.pdfBtnText.textContent = '📄 Скачать отчёт';
          elements.pdfBtnSpinner.style.display = 'none';
        });
    } catch (err) {
      console.error('Error generating image PDF:', err);
      alert('Не удалось создать PDF изображение. Проверьте консоль для деталей.');
      elements.downloadPdfBtn.disabled = false;
      elements.pdfBtnText.textContent = '📄 Скачать отчёт';
      elements.pdfBtnSpinner.style.display = 'none';
    }
  }

  elements.downloadBtn.addEventListener('click', () => {
    // Ask service worker to fetch processed links' content on demand
    elements.downloadBtn.disabled = true;
    const handler = (message) => {
      if (message.type === 'LINKS_CONTENT') {
        const { links } = message.payload || { links: [] };
        let fullText = `ОТЧЁТ ПО ДЕЛАМ\nЗадание ID: ${jobId}\nДата создания: ${new Date().toLocaleString('ru-RU')}\n\n`;
        links.forEach((link) => {
          if (link && link.url && link.content) {
            const caseIdentifier = link.url.split('/').pop();
            fullText += `==================================================\n`;
            fullText += ` ДЕЛО: ${caseIdentifier} ( ${link.url} )\n`;
            fullText += `==================================================\n\n`;
            fullText += `${link.content}\n\n\n`;
          }
        });

        const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `job_${jobId}_cases.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        elements.downloadBtn.disabled = false;
        port.onMessage.removeListener(handler);
      } else if (message.type === 'ERROR') {
        alert(message.payload?.message || 'Ошибка загрузки контента дел');
        elements.downloadBtn.disabled = false;
        port.onMessage.removeListener(handler);
      }
    };
    port.onMessage.addListener(handler);
    port.postMessage({ type: 'GET_LINKS_CONTENT', payload: { jobId } });
  });

  // Initial render
  renderPage(null);
  setupTitleEditor();
});
