// --- EDRSR-AI Results Page Script v2.0 ---
/* global html2canvas */
// This script uses a modern, robust architecture with a long-lived port
// connection to the service worker for receiving job data.
import { getPromptName } from './prompt-definitions.js';

document.addEventListener('DOMContentLoaded', () => {
  // --- Marked.js Configuration for new tabs ---
  const renderer = new marked.Renderer();
  renderer.link = (href, title, text) => {
    // Basic security: only allow http/https links
    if (href.startsWith('http')) {
      return `<a href="${href}" title="${title || ''}" target="_blank">${text}</a>`;
    }
    // Return an empty string or some placeholder for non-http links
    return '';
  };
  marked.setOptions({ renderer });

  let librariesLoaded = false;
  let reportRendered = false;

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
    if (librariesLoaded && reportRendered) {
      elements.downloadPdfBtn.disabled = false;
      elements.pdfBtnText.textContent = '📄 Скачати звіт';
    }
  };

  // --- Library Loading Check ---
  const libraryCheckInterval = setInterval(() => {
    if (window.jspdf && window.html2canvas) {
      clearInterval(libraryCheckInterval);
      librariesLoaded = true;
      checkEnablePdfButton();
    }
  }, 100);

  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');
  let currentJobData = null;

  if (!jobId) {
    document.body.innerHTML = '<h1>Помилка: ID завдання не знайдено.</h1>';
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
      alert(`Помилка: ${payload.message}`);
    }
  });

  // --- UI Rendering ---
  function renderPage(job) {
    if (!job) {
      elements.jobTitle.textContent = `Завдання ${jobId.substring(0, 8)}...`;
      elements.statusBadge.textContent = 'Завантаження...';
      elements.statusBadge.className = 'status-badge status-loading';
      return;
    }

    currentJobData = job; // Make sure currentJobData is updated
    elements.jobTitle.textContent = job.title || `Результати аналізу завдання: ${job.id}`;
    elements.statusBadge.textContent = job.status;
    elements.statusBadge.className = `status-badge status-${job.status}`;

    // The report title is now part of the analysis content itself.
    // No longer need to set it separately.

    // Render metadata
    const metadataHTML = `
      <li><strong>Статус:</strong> ${job.status}</li>
      <li><strong>Створено:</strong> ${new Date(job.created_at).toLocaleString('uk-UA')}</li>
      <li><strong>Всього посилань:</strong> ${job.total_links}</li>
      <li><strong>Оброблено:</strong> ${job.processed_links || 0}</li>
      <li><strong>Тривалість:</strong> ${job.duration || 'N/A'} сек.</li>
    `;
    elements.jobMetadata.innerHTML = metadataHTML;

    // Render analysis
    if (job.analysis) {
      let analysisContent = job.analysis;

      // Prepend the user's prompt to the analysis if it exists
      if (job.prompt && job.prompt.trim() !== '') {
        const promptMarkdown = `### Користувацький запит\n\n> ${job.prompt}\n\n---\n\n`;
        analysisContent = promptMarkdown + analysisContent;
      }

      elements.analysisResult.innerHTML = marked.parse(analysisContent);
      elements.downloadBtn.style.display = 'block';
      reportRendered = true;
      checkEnablePdfButton();
    } else if (job.status === 'error') {
      elements.analysisResult.innerHTML = `
        <div class="error-container">
          <p class="error-message"><strong>Помилка:</strong> ${job.error_message || 'Невідома помилка'}</p>
          <button id="retryBtn" class="button button-primary" data-job-id="${job.id}">&#x21BB; Повторити спробу</button>
        </div>
      `;
      elements.downloadBtn.style.display = 'none';

      // Attach event listener for the new button
      const retryBtn = document.getElementById('retryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', handleRetry);
      }
    } else {
      elements.analysisResult.innerHTML = '<p>Аналіз ще не завершено...</p>';
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
    editIcon.title = 'Редагувати назву';

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
      roleDiv.textContent = msg.role === 'user' ? 'Ви:' : 'AI:';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'content';
      contentDiv.innerHTML = marked.parse(msg.content);

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
      elements.analysisResult.innerHTML = '<p>Повторна спроба завдання...</p>';
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
    userContentDiv.innerHTML = marked.parse(message); // Using marked to be consistent

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
      elements.copyBtn.textContent = '✅ Скопійовано!';
      setTimeout(() => {
        elements.copyBtn.textContent = '📋 Копіювати звіт';
      }, 2000);
    }
  });

  elements.downloadPdfBtn.addEventListener('click', () => {
    elements.downloadPdfBtn.disabled = true;
    const pdfType = elements.pdfTypeSelect.value;
    elements.pdfBtnText.textContent = pdfType === 'text' ? 'Генерація TXT...' : 'Генерація PDF...';
    elements.pdfBtnSpinner.style.display = 'inline-block';

    if (pdfType === 'text') {
      generateTextPDF();
    } else {
      generateImagePDF();
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
      alert('Не вдалося створити текстовий звіт. Перевірте консоль для деталей.');
    } finally {
      elements.downloadPdfBtn.disabled = false;
      elements.pdfBtnText.textContent = '📄 Скачати звіт';
      elements.pdfBtnSpinner.style.display = 'none';
    }
  }

  function generateReportText() {
    let content = '';

    // Add title
    const title = currentJobData?.title || `Звіт аналізу завдання: ${jobId}`;
    content += title + '\n';
    content += '='.repeat(title.length) + '\n\n';

    // Add metadata
    if (currentJobData) {
      content += 'МЕТАДАНІ\n';
      content += '--------\n';
      content += `Статус: ${currentJobData.status}\n`;
      content += `Створено: ${new Date(currentJobData.created_at).toLocaleString('uk-UA')}\n`;
      content += `Всього посилань: ${currentJobData.total_links}\n`;
      content += `Оброблено: ${currentJobData.processed_links || 0}\n`;
      content += `Тривалість: ${currentJobData.duration || 'N/A'} сек.\n\n`;
    }

    // Add user prompt if exists
    if (currentJobData?.prompt && currentJobData.prompt.trim() !== '') {
      content += 'КОРИСТУВАЦЬКИЙ ЗАПИТ\n';
      content += '-------------------\n';
      content += currentJobData.prompt + '\n\n';
    }

    // Add analysis content
    if (currentJobData?.analysis) {
      content += 'РЕЗУЛЬТАТИ АНАЛІЗУ\n';
      content += '-----------------\n';
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
          alert('Не вдалося створити PDF зображення. Перевірте консоль для деталей.');
          reportElement.style.backgroundColor = originalBg;
        })
        .finally(() => {
          elements.downloadPdfBtn.disabled = false;
          elements.pdfBtnText.textContent = '📄 Скачати звіт';
          elements.pdfBtnSpinner.style.display = 'none';
        });
    } catch (err) {
      console.error('Error generating image PDF:', err);
      alert('Не вдалося створити PDF зображення. Перевірте консоль для деталей.');
      elements.downloadPdfBtn.disabled = false;
      elements.pdfBtnText.textContent = '📄 Скачати звіт';
      elements.pdfBtnSpinner.style.display = 'none';
    }
  }

  elements.downloadBtn.addEventListener('click', () => {
    if (!currentJobData || !currentJobData.links || currentJobData.links.length === 0) {
      alert('Дані про справи для скачування не знайдені.');
      return;
    }

    let fullText = `ЗВІТ ПО СПРАВАХ\nЗавдання ID: ${jobId}\nДата створення: ${new Date().toLocaleString('uk-UA')}\n\n`;

    currentJobData.links.forEach((link) => {
      if (link.status === 'processed' && link.content) {
        const caseIdentifier = link.url.split('/').pop();
        fullText += `==================================================\n`;
        fullText += ` СПРАВА: ${caseIdentifier} ( ${link.url} )\n`;
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
  });

  // Initial render
  renderPage(null);
  setupTitleEditor();
});
