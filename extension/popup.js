// --- EDRSR-AI Popup Script v2.0 ---
// This script uses a modern, robust architecture with a long-lived port
// connection to the service worker, which acts as the central controller.
import { PROMPT_GROUPS, PROMPT_DESCRIPTIONS } from './prompt-definitions.js';
import { SUPABASE_REDIRECT_TO } from './config.js';
import {
  isAuthenticated,
  signInWithPassword,
  signOut,
  getSession,
  signUpWithPassword,
} from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  // --- Minimal HTML sanitizer (for MV3) ---
  const ALLOWED_TAGS = new Set([
    'span',
    'div',
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
  ]);
  const ALLOWED_ATTRS = { a: new Set(['href', 'title']), '*': new Set(['class']) };
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
      for (const { name } of Array.from(el.attributes)) {
        if (!isAllowedAttr(tag, name)) el.removeAttribute(name);
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        try {
          const u = new URL(href, location.origin);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') el.removeAttribute('href');
          else {
            el.setAttribute('rel', 'noopener noreferrer');
            el.setAttribute('target', '_blank');
          }
        } catch {
          el.removeAttribute('href');
        }
      }
    }
    for (const el of toStrip) {
      const span = doc.createElement('span');
      span.textContent = el.textContent || '';
      el.replaceWith(span);
    }
    return doc.body.innerHTML;
  }
  // --- Global State & Port Connection ---
  let port = chrome.runtime.connect({ name: 'popup' });
  let currentJobData = null;
  let clientId = null;

  // --- DOM Elements ---
  const elements = {
    serverStatus: document.getElementById('serverStatus'),
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    collectBtn: document.getElementById('collectBtn'),
    collectInfo: document.getElementById('collectInfo'),
    linksCount: document.getElementById('linksCount'),
    currentPage: document.getElementById('currentPage'),
    jobIdInput: document.getElementById('jobIdInput'),
    checkStatusBtn: document.getElementById('checkStatusBtn'),
    loadLastJobBtn: document.getElementById('loadLastJobBtn'),
    retryJobBtn: document.getElementById('retryJobBtn'),
    forceRetryJobBtn: document.getElementById('forceRetryJobBtn'),
    jobStatus: document.getElementById('jobStatus'),
    jobTitle: document.getElementById('jobTitle'),
    jobStatusText: document.getElementById('jobStatusText'),
    jobStatusRow: document.getElementById('jobStatusText')?.closest('.job-detail'),
    jobProgress: document.getElementById('jobProgress'),
    progressFill: document.getElementById('progressFill'),
    jobLinks: document.getElementById('jobLinks'),
    jobStartTime: document.getElementById('jobStartTime'),
    openResultsPageBtn: document.getElementById('openResultsPageBtn'),
    showResultBtn: document.getElementById('showResultBtn'),
    copyResultBtn: document.getElementById('copyResultBtn'),
    resultArea: document.getElementById('resultArea'),
    promptTemplate: document.getElementById('promptTemplate'),
    customPromptContainer: document.getElementById('customPromptContainer'),
    customPrompt: document.getElementById('customPrompt'),
    historyList: document.getElementById('historyList'),
    promptDescription: document.getElementById('promptDescription'),
    promptName: document.getElementById('promptName'),
    savePromptBtn: document.getElementById('savePromptBtn'),
    deletePromptBtn: document.getElementById('deletePromptBtn'),
    uniqueOnlyToggle: document.getElementById('uniqueOnlyToggle'),
    ignoreSessionToggle: document.getElementById('ignoreSessionToggle'),
    uniqueCountHistory: document.getElementById('uniqueCountHistory'),
    uniqueCountSession: document.getElementById('uniqueCountSession'),
    // Auth UI
    authEmail: document.getElementById('authEmail'),
    authPassword: document.getElementById('authPassword'),
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    signupBtn: document.getElementById('signupBtn'),
    recoverBtn: document.getElementById('recoverBtn'),
    togglePwdBtn: document.getElementById('togglePwdBtn'),
    authStatus: document.getElementById('authStatus'),
    authBadge: document.getElementById('authBadge'),
  };

  // --- Проверка элементов DOM ---
  if (!elements.retryJobBtn) {
    console.error('[POPUP] retryJobBtn element not found!');
  }
  if (!elements.forceRetryJobBtn) {
    console.error('[POPUP] forceRetryJobBtn element not found!');
  }

  // --- Import descriptions ---
  // Descriptions are now imported directly from the prompt-definitions module.
  // The old dynamic import is no longer needed.

  // --- Port Message Listener ---
  port.onMessage.addListener((message) => {
    console.log('[POPUP] Received message from service worker:', message);
    const { type, payload } = message;

    switch (type) {
      case 'JOB_UPDATE':
        // Always update the main status display to show the most recent job activity.
        // This fixes the bug where the status tab wouldn't update for new or manually checked jobs.
        updateJobStatusDisplay(payload);
        // Also, update the specific item in the history list if it exists
        updateHistoryItem(payload);
        break;
      case 'HISTORY_UPDATE':
        renderHistory(payload);
        break;
      case 'WEBSOCKET_STATUS':
        updateServerStatus(payload.status);
        break;
      case 'CLIENT_ID':
        clientId = payload;
        console.log(`[POPUP] Received clientId: ${clientId}`);
        break;
      case 'ERROR':
        alert(`Ошибка: ${payload.message}`);
        break;
      case 'AUTH_REQUIRED':
        switchTab('auth');
        elements.authStatus.textContent = 'Требуется вход. Пожалуйста, войдите.';
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    console.warn('[POPUP] Port disconnected. Attempting to reconnect...');
    updateServerStatus('reconnecting');
    // Simple reconnection logic
    setTimeout(() => {
      port = chrome.runtime.connect({ name: 'popup' });
    }, 1000);
  });

  // --- UI Update Functions ---

  const updateServerStatus = (status) => {
    switch (status) {
      case 'connected':
        elements.serverStatus.className = 'status-indicator status-online';
        elements.serverStatus.innerHTML = `<span><div class="status-dot dot-online"></div>Подключено</span>`;
        break;
      case 'disconnected':
        elements.serverStatus.className = 'status-indicator status-offline';
        elements.serverStatus.innerHTML = `<span><div class="status-dot dot-offline"></div>Отключено</span>`;
        break;
      case 'reconnecting':
        elements.serverStatus.className = 'status-indicator status-offline';
        elements.serverStatus.innerHTML = `<span><div class="status-dot dot-offline"></div>Переподключение...</span>`;
        break;
    }
  };

  const getStatusText = (status) => {
    const map = {
      queued: '⏳ В очереди',
      pending: '⏳ В очереди',
      downloading: '📥 Загрузка',
      download: '📥 Загрузка', // legacy/alias
      processing: '🔄 Обработка',
      retrying: '🔁 Повтор',
      warning: '⚠️ Предупреждение',
      analyzing: '🤖 Анализ',
      completed: '✅ Завершено',
      error: '❌ Ошибка',
    };
    return map[status] || status;
  };

  const updateJobStatusDisplay = (jobData) => {
    currentJobData = jobData;
    if (!jobData || !jobData.id) {
      elements.jobStatus.classList.add('hidden');
      return;
    }

    // Сначала определяем все статусы
    const isCompleted = jobData.status === 'completed';
    const isError = jobData.status === 'error';
    const isWarning = jobData.status === 'warning';

    // Проверяем, не зависла ли задача (активна больше 10 минут)
    const isStuck =
      ['downloading', 'analyzing', 'queued', 'pending'].includes(jobData.status) &&
      jobData.created_at &&
      Date.now() - new Date(jobData.created_at).getTime() > 10 * 60 * 1000; // 10 минут

    elements.jobIdInput.value = jobData.id;
    elements.jobStatus.classList.remove('hidden');
    // Используем title, если он есть, иначе - ID
    elements.jobTitle.textContent = jobData.title || `Задание ${jobData.id.substring(0, 8)}...`;

    // Показываем специальный статус для зависших задач
    let statusText = '';
    if (isStuck) {
      statusText = '⚠️ Зависло (можно перезапустить)';
    } else {
      switch (jobData.status) {
        case 'queued':
        case 'pending':
          statusText = '⏳ В очереди';
          break;
        case 'downloading':
          // Hide row below; keep empty text
          statusText = '';
          break;
        case 'analyzing':
          // Show detailed progress message from server while AI processes batches
          statusText = jobData.message ? jobData.message : '🤖 Анализ';
          break;
        case 'completed':
          statusText = '✅ Завершено';
          break;
        case 'error':
          statusText = jobData.message ? `❌ ${jobData.message}` : '❌ Ошибка';
          break;
        default:
          statusText = getStatusText(jobData.status);
      }
    }
    // If downloading, hide the status row; otherwise show with text
    if (elements.jobStatusRow) {
      elements.jobStatusRow.classList.toggle('hidden', jobData.status === 'downloading');
    }
    elements.jobStatusText.textContent = statusText;
    elements.jobProgress.textContent = `${jobData.progress || 0}%`;
    elements.progressFill.style.width = `${jobData.progress || 0}%`;
    elements.jobLinks.textContent = `${jobData.processed_links || 0} / ${jobData.total_links || 0}`;
    elements.jobStartTime.textContent = new Date(jobData.created_at).toLocaleString('ru-RU');

    const canRetry = isCompleted || isError || isStuck || isWarning;
    const isActive = ['downloading', 'analyzing', 'queued', 'pending'].includes(jobData.status);
    const canForceRetry = isActive && !isStuck; // Показываем принудительный перезапуск для активных, но не зависших
    const hasAnalysis = isCompleted && jobData.analysis;

    elements.openResultsPageBtn.classList.toggle('hidden', !isCompleted);
    elements.showResultBtn.disabled = !hasAnalysis;
    elements.retryJobBtn.classList.toggle('hidden', !canRetry);
    elements.forceRetryJobBtn.classList.toggle('hidden', !canForceRetry);

    // Обновляем текст кнопки в зависимости от статуса
    if (canRetry) {
      let buttonText = '🔄 Перезапустить задание';
      if (isStuck) {
        buttonText = '🔄 Перезапустить зависшее';
      } else if (isWarning) {
        buttonText = '🔄 Перезапустить задание';
      }
      elements.retryJobBtn.querySelector('span').textContent = buttonText;
    }

    elements.resultArea.classList.add('hidden');
    elements.copyResultBtn.classList.add('hidden');

    elements.jobStatus.className = 'job-info'; // Reset classes
    if (isStuck) {
      elements.jobStatus.classList.add('status-stuck');
    } else if (isWarning) {
      elements.jobStatus.classList.add('status-warning');
    } else {
      elements.jobStatus.classList.add(`status-${jobData.status}`);
    }
  };

  const updateHistoryItem = (jobData) => {
    const listItem = elements.historyList.querySelector(`li[data-job-id="${jobData.id}"]`);
    if (!listItem) return;

    const titleSpan = listItem.querySelector('.job-id');
    const statusSpan = listItem.querySelector('.job-status-hist');

    if (titleSpan) {
      titleSpan.textContent = jobData.title || `ID: ${jobData.id.substring(0, 8)}...`;
    }
    if (statusSpan) {
      statusSpan.textContent = `${getStatusText(jobData.status)} ${jobData.progress || ''}%`;
    }
  };

  const renderHistory = (jobs) => {
    const wasEditing = document.querySelector('.edit-container:not(.hidden)');
    const currentlyEditingId = wasEditing?.closest('li')?.dataset.jobId;

    elements.historyList.innerHTML = '';
    if (jobs && jobs.length > 0) {
      jobs.forEach((job) => {
        const li = document.createElement('li');
        li.dataset.jobId = job.id;

        // Main container for job info
        const infoContainer = document.createElement('div');
        infoContainer.classList.add('job-info-container');
        const titleText = job.title || `ID: ${job.id.substring(0, 8)}...`;
        infoContainer.innerHTML = sanitizeHtml(`
          <div class="job-details">
            <span class="job-id">${titleText}</span>
            <span class="job-status-hist">${getStatusText(job.status)} ${job.progress || ''}%</span>
            <span class="job-date">${new Date(job.created_at).toLocaleString('ru-RU')}</span>
          </div>
        `);
        infoContainer.addEventListener('click', () => {
          // Check if THIS item's edit container is hidden. This is the fix.
          if (!editContainer.classList.contains('hidden')) return;

          if (job.status === 'completed') {
            chrome.tabs.create({ url: chrome.runtime.getURL(`results.html?jobId=${job.id}`) });
          } else {
            elements.jobIdInput.value = job.id;
            switchTab('status');
            port.postMessage({ type: 'GET_JOB_STATUS', payload: { jobId: job.id } });
          }
        });

        // --- Edit/Delete buttons container ---
        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('job-buttons');

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-job-btn';
        editBtn.innerHTML = '&#x270E;'; // Pencil icon
        editBtn.title = 'Редактировать название';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-job-btn';
        deleteBtn.innerHTML = '&#x1F5D1;'; // Trash can icon
        deleteBtn.title = 'Удалить задание';

        buttonsContainer.appendChild(editBtn);
        buttonsContainer.appendChild(deleteBtn);

        // --- Edit Mode Container (initially hidden) ---
        const editContainer = document.createElement('div');
        editContainer.classList.add('edit-container', 'hidden');
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.value = job.title || '';
        editInput.placeholder = 'Введите новое название';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '✔';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '✖';
        editContainer.appendChild(editInput);
        editContainer.appendChild(saveBtn);
        editContainer.appendChild(cancelBtn);

        // --- Event Listeners for buttons ---
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          infoContainer.classList.add('hidden');
          buttonsContainer.classList.add('hidden');
          editContainer.classList.remove('hidden');
          editInput.focus();
        });

        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          editContainer.classList.add('hidden');
          infoContainer.classList.remove('hidden');
          buttonsContainer.classList.remove('hidden');
        });

        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newTitle = editInput.value.trim();
          if (newTitle) {
            port.postMessage({
              type: 'UPDATE_JOB_TITLE',
              payload: { jobId: job.id, title: newTitle },
            });
            // The view will be updated automatically by the JOB_UPDATE event via WebSocket
          }
          // Hide edit form regardless
          editContainer.classList.add('hidden');
          infoContainer.classList.remove('hidden');
          buttonsContainer.classList.remove('hidden');
        });

        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (
            confirm(
              `Вы уверены, что хотите удалить задание "${titleText}"? Это действие нельзя отменить.`
            )
          ) {
            port.postMessage({ type: 'DELETE_JOB', payload: { jobId: job.id } });
          }
        });

        li.appendChild(infoContainer);
        li.appendChild(editContainer);
        li.appendChild(buttonsContainer);

        elements.historyList.appendChild(li);

        // Restore edit state if this was the item being edited
        if (job.id === currentlyEditingId) {
          infoContainer.classList.add('hidden');
          buttonsContainer.classList.add('hidden');
          editContainer.classList.remove('hidden');
          editInput.focus();
        }
      });
    } else {
      elements.historyList.innerHTML = `<li style="text-align:center;color:#999;">История пуста</li>`;
    }
  };

  // --- Event Handlers ---

  const switchTab = (tabName) => {
    elements.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
    elements.tabContents.forEach((content) =>
      content.classList.toggle('active', content.id === `${tabName}Tab`)
    );
    if (tabName === 'history') {
      port.postMessage({ type: 'GET_HISTORY' });
    }
    if (tabName === 'auth') {
      updateAuthUI();
    }
  };

  async function updateAuthUI() {
    const authed = await isAuthenticated();
    if (authed) {
      const session = await getSession();
      elements.authStatus.textContent = `Вы вошли как ${session?.user?.email || 'пользователь'}`;
      if (elements.authBadge) {
        elements.authBadge.textContent = `🔐 ${session?.user?.email || 'Вошли'}`;
        elements.authBadge.classList.remove('badge-guest');
        elements.authBadge.classList.add('badge-auth');
      }
      // Скрыть поля и кнопки логина/регистрации, показать logout
      document.querySelectorAll('.auth-fields').forEach((el) => el.classList.add('hidden'));
      document.querySelector('.auth-actions')?.classList.add('hidden');
      elements.logoutBtn.classList.remove('hidden');
      elements.recoverBtn?.classList.add('hidden');
    } else {
      elements.authStatus.textContent = 'Вы не вошли.';
      if (elements.authBadge) {
        elements.authBadge.textContent = 'Гость';
        elements.authBadge.classList.remove('badge-auth');
        elements.authBadge.classList.add('badge-guest');
      }
      document.querySelectorAll('.auth-fields').forEach((el) => el.classList.remove('hidden'));
      document.querySelector('.auth-actions')?.classList.remove('hidden');
      elements.logoutBtn.classList.add('hidden');
      elements.recoverBtn?.classList.remove('hidden');
    }
  }

  const collectLinks = async () => {
    elements.collectBtn.innerHTML = '<div class="loading"></div>';
    elements.collectBtn.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Запрашиваем данные у content.js, а не инжектим свой скрипт
      const links = await chrome.tabs.sendMessage(tab.id, { type: 'GET_DECISION_LINKS' });

      if (!links || links.length === 0) {
        throw new Error(
          'На странице не найдено ссылок на дела. Возможно, нужно обновить страницу.'
        );
      }

      // Optionally filter only unique (not in user's job history)
      let finalLinks = links;
      if (elements.uniqueOnlyToggle?.checked) {
        const res = await chrome.runtime.sendMessage({ type: 'API_GET_PROCESSED_URLS' });
        if (res && res.success && Array.isArray(res.urls)) {
          const processed = new Set(res.urls);
          finalLinks = finalLinks.filter((l) => l && l.url && !processed.has(l.url));
        }
        if (finalLinks.length === 0) {
          throw new Error('На этой странице нет уникальных дел для анализа.');
        }
      }

      // Optionally ignore links already sent in this session
      if (elements.ignoreSessionToggle?.checked) {
        const sessionRes = await chrome.runtime.sendMessage({ type: 'API_GET_SESSION_VISITED' });
        if (sessionRes && sessionRes.success && Array.isArray(sessionRes.urls)) {
          const sessionSet = new Set(sessionRes.urls);
          finalLinks = finalLinks.filter((l) => l && l.url && !sessionSet.has(l.url));
        }
        if (finalLinks.length === 0) {
          throw new Error('В этой сессии нет новых дел для анализа.');
        }
      }

      let prompt;
      let promptLabel = null;
      const selectedIndex = elements.promptTemplate.selectedIndex;
      const selectedOption = elements.promptTemplate.options[selectedIndex];
      const selectedValue = elements.promptTemplate.value;
      if (selectedValue === 'custom') {
        prompt = elements.customPrompt.value.trim();
        promptLabel = prompt ? prompt.split(/\s+/).slice(0, 6).join(' ') : 'Пользовательский';
      } else if (selectedValue !== 'default') {
        prompt = selectedValue;
        promptLabel = selectedOption?.textContent || null;
      } else {
        prompt = null;
        promptLabel = null;
      }

      const cookies = await chrome.cookies.getAll({ domain: 'reyestr.court.gov.ua' });

      port.postMessage({
        type: 'START_JOB',
        payload: {
          links: finalLinks,
          cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
          prompt,
          promptLabel,
          autoTitleEnabled: !!elements.autoTitleToggle?.checked,
          tabId: tab.id,
          clientId,
          uniqueOnly: !!elements.uniqueOnlyToggle?.checked,
          ignoreSessionVisited: !!elements.ignoreSessionToggle?.checked,
        },
      });
      switchTab('status');
    } catch (error) {
      alert(`Ошибка: ${error.message}`);
    } finally {
      elements.collectBtn.innerHTML = '<span>🔍 Собрать и проанализировать</span>';
      updatePageInfo();
    }
  };

  const updatePageInfo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url?.includes('reyestr.court.gov.ua')) {
        elements.currentPage.textContent = 'ЄДРСР ✓';
        const decisions = await chrome.tabs.sendMessage(tab.id, { type: 'GET_DECISION_LINKS' });
        const urls = (decisions || []).map((d) => d.url).filter(Boolean);
        elements.linksCount.textContent = String(urls.length);

        let processedSet = new Set();
        try {
          const res = await chrome.runtime.sendMessage({ type: 'API_GET_PROCESSED_URLS' });
          if (res?.success && Array.isArray(res.urls)) processedSet = new Set(res.urls);
        } catch (_) {
          // ignore processed URLs retrieval failure
          void 0;
        }

        let sessionSet = new Set();
        try {
          const sres = await chrome.runtime.sendMessage({ type: 'API_GET_SESSION_VISITED' });
          if (sres?.success && Array.isArray(sres.urls)) sessionSet = new Set(sres.urls);
        } catch (_) {
          // ignore session visited retrieval failure
          void 0;
        }

        const uniqueHistory = urls.filter((u) => !processedSet.has(u));
        const uniqueSession = uniqueHistory.filter((u) => !sessionSet.has(u));
        elements.uniqueCountHistory &&
          (elements.uniqueCountHistory.textContent = String(uniqueHistory.length));
        elements.uniqueCountSession &&
          (elements.uniqueCountSession.textContent = String(uniqueSession.length));

        const useUnique = !!elements.uniqueOnlyToggle?.checked;
        const useSession = !!elements.ignoreSessionToggle?.checked;
        let finalCount = urls.length;
        if (useUnique) finalCount = uniqueHistory.length;
        if (useSession)
          finalCount = useUnique
            ? uniqueSession.length
            : urls.filter((u) => !sessionSet.has(u)).length;
        elements.collectBtn.innerHTML = `<span>🔍 Собрать и проанализировать (${finalCount})</span>`;
        elements.collectInfo.style.display = 'block';
        elements.collectBtn.disabled = false;
      } else {
        elements.currentPage.textContent = 'Не страница ЄДРСР';
        elements.collectInfo.style.display = 'none';
        elements.collectBtn.disabled = true;
      }
    } catch (error) {
      elements.collectInfo.style.display = 'none';
      elements.collectBtn.disabled = true;
    }
  };

  const savePrompt = async () => {
    const name = elements.promptName.value.trim();
    const content = elements.customPrompt.value.trim();
    if (!name || !content) {
      alert('Название и текст промпта не могут быть пустыми.');
      return;
    }
    const savedPrompts = await getSavedPrompts();
    const newPrompts = savedPrompts.filter((p) => p.name !== name); // Overwrite if exists
    newPrompts.push({ name, content });
    await chrome.storage.local.set({ savedPrompts: newPrompts });

    elements.promptName.value = '';
    elements.customPrompt.value = content; // Keep content in textarea
    alert(`Промпт "${name}" сохранён!`);

    await populatePromptTemplates();
    elements.promptTemplate.value = content; // Select the newly saved prompt
    await updatePromptDescription();
  };

  const deleteSelectedPrompt = async () => {
    const selectedValue = elements.promptTemplate.value;
    const selectedOption = elements.promptTemplate.options[elements.promptTemplate.selectedIndex];

    if (
      selectedOption.parentElement.tagName !== 'OPTGROUP' ||
      selectedOption.parentElement.label !== 'Сохраненные промпты'
    ) {
      alert('Пожалуйста, выберите сохранённый промпт для удаления.');
      return;
    }

    const promptName = selectedOption.textContent;
    if (confirm(`Вы уверены, что хотите удалить промпт "${promptName}"?`)) {
      const savedPrompts = await getSavedPrompts();
      const newPrompts = savedPrompts.filter((p) => p.name !== promptName);
      await chrome.storage.local.set({ savedPrompts: newPrompts });
      alert(`Промпт "${promptName}" удалён.`);
      await populatePromptTemplates();
      await updatePromptDescription();
    }
  };

  const getSavedPrompts = async () => {
    try {
      const result = await chrome.storage.local.get(['savedPrompts']);
      return result.savedPrompts || [];
    } catch (e) {
      console.error('EDRSR-AI: Error getting saved prompts from popup', e);
      return [];
    }
  };

  const populatePromptTemplates = async () => {
    const promptGroups = PROMPT_GROUPS;
    const savedPrompts = await getSavedPrompts();

    elements.promptTemplate.innerHTML = ''; // Clear existing options
    for (const groupLabel in promptGroups) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = groupLabel;
      for (const key in promptGroups[groupLabel]) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = promptGroups[groupLabel][key];
        optgroup.appendChild(option);
      }
      elements.promptTemplate.appendChild(optgroup);
    }

    if (savedPrompts.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Сохраненные промпты';
      savedPrompts.forEach((prompt) => {
        const option = document.createElement('option');
        // We no longer need a special prefix; the prompt content is sent directly.
        // The 'custom' value is now just for showing the textarea.
        option.value = prompt.content;
        option.textContent = prompt.name;
        optgroup.appendChild(option);
      });
      elements.promptTemplate.appendChild(optgroup);
    }
  };

  const updatePromptDescription = async () => {
    const selectedValue = elements.promptTemplate.value;
    const selectedOption = elements.promptTemplate.options[elements.promptTemplate.selectedIndex];

    // Check if it's a pre-defined prompt
    if (PROMPT_DESCRIPTIONS[selectedValue]) {
      elements.promptDescription.textContent = PROMPT_DESCRIPTIONS[selectedValue];
    }
    // Check if it's from the "Сохраненные промпты" optgroup
    else if (
      selectedOption.parentElement.tagName === 'OPTGROUP' &&
      selectedOption.parentElement.label === 'Сохраненные промпты'
    ) {
      elements.promptDescription.textContent = `Ваш сохранённый промпт: "${selectedValue.substring(0, 70)}..."`;
    } else {
      elements.promptDescription.textContent = '';
    }
  };

  // --- Initialization ---

  elements.tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  elements.collectBtn.addEventListener('click', collectLinks);
  elements.uniqueOnlyToggle?.addEventListener('change', updatePageInfo);
  elements.ignoreSessionToggle?.addEventListener('change', updatePageInfo);
  elements.checkStatusBtn.addEventListener('click', () => {
    const jobId = elements.jobIdInput.value.trim();
    if (jobId) port.postMessage({ type: 'GET_JOB_STATUS', payload: { jobId } });
  });
  elements.loadLastJobBtn.addEventListener('click', () =>
    port.postMessage({ type: 'GET_LAST_JOB' })
  );

  elements.retryJobBtn.addEventListener('click', () => {
    if (currentJobData?.id && clientId) {
      const isStuck =
        ['downloading', 'analyzing', 'queued', 'pending'].includes(currentJobData.status) &&
        currentJobData.created_at &&
        Date.now() - new Date(currentJobData.created_at).getTime() > 10 * 60 * 1000;

      const message = isStuck
        ? 'Это задание зависло. Перезапустить его? Будет создано новое задание с теми же параметрами.'
        : 'Перезапустить это задание? Будет создано новое задание с теми же параметрами.';

      if (confirm(message)) {
        port.postMessage({
          type: 'RETRY_JOB',
          payload: { jobId: currentJobData.id },
        });
      }
    }
  });

  elements.forceRetryJobBtn.addEventListener('click', () => {
    if (currentJobData?.id && clientId) {
      const message =
        'ВНИМАНИЕ! Принудительно перезапустить активное задание? Текущий прогресс будет потерян, и будет создано новое задание.';

      if (confirm(message)) {
        port.postMessage({
          type: 'RETRY_JOB',
          payload: { jobId: currentJobData.id },
        });
      }
    }
  });

  elements.openResultsPageBtn.addEventListener('click', () => {
    if (currentJobData?.id) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`results.html?jobId=${currentJobData.id}`) });
    }
  });

  elements.showResultBtn.addEventListener('click', () => {
    if (currentJobData?.analysis) {
      elements.resultArea.innerHTML = sanitizeHtml(marked.parse(currentJobData.analysis));
      elements.resultArea.classList.remove('hidden');
      elements.copyResultBtn.classList.remove('hidden');
    }
  });

  elements.copyResultBtn.addEventListener('click', async () => {
    if (!currentJobData?.analysis) return;
    await navigator.clipboard.writeText(currentJobData.analysis);
    elements.copyResultBtn.textContent = '✅ Скопировано!';
    setTimeout(() => {
      elements.copyResultBtn.textContent = '📋 Копировать';
    }, 2000);
  });

  elements.promptTemplate.addEventListener('change', async () => {
    // A saved prompt is a type of custom prompt, but the text is pre-filled,
    // so the custom text area is not needed. The prompt content is the value.
    const isCustomOption = elements.promptTemplate.value === 'custom';
    elements.customPromptContainer.classList.toggle('hidden', !isCustomOption);

    // If we select a saved prompt, its value is the prompt itself.
    // If we select "Свій варіант", the value is "custom" and we need the text area.
    // All other standard prompts have their own values.
    if (!isCustomOption) {
      elements.customPrompt.value = '';
    }

    await updatePromptDescription();
  });

  elements.savePromptBtn.addEventListener('click', savePrompt);
  elements.deletePromptBtn.addEventListener('click', deleteSelectedPrompt);
  elements.loginBtn?.addEventListener('click', async () => {
    try {
      const email = elements.authEmail.value.trim();
      const password = elements.authPassword.value;
      if (!email || !password) return alert('Укажите email и пароль');
      elements.authStatus.textContent = 'Вход...';
      await signInWithPassword(email, password);
      elements.authStatus.textContent = 'Успешный вход.';
      port.postMessage({ type: 'AUTH_CHANGED' });
    } catch (e) {
      elements.authStatus.textContent = `Ошибка: ${e.message}`;
    } finally {
      updateAuthUI();
    }
  });
  elements.signupBtn?.addEventListener('click', async () => {
    try {
      const email = elements.authEmail.value.trim();
      const password = elements.authPassword.value;
      if (!email || !password) return alert('Укажите email и пароль');
      elements.authStatus.textContent = 'Регистрация...';
      const result = await signUpWithPassword(email, password);
      if (result.status === 'signed_in') {
        elements.authStatus.textContent = 'Аккаунт создан и выполнен вход.';
        port.postMessage({ type: 'AUTH_CHANGED' });
        await updateAuthUI();
      } else {
        // Email подтверждения включён — не пытаемся входить автоматически
        elements.authStatus.textContent =
          'Аккаунт создан. Подтвердите почту по ссылке в письме, затем войдите.';
        // Залишаємо поля видимими, щоб користувач міг увійти після підтвердження
      }
    } catch (e) {
      elements.authStatus.textContent = `Ошибка: ${e.message}`;
    }
  });
  elements.logoutBtn?.addEventListener('click', async () => {
    await signOut();
    elements.authStatus.textContent = 'Вы вышли.';
    updateAuthUI();
  });

  elements.togglePwdBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const input = elements.authPassword;
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    elements.togglePwdBtn.textContent = isPwd ? 'Скрыть' : 'Показать';
  });

  elements.recoverBtn?.addEventListener('click', async () => {
    try {
      const email = elements.authEmail.value.trim();
      if (!email) return alert('Укажите email для восстановления пароля.');
      elements.authStatus.textContent = 'Отправляю письмо для восстановления...';
      const { recoverPassword } = await import('./auth.js');
      await recoverPassword(email, SUPABASE_REDIRECT_TO);
      elements.authStatus.textContent =
        'Письмо для восстановления пароля отправлено. Проверьте почту.';
    } catch (e) {
      elements.authStatus.textContent = `Ошибка: ${e.message}`;
    }
  });

  // Initial load
  (async () => {
    await populatePromptTemplates();
    await updatePromptDescription();
    updatePageInfo();
    port.postMessage({ type: 'GET_LAST_JOB' });
    port.postMessage({ type: 'GET_CLIENT_ID' });
    updateAuthUI();
  })();
});
