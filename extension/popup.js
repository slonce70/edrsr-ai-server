/* eslint-disable no-console */
// --- EDRSR-AI Popup Script v2.0 ---
// This script uses a modern, robust architecture with a long-lived port
// connection to the service worker, which acts as the central controller.
import { getPromptDescriptions, getPromptGroupLabels } from './prompt-definitions.js';
import { SUPABASE_REDIRECT_TO } from './config.js';
import {
  isAuthenticated,
  signInWithPassword,
  signOut,
  getSession,
  signUpWithPassword,
} from './auth.js';
import {
  getPrompts,
  savePrompt as savePromptRemote,
  deletePrompt as deletePromptRemote,
} from './prompt-storage.js';
import { applyTranslations, formatUiDate, getLocale, initI18n, setLocale, t } from './i18n.js';

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
  let lastHistory = null;
  let lastServerStatus = 'disconnected';
  let savedPrompts = [];
  let savedPromptsById = new Map();
  let selectedSavedPromptId = null;
  let promptDefinitionsCache = null;
  let promptDefinitionsLocale = null;

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
    localeSelect: document.getElementById('localeSelect'),
    footerStatus: document.getElementById('footer-status'),
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
        alert(t('common.errorPrefix', { message: payload.message }));
        break;
      case 'AUTH_REQUIRED':
        switchTab('auth');
        elements.authStatus.textContent = t('popup.messages.authRequired');
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
    lastServerStatus = status;
    switch (status) {
      case 'connected':
        elements.serverStatus.className = 'status-indicator status-online';
        elements.serverStatus.innerHTML = `<span><div class="status-dot dot-online"></div>${t(
          'popup.messages.serverConnected'
        )}</span>`;
        break;
      case 'disconnected':
        elements.serverStatus.className = 'status-indicator status-offline';
        elements.serverStatus.innerHTML = `<span><div class="status-dot dot-offline"></div>${t(
          'popup.messages.serverDisconnected'
        )}</span>`;
        break;
      case 'reconnecting':
        elements.serverStatus.className = 'status-indicator status-offline';
        elements.serverStatus.innerHTML = `<span><div class="status-dot dot-offline"></div>${t(
          'popup.messages.serverReconnecting'
        )}</span>`;
        break;
    }
  };

  const getStatusText = (status) => {
    const key = `status.${status}`;
    const text = t(key);
    return text === key ? status : text;
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
    const shortId = jobData.id.substring(0, 8);

    // Проверяем, не зависла ли задача (активна больше 10 минут)
    const isStuck =
      ['downloading', 'analyzing', 'queued', 'pending'].includes(jobData.status) &&
      jobData.created_at &&
      Date.now() - new Date(jobData.created_at).getTime() > 10 * 60 * 1000; // 10 минут

    elements.jobIdInput.value = jobData.id;
    elements.jobStatus.classList.remove('hidden');
    // Используем title, если он есть, иначе - ID
    elements.jobTitle.textContent =
      jobData.title || t('popup.messages.jobTitleFallback', { id: shortId });

    // Показываем специальный статус для зависших задач
    let statusText = '';
    if (isStuck) {
      statusText = t('popup.messages.stuckStatus');
    } else {
      switch (jobData.status) {
        case 'queued':
        case 'pending':
          statusText = getStatusText(jobData.status);
          break;
        case 'downloading':
          // Show detailed progress while downloading (fallback to status label)
          statusText = jobData.message ? jobData.message : getStatusText(jobData.status);
          break;
        case 'analyzing':
          // Show detailed progress message from server while AI processes batches
          statusText = jobData.message ? jobData.message : t('popup.messages.analyzingFallback');
          break;
        case 'completed':
          statusText = t('popup.messages.completed');
          break;
        case 'error':
          statusText = jobData.message ? `❌ ${jobData.message}` : t('popup.messages.error');
          break;
        default:
          statusText = getStatusText(jobData.status);
      }
    }
    // Hide status row only when there is no text to show
    if (elements.jobStatusRow) {
      elements.jobStatusRow.classList.toggle('hidden', !statusText);
    }
    elements.jobStatusText.textContent = statusText;
    elements.jobProgress.textContent = `${jobData.progress || 0}%`;
    elements.progressFill.style.width = `${jobData.progress || 0}%`;
    elements.jobLinks.textContent = `${jobData.processed_links || 0} / ${jobData.total_links || 0}`;
    elements.jobStartTime.textContent = formatUiDate(jobData.created_at);

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
      let buttonText = t('popup.statusTab.retryBtn');
      if (isStuck) {
        buttonText = t('popup.messages.retryStuckButton');
      } else if (isWarning) {
        buttonText = t('popup.statusTab.retryBtn');
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
    const shortId = jobData.id.substring(0, 8);

    if (titleSpan) {
      titleSpan.textContent =
        jobData.title || t('popup.messages.jobIdTitleFallback', { id: shortId });
    }
    if (statusSpan) {
      statusSpan.textContent = `${getStatusText(jobData.status)} ${jobData.progress || ''}%`;
    }
  };

  const renderHistory = (jobs) => {
    lastHistory = jobs;
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
        const shortId = job.id.substring(0, 8);
        const titleText = job.title || t('popup.messages.jobIdTitleFallback', { id: shortId });
        infoContainer.innerHTML = sanitizeHtml(`
          <div class="job-details">
            <span class="job-id">${titleText}</span>
            <span class="job-status-hist">${getStatusText(job.status)} ${job.progress || ''}%</span>
            <span class="job-date">${formatUiDate(job.created_at)}</span>
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
        editBtn.title = t('popup.messages.editTitle');

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-job-btn';
        deleteBtn.innerHTML = '&#x1F5D1;'; // Trash can icon
        deleteBtn.title = t('popup.messages.deleteTitle');

        buttonsContainer.appendChild(editBtn);
        buttonsContainer.appendChild(deleteBtn);

        // --- Edit Mode Container (initially hidden) ---
        const editContainer = document.createElement('div');
        editContainer.classList.add('edit-container', 'hidden');
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.value = job.title || '';
        editInput.placeholder = t('popup.messages.editPlaceholder');
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
          if (confirm(t('popup.messages.confirmDeleteJob', { title: titleText }))) {
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
      elements.historyList.innerHTML = `<li style="text-align:center;color:#999;">${t(
        'popup.historyTab.empty'
      )}</li>`;
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
      elements.authStatus.textContent = t('popup.messages.authStatusAuthed', {
        email: session?.user?.email || null,
        id: session?.user?.id || null,
      });
      if (elements.authBadge) {
        elements.authBadge.textContent = t('popup.messages.authBadgeAuthed', {
          email: session?.user?.email || null,
        });
        elements.authBadge.classList.remove('badge-guest');
        elements.authBadge.classList.add('badge-auth');
      }
      // Скрыть поля и кнопки логина/регистрации, показать logout
      document.querySelectorAll('.auth-fields').forEach((el) => el.classList.add('hidden'));
      document.querySelector('.auth-actions')?.classList.add('hidden');
      elements.logoutBtn.classList.remove('hidden');
      elements.recoverBtn?.classList.add('hidden');
    } else {
      elements.authStatus.textContent = t('popup.messages.authStatusGuest');
      if (elements.authBadge) {
        elements.authBadge.textContent = t('popup.messages.authBadgeGuest');
        elements.authBadge.classList.remove('badge-auth');
        elements.authBadge.classList.add('badge-guest');
      }
      document.querySelectorAll('.auth-fields').forEach((el) => el.classList.remove('hidden'));
      document.querySelector('.auth-actions')?.classList.remove('hidden');
      elements.logoutBtn.classList.add('hidden');
      elements.recoverBtn?.classList.remove('hidden');
    }
    setPromptControlsEnabled(authed);
    await populatePromptTemplates({ force: true });
    await updatePromptDescription();
    updateSaveButtonLabel();
  }

  const loadPromptDefinitions = async ({ force = false } = {}) => {
    const locale = getLocale();
    if (!force && promptDefinitionsCache && promptDefinitionsLocale === locale) {
      return promptDefinitionsCache;
    }
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'PROMPT_DEFINITIONS_GET',
        payload: { locale, force },
      });
      if (res?.definitions) {
        promptDefinitionsCache = res.definitions;
        promptDefinitionsLocale = locale;
        return promptDefinitionsCache;
      }
    } catch {
      // ignore and fallback below
    }
    promptDefinitionsCache = {
      groups: getPromptGroupLabels(locale),
      descriptions: getPromptDescriptions(locale),
    };
    promptDefinitionsLocale = locale;
    return promptDefinitionsCache;
  };

  const collectLinks = async () => {
    elements.collectBtn.innerHTML = '<div class="loading"></div>';
    elements.collectBtn.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Запрашиваем данные у content.js, а не инжектим свой скрипт
      const links = await chrome.tabs.sendMessage(tab.id, { type: 'GET_DECISION_LINKS' });

      if (!links || links.length === 0) {
        throw new Error(t('popup.messages.errorNoLinks'));
      }

      // Optionally filter only unique (not in user's job history)
      let finalLinks = links;
      if (elements.uniqueOnlyToggle?.checked) {
        const res = await chrome.runtime.sendMessage({
          type: 'API_CHECK_PROCESSED',
          urls: finalLinks.map((l) => l.url),
        });
        if (res && res.success && Array.isArray(res.urls)) {
          const processed = new Set(res.urls);
          finalLinks = finalLinks.filter((l) => l && l.url && !processed.has(l.url));
        }
        if (finalLinks.length === 0) {
          throw new Error(t('popup.messages.errorNoUnique'));
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
          throw new Error(t('popup.messages.errorNoNewSession'));
        }
      }

      let prompt;
      let promptLabel = null;
      const selectedIndex = elements.promptTemplate.selectedIndex;
      const selectedOption = elements.promptTemplate.options[selectedIndex];
      const selectedValue = elements.promptTemplate.value;
      const selectedPromptId = selectedOption?.dataset?.promptId || null;
      const customPrompt = elements.customPrompt.value.trim();
      if (selectedValue === 'custom') {
        if (!customPrompt) {
          throw new Error(t('popup.messages.promptEmpty'));
        }
        prompt = customPrompt;
        promptLabel = prompt
          ? prompt.split(/\s+/).slice(0, 6).join(' ')
          : t('popup.messages.promptLabelCustom');
      } else if (selectedPromptId) {
        if (!customPrompt) {
          throw new Error(t('popup.messages.promptEmpty'));
        }
        prompt = customPrompt;
        const name = elements.promptName.value.trim();
        promptLabel = name || selectedOption?.textContent || null;
      } else if (selectedValue !== 'default') {
        prompt = selectedValue;
        promptLabel = selectedOption?.textContent || null;
      } else {
        prompt = null;
        promptLabel = null;
      }

      port.postMessage({
        type: 'START_JOB',
        payload: {
          links: finalLinks,
          cookie: '',
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
      alert(t('common.errorPrefix', { message: error.message }));
    } finally {
      elements.collectBtn.innerHTML = `<span>${t('popup.collect.collectBtn')}</span>`;
      updatePageInfo();
    }
  };

  const updatePageInfo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url?.includes('reyestr.court.gov.ua')) {
        elements.currentPage.textContent = t('popup.messages.currentPageOk');
        const decisions = await chrome.tabs.sendMessage(tab.id, { type: 'GET_DECISION_LINKS' });
        const urls = (decisions || []).map((d) => d.url).filter(Boolean);
        elements.linksCount.textContent = String(urls.length);

        let processedSet = new Set();
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'API_CHECK_PROCESSED',
            urls,
          });
          if (res?.success && Array.isArray(res.urls)) processedSet = new Set(res.urls);
        } catch {
          // ignore processed URLs retrieval failure
          void 0;
        }

        let sessionSet = new Set();
        try {
          const sres = await chrome.runtime.sendMessage({ type: 'API_GET_SESSION_VISITED' });
          if (sres?.success && Array.isArray(sres.urls)) sessionSet = new Set(sres.urls);
        } catch {
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
        elements.collectBtn.innerHTML = `<span>${t('popup.collect.collectBtnWithCount', {
          count: finalCount,
        })}</span>`;
        elements.collectInfo.style.display = 'block';
        elements.collectBtn.disabled = false;
      } else {
        elements.currentPage.textContent = t('popup.messages.currentPageNo');
        elements.collectInfo.style.display = 'none';
        elements.collectBtn.disabled = true;
      }
    } catch {
      elements.collectInfo.style.display = 'none';
      elements.collectBtn.disabled = true;
    }
  };

  const savePrompt = async () => {
    const name = elements.promptName.value.trim();
    const content = elements.customPrompt.value.trim();
    if (!name || !content) {
      alert(t('popup.messages.promptSaveEmpty'));
      return;
    }
    try {
      const isUpdate = !!selectedSavedPromptId;
      const result = await savePromptRemote({
        id: selectedSavedPromptId,
        name,
        content,
      });
      if (result?.authRequired) {
        alert(t('popup.messages.promptAuthRequired'));
        return;
      }
      if (!result?.success) {
        alert(t('common.errorPrefix', { message: result?.error || 'Server error' }));
        return;
      }

      const prompt = result.prompt;
      selectedSavedPromptId = prompt.id;
      elements.promptName.value = prompt.name;
      elements.customPrompt.value = prompt.content;
      savedPromptsById.set(prompt.id, prompt);

      await populatePromptTemplates({ selectPromptId: prompt.id });
      await updatePromptDescription();
      updateSaveButtonLabel();

      const messageKey = isUpdate ? 'popup.messages.promptUpdated' : 'popup.messages.promptSaved';
      const message = result.renamed
        ? t('popup.messages.promptSavedAs', { name: prompt.name })
        : t(messageKey, { name: prompt.name });
      alert(message);
    } catch (error) {
      alert(t('common.errorPrefix', { message: error.message || 'Server error' }));
    }
  };

  const deleteSelectedPrompt = async () => {
    if (!selectedSavedPromptId) {
      alert(t('popup.messages.promptDeleteSelect'));
      return;
    }
    const promptName =
      savedPromptsById.get(selectedSavedPromptId)?.name || t('popup.messages.promptUnnamed');
    if (confirm(t('popup.messages.promptDeleteConfirm', { name: promptName }))) {
      try {
        const result = await deletePromptRemote(selectedSavedPromptId);
        if (result?.authRequired) {
          alert(t('popup.messages.promptAuthRequired'));
          return;
        }
        if (!result?.success) {
          alert(t('common.errorPrefix', { message: result?.error || 'Server error' }));
          return;
        }
        selectedSavedPromptId = null;
        elements.promptName.value = '';
        elements.customPrompt.value = '';
        await populatePromptTemplates();
        await updatePromptDescription();
        updateSaveButtonLabel();
        alert(t('popup.messages.promptDeleted', { name: promptName }));
      } catch (error) {
        alert(t('common.errorPrefix', { message: error.message || 'Server error' }));
      }
    }
  };

  const updateSaveButtonLabel = () => {
    const key = selectedSavedPromptId
      ? 'popup.collect.updatePromptBtn'
      : 'popup.collect.savePromptBtn';
    elements.savePromptBtn.textContent = t(key);
  };

  const setPromptControlsEnabled = (enabled) => {
    elements.savePromptBtn.disabled = !enabled;
    elements.deletePromptBtn.disabled = !enabled;
    elements.promptName.disabled = !enabled;
    const title = enabled ? '' : t('popup.messages.promptAuthRequired');
    elements.savePromptBtn.title = title;
    elements.deletePromptBtn.title = title;
    elements.promptName.title = title;
  };

  const loadSavedPrompts = async ({ force = false } = {}) => {
    const result = await getPrompts({ force });
    if (!result?.success) {
      savedPrompts = [];
      savedPromptsById = new Map();
      return { authRequired: result?.authRequired, prompts: [] };
    }
    savedPrompts = Array.isArray(result.prompts) ? result.prompts : [];
    savedPromptsById = new Map(savedPrompts.map((p) => [p.id, p]));
    if (selectedSavedPromptId && !savedPromptsById.has(selectedSavedPromptId)) {
      selectedSavedPromptId = null;
    }
    return { prompts: savedPrompts };
  };

  const selectPromptOptionById = (promptId) => {
    const options = Array.from(elements.promptTemplate.options);
    const match = options.find((opt) => opt.dataset?.promptId === promptId);
    if (match) {
      elements.promptTemplate.value = match.value;
      return true;
    }
    return false;
  };

  const populatePromptTemplates = async ({ selectPromptId = null, force = false } = {}) => {
    const { groups: promptGroups } = await loadPromptDefinitions({ force });
    const previousValue = elements.promptTemplate.value;
    const previousSavedId = selectedSavedPromptId;
    await loadSavedPrompts({ force });

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
      optgroup.label = t('popup.collect.savedPromptsLabel');
      savedPrompts.forEach((prompt) => {
        const option = document.createElement('option');
        option.value = prompt.id;
        option.textContent = prompt.name;
        option.dataset.promptId = prompt.id;
        optgroup.appendChild(option);
      });
      elements.promptTemplate.appendChild(optgroup);
    }

    if (selectPromptId) {
      if (selectPromptOptionById(selectPromptId)) {
        const prompt = savedPromptsById.get(selectPromptId);
        selectedSavedPromptId = selectPromptId;
        elements.customPromptContainer.classList.remove('hidden');
        elements.customPrompt.value = prompt?.content || '';
        elements.promptName.value = prompt?.name || '';
      }
    } else if (previousSavedId && selectPromptOptionById(previousSavedId)) {
      const prompt = savedPromptsById.get(previousSavedId);
      elements.customPromptContainer.classList.remove('hidden');
      elements.customPrompt.value = prompt?.content || '';
      elements.promptName.value = prompt?.name || '';
    } else if (previousValue) {
      elements.promptTemplate.value = previousValue;
      selectedSavedPromptId = null;
    }
  };

  const updatePromptDescription = async () => {
    const selectedValue = elements.promptTemplate.value;
    const selectedOption = elements.promptTemplate.options[elements.promptTemplate.selectedIndex];
    const { descriptions: promptDescriptions } = await loadPromptDefinitions();

    // Check if it's a pre-defined prompt
    if (promptDescriptions[selectedValue]) {
      elements.promptDescription.textContent = promptDescriptions[selectedValue];
    }
    // Check if it's from saved prompts
    else if (selectedOption?.dataset?.promptId) {
      const prompt = savedPromptsById.get(selectedOption.dataset.promptId);
      const text = prompt?.content || '';
      elements.promptDescription.textContent = t('popup.messages.promptSavedDescription', {
        text: text.substring(0, 70),
      });
    } else {
      elements.promptDescription.textContent = '';
    }
  };

  const applyLocale = async () => {
    applyTranslations(document);
    if (elements.localeSelect) {
      elements.localeSelect.value = getLocale();
    }
    if (elements.footerStatus) {
      const version = chrome.runtime?.getManifest?.().version;
      elements.footerStatus.textContent = t('popup.footer', { version });
    }
    await populatePromptTemplates();
    await updatePromptDescription();
    updateSaveButtonLabel();
    updateServerStatus(lastServerStatus);
    if (currentJobData) updateJobStatusDisplay(currentJobData);
    if (lastHistory) renderHistory(lastHistory);
  };

  // --- Initialization ---

  elements.tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  elements.collectBtn.addEventListener('click', collectLinks);
  elements.localeSelect?.addEventListener('change', async () => {
    await setLocale(elements.localeSelect.value);
    await applyLocale();
  });
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
        ? t('popup.messages.retryStuckConfirm')
        : t('popup.messages.retryConfirm');

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
      const message = t('popup.messages.forceRetryConfirm');

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
    elements.copyResultBtn.textContent = t('popup.messages.copyResultCopied');
    setTimeout(() => {
      elements.copyResultBtn.textContent = t('popup.messages.copyResult');
    }, 2000);
  });

  elements.promptTemplate.addEventListener('change', async () => {
    const selectedOption = elements.promptTemplate.options[elements.promptTemplate.selectedIndex];
    const selectedValue = elements.promptTemplate.value;
    const selectedPromptId = selectedOption?.dataset?.promptId || null;
    const isCustomOption = selectedValue === 'custom';
    const isSavedPrompt = !!selectedPromptId;

    elements.customPromptContainer.classList.toggle('hidden', !(isCustomOption || isSavedPrompt));

    if (isSavedPrompt) {
      const prompt = savedPromptsById.get(selectedPromptId);
      selectedSavedPromptId = selectedPromptId;
      elements.customPrompt.value = prompt?.content || '';
      elements.promptName.value = prompt?.name || selectedOption?.textContent || '';
    } else if (isCustomOption) {
      selectedSavedPromptId = null;
    } else {
      selectedSavedPromptId = null;
      elements.customPrompt.value = '';
      elements.promptName.value = '';
    }

    updateSaveButtonLabel();
    await updatePromptDescription();
  });

  elements.savePromptBtn.addEventListener('click', savePrompt);
  elements.deletePromptBtn.addEventListener('click', deleteSelectedPrompt);
  elements.loginBtn?.addEventListener('click', async () => {
    try {
      const email = elements.authEmail.value.trim();
      const password = elements.authPassword.value;
      if (!email || !password) return alert(t('popup.messages.authLoginRequired'));
      elements.authStatus.textContent = t('popup.messages.authSigningIn');
      await signInWithPassword(email, password);
      elements.authStatus.textContent = t('popup.messages.authSignedIn');
      port.postMessage({ type: 'AUTH_CHANGED' });
    } catch (e) {
      elements.authStatus.textContent = t('popup.messages.authError', { message: e.message });
    } finally {
      updateAuthUI();
    }
  });
  elements.signupBtn?.addEventListener('click', async () => {
    try {
      const email = elements.authEmail.value.trim();
      const password = elements.authPassword.value;
      if (!email || !password) return alert(t('popup.messages.authLoginRequired'));
      elements.authStatus.textContent = t('popup.messages.authSigningIn');
      const result = await signUpWithPassword(email, password);
      if (result.status === 'signed_in') {
        elements.authStatus.textContent = t('popup.messages.authSignedUp');
        port.postMessage({ type: 'AUTH_CHANGED' });
        await updateAuthUI();
      } else {
        // Email подтверждения включён — не пытаемся входить автоматически
        elements.authStatus.textContent = t('popup.messages.authSignedUpConfirm');
        // Залишаємо поля видимими, щоб користувач міг увійти після підтвердження
      }
    } catch (e) {
      const message =
        e?.message === 'AUTH_RECOVER_FAILED' ? t('popup.messages.authRecoverFailed') : e.message;
      elements.authStatus.textContent = t('popup.messages.authError', { message });
    }
  });
  elements.logoutBtn?.addEventListener('click', async () => {
    await signOut();
    elements.authStatus.textContent = t('popup.messages.authLoggedOut');
    updateAuthUI();
  });

  elements.togglePwdBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const input = elements.authPassword;
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    elements.togglePwdBtn.textContent = isPwd ? t('popup.auth.hidePwd') : t('popup.auth.showPwd');
  });

  elements.recoverBtn?.addEventListener('click', async () => {
    try {
      const email = elements.authEmail.value.trim();
      if (!email) return alert(t('popup.messages.authRecoverPrompt'));
      elements.authStatus.textContent = t('popup.messages.authRecoverSending');
      const { recoverPassword } = await import('./auth.js');
      await recoverPassword(email, SUPABASE_REDIRECT_TO);
      elements.authStatus.textContent = t('popup.messages.authRecoverSent');
    } catch (e) {
      elements.authStatus.textContent = t('popup.messages.authError', { message: e.message });
    }
  });

  // Initial load
  (async () => {
    await initI18n();
    await applyLocale();
    updatePageInfo();
    port.postMessage({ type: 'GET_LAST_JOB' });
    port.postMessage({ type: 'GET_CLIENT_ID' });
    updateAuthUI();
  })();
});
