/* eslint-disable no-console */
// --- EDRSR-AI Content Script v2.1 ---
// This script's only responsibility is to listen for a request from the popup
// to get the number of links on the page. All other logic has been moved to
// the popup and service worker for a more robust architecture.

const SCRIPT_VERSION = '2.2';
let isProcessing = false;
let pageActiveJobId = null;
let i18nReady = null;
let promptStorageReady = null;

async function getI18n() {
  if (!i18nReady) {
    i18nReady = import(chrome.runtime.getURL('i18n.js')).then(async (mod) => {
      await mod.initI18n();
      return mod;
    });
  }
  return i18nReady;
}

function getDecisionLinkElements() {
  return Array.from(document.querySelectorAll('a[href^="/Review/"]'));
}

function hasDecisionLinks() {
  return getDecisionLinkElements().length > 0;
}

async function getPromptStorage() {
  if (!promptStorageReady) {
    promptStorageReady = import(chrome.runtime.getURL('prompt-storage.js'));
  }
  return promptStorageReady;
}

// --- UI & MODAL LOGIC (Restored from v1.5) ---

async function createModal() {
  if (document.getElementById('edrsr-ai-modal')) return;
  const { t, getLocale } = await getI18n();

  const modalHTML = `
    <div id="edrsr-ai-modal-backdrop" class="edrsr-ai-fade-in" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 99998; display: flex; align-items: center; justify-content: center; font-family: 'Segoe UI', 'Roboto', sans-serif;">
        <div id="edrsr-ai-modal-content" class="edrsr-ai-slide-in" style="background: #fcfcfc; padding: 25px; border-radius: 16px; width: 550px; max-width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.2); border: 1px solid #e0e0e0;">
            <h2 style="text-align: center; margin-top: 0; margin-bottom: 25px; color: #333; font-weight: 600;">${t(
              'content.modalTitle'
            )}</h2>
            
            <div style="margin-bottom: 20px;">
                <label for="edrsr-prompt-template" style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #555;">${t(
                  'content.selectAnalysisLabel'
                )}</label>
                <select id="edrsr-prompt-template" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 15px; background: #fff;">
                    <!-- Options populated by script -->
                </select>
                <p id="edrsr-prompt-description" style="font-size: 13px; color: #666; margin-top: 10px; min-height: 3em; padding: 8px; border-radius: 6px; background: #f0f0f0; border-left: 3px solid #667eea;"></p>
            </div>

            <div id="edrsr-custom-prompt-container" style="display: none; margin-bottom: 20px;">
                <label for="edrsr-custom-prompt" style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #555;">${t(
                  'content.customPromptLabel'
                )}</label>
                <textarea id="edrsr-custom-prompt" rows="4" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 14px; resize: vertical;" placeholder="${t(
                  'content.customPromptPlaceholder'
                )}"></textarea>
                
                <div style="margin-top: 15px; display: flex; gap: 10px; align-items: flex-end;">
                  <div style="flex-grow: 1;">
                      <label for="edrsr-prompt-name" style="display: block; margin-bottom: 5px; font-weight: 500; font-size: 12px; color: #555;">${t(
                        'content.promptNameLabel'
                      )}</label>
                      <input type="text" id="edrsr-prompt-name" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 13px;" placeholder="${t(
                        'content.promptNamePlaceholder'
                      )}">
                  </div>
                  <button id="edrsr-save-prompt" style="padding: 8px 15px; border: none; background: #6c757d; color: white; border-radius: 6px; font-size: 13px; cursor: pointer;">${t(
                    'content.savePromptBtn'
                  )}</button>
            </div>
            </div>

             <div style="margin-bottom: 20px;">
                <label for="edrsr-saved-prompts" style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #555;">${t(
                  'content.savedPromptsLabel'
                )}</label>
                <div style="display: flex; gap: 10px;">
                    <select id="edrsr-saved-prompts" style="flex-grow: 1; width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 15px; background: #fff;">
                        <option value="">${t('content.savedPromptsDefault')}</option>
                    </select>
                    <button id="edrsr-delete-prompt" style="padding: 8px 12px; border: none; background: #dc3545; color: white; border-radius: 8px; font-size: 14px; cursor: pointer;" title="${t(
                      'content.deletePromptTitle'
                    )}">🗑️</button>
                </div>
            </div>
            
            <button id="edrsr-start-analysis" style="width: 100%; padding: 15px; border: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s ease;">${t(
              'content.startAnalysisBtn'
            )}</button>
            <button id="edrsr-copy-urls" style="width: 100%; padding: 12px; margin-top: 10px; border: 1px solid #ddd; background: #f5f5f5; color: #333; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;">${t(
              'content.copyUrlsBtn'
            )}</button>
        </div>
    </div>
    <style>
      @keyframes edrsr-ai-fade-in { from { opacity: 0; } to { opacity: 1; } }
      .edrsr-ai-fade-in { animation: edrsr-ai-fade-in 0.3s ease; }
      @keyframes edrsr-ai-slide-in { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .edrsr-ai-slide-in { animation: edrsr-ai-slide-in 0.4s ease forwards; }

      /* Simple checkboxes inside modal */
      .edrsr-checks { display:flex; flex-direction:column; gap:8px; }
      .edrsr-check { display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; }
      .edrsr-check input { width:16px; height:16px; accent-color:#667eea; }
      .edrsr-check-text { font-size:13px; color:#444; line-height:1.3; }
    </style>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const backdrop = document.getElementById('edrsr-ai-modal-backdrop');
  const templateSelect = document.getElementById('edrsr-prompt-template');
  const customContainer = document.getElementById('edrsr-custom-prompt-container');
  const startButton = document.getElementById('edrsr-start-analysis');
  const copyUrlsBtn = document.getElementById('edrsr-copy-urls');
  const customPromptTextarea = document.getElementById('edrsr-custom-prompt');
  const promptNameInput = document.getElementById('edrsr-prompt-name');
  const savePromptBtn = document.getElementById('edrsr-save-prompt');
  const savedPromptsSelect = document.getElementById('edrsr-saved-prompts');
  const deletePromptBtn = document.getElementById('edrsr-delete-prompt');
  let savedPrompts = [];
  let savedPromptsById = new Map();
  let selectedSavedPromptId = null;

  // Add checkboxes next to the start button (simple, accessible)
  if (!document.getElementById('edrsr-unique-only')) {
    const uniqueWrap = document.createElement('div');
    uniqueWrap.style.cssText = 'margin:10px 0; display:flex; flex-direction:column; gap:8px;';
    uniqueWrap.innerHTML = `
      <div class="edrsr-checks">
        <label class="edrsr-check">
          <input id="edrsr-unique-only" type="checkbox" checked />
          <span class="edrsr-check-text">${t('content.uniqueOnlyLabel')}</span>
        </label>
        <label class="edrsr-check">
          <input id="edrsr-ignore-session" type="checkbox" />
          <span class="edrsr-check-text">${t('content.ignoreSessionLabel')}</span>
        </label>
      </div>
    `;
    startButton.insertAdjacentElement('beforebegin', uniqueWrap);
  }

  // --- Prompt Management Functions ---
  const setPromptControlsEnabled = (enabled) => {
    savePromptBtn.disabled = !enabled;
    deletePromptBtn.disabled = !enabled;
    promptNameInput.disabled = !enabled;
    const title = enabled ? '' : t('content.messages.promptAuthRequired');
    savePromptBtn.title = title;
    deletePromptBtn.title = title;
    promptNameInput.title = title;
  };

  const loadSavedPrompts = async ({ force = false } = {}) => {
    try {
      const storage = await getPromptStorage();
      const result = await storage.getPrompts({ force });
      if (!result?.success) {
        savedPrompts = [];
        savedPromptsById = new Map();
        selectedSavedPromptId = null;
        setPromptControlsEnabled(false);
        return [];
      }
      savedPrompts = Array.isArray(result.prompts) ? result.prompts : [];
      savedPromptsById = new Map(savedPrompts.map((p) => [p.id, p]));
      if (selectedSavedPromptId && !savedPromptsById.has(selectedSavedPromptId)) {
        selectedSavedPromptId = null;
      }
      setPromptControlsEnabled(true);
      return savedPrompts;
    } catch (e) {
      console.error('EDRSR-AI: Error getting saved prompts', e);
      setPromptControlsEnabled(false);
      return [];
    }
  };

  const populateSavedPrompts = async (selectId = null) => {
    await loadSavedPrompts();
    savedPromptsSelect.innerHTML = `<option value="">${t('content.savedPromptsDefault')}</option>`; // Reset
    savedPrompts.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      savedPromptsSelect.appendChild(option);
    });
    if (selectId) {
      savedPromptsSelect.value = selectId;
    }
  };

  savePromptBtn.addEventListener('click', async () => {
    const name = promptNameInput.value.trim();
    const content = customPromptTextarea.value.trim();
    if (!name || !content) {
      showMessage(t('content.messages.promptSaveEmpty'), 'warning');
      return;
    }
    try {
      const storage = await getPromptStorage();
      const isUpdate = !!selectedSavedPromptId;
      const result = await storage.savePrompt({
        id: selectedSavedPromptId,
        name,
        content,
      });
      if (result?.authRequired) {
        showMessage(t('content.messages.promptAuthRequired'), 'warning');
        return;
      }
      if (!result?.success) {
        showMessage(result?.error || t('content.messages.promptSaveError'), 'error');
        return;
      }
      const prompt = result.prompt;
      selectedSavedPromptId = prompt.id;
      promptNameInput.value = prompt.name;
      customPromptTextarea.value = prompt.content;
      const messageKey = isUpdate
        ? 'content.messages.promptUpdated'
        : 'content.messages.promptSaved';
      const message = result.renamed
        ? t('content.messages.promptSavedAs', { name: prompt.name })
        : t(messageKey, { name: prompt.name });
      showMessage(message, 'success');
      await populateSavedPrompts(prompt.id);
    } catch (e) {
      showMessage(e.message || t('content.messages.promptSaveError'), 'error');
    }
  });

  copyUrlsBtn?.addEventListener('click', async () => {
    const uniqueOnly = !!document.getElementById('edrsr-unique-only')?.checked;
    const ignoreSessionVisited = !!document.getElementById('edrsr-ignore-session')?.checked;
    await copyDecisionUrls({ uniqueOnly, ignoreSessionVisited });
  });

  deletePromptBtn.addEventListener('click', async () => {
    if (!selectedSavedPromptId) {
      showMessage(t('content.messages.promptDeleteSelect'), 'warning');
      return;
    }
    const promptName =
      savedPromptsById.get(selectedSavedPromptId)?.name || t('content.messages.promptUnnamed');
    if (confirm(t('content.messages.promptDeleteConfirm', { name: promptName }))) {
      try {
        const storage = await getPromptStorage();
        const result = await storage.deletePrompt(selectedSavedPromptId);
        if (result?.authRequired) {
          showMessage(t('content.messages.promptAuthRequired'), 'warning');
          return;
        }
        if (!result?.success) {
          showMessage(result?.error || t('content.messages.promptDeleteError'), 'error');
          return;
        }
        selectedSavedPromptId = null;
        promptNameInput.value = '';
        customPromptTextarea.value = '';
        savedPromptsSelect.value = '';
        showMessage(t('content.messages.promptDeleted', { name: promptName }), 'success');
        await populateSavedPrompts();
      } catch (e) {
        showMessage(e.message || t('content.messages.promptDeleteError'), 'error');
      }
    }
  });

  savedPromptsSelect.addEventListener('change', async () => {
    const selectedId = savedPromptsSelect.value;
    if (!selectedId) {
      selectedSavedPromptId = null;
      return;
    }
    const selectedPrompt = savedPromptsById.get(selectedId);
    if (selectedPrompt) {
      templateSelect.value = 'custom'; // Switch to custom type
      customContainer.style.display = 'block';
      customPromptTextarea.value = selectedPrompt.content;
      promptNameInput.value = selectedPrompt.name;
      selectedSavedPromptId = selectedPrompt.id;
    }
  });

  // --- Populate prompts and handle descriptions ---
  const loadPromptDefinitions = async () => {
    const locale = getLocale();
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'PROMPT_DEFINITIONS_GET',
        payload: { locale },
      });
      if (res?.definitions) {
        return res.definitions;
      }
    } catch {
      // ignore and fallback below
    }
    const promptModule = await import(chrome.runtime.getURL('prompt-definitions.js'));
    return {
      groups: promptModule.getPromptGroupLabels(locale),
      descriptions: promptModule.getPromptDescriptions(locale),
    };
  };

  loadPromptDefinitions()
    .then(({ groups: promptGroups, descriptions: promptDescriptions }) => {
      for (const groupLabel in promptGroups) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupLabel;
        for (const key in promptGroups[groupLabel]) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = promptGroups[groupLabel][key];
          optgroup.appendChild(option);
        }
        templateSelect.appendChild(optgroup);
      }

      const descriptionP = document.getElementById('edrsr-prompt-description');
      const updateDescription = () => {
        const selectedValue = templateSelect.value;
        descriptionP.textContent = promptDescriptions[selectedValue] || '';
        const isCustom = selectedValue === 'custom';
        customContainer.style.display = isCustom ? 'block' : 'none';
        if (!isCustom) {
          selectedSavedPromptId = null;
          savedPromptsSelect.value = '';
          customPromptTextarea.value = '';
          promptNameInput.value = '';
        }
      };

      templateSelect.addEventListener('change', updateDescription);
      updateDescription(); // Set initial description
      populateSavedPrompts(); // Populate saved prompts on modal open
    })
    .catch((err) =>
      console.error('EDRSR-AI: Failed to load prompt definitions module from content script.', err)
    );

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
    }
  });

  startButton.addEventListener('click', async () => {
    let prompt = templateSelect.value;
    if (prompt === 'custom') {
      prompt = document.getElementById('edrsr-custom-prompt').value.trim();
      if (!prompt) {
        showMessage(t('content.messages.customPromptEmpty'), 'warning');
        return;
      }
    }
    if (prompt === 'default') prompt = null;

    backdrop.remove();
    const uniqueOnly = !!document.getElementById('edrsr-unique-only')?.checked;
    const ignoreSessionVisited = !!document.getElementById('edrsr-ignore-session')?.checked;
    // Get a label from the selected option or snippet of custom prompt
    const selectedIndex = templateSelect.selectedIndex;
    const selectedOption = templateSelect.options[selectedIndex];
    const promptLabel =
      prompt && selectedOption && selectedOption.value !== 'custom'
        ? selectedOption.textContent
        : prompt
          ? prompt.split(/\s+/).slice(0, 6).join(' ')
          : null;
    // Try to read a saved preference from background settings if needed later; for now default to true
    const autoTitleEnabled = true;
    await collectAndSend({
      prompt,
      promptLabel,
      uniqueOnly,
      ignoreSessionVisited,
      autoTitleEnabled,
    });
  });
}

async function addCollectButton() {
  if (document.getElementById('edrsr-ai-collect-btn')) return;
  const { t } = await getI18n();
  const button = document.createElement('button');
  button.id = 'edrsr-ai-collect-btn';
  button.textContent = t('content.floatingButton');
  button.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 10000; padding: 12px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none;
        border-radius: 25px; font-size: 14px; font-weight: bold; cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2); transition: all 0.3s ease;
    `;
  button.addEventListener('mouseenter', () => (button.style.transform = 'translateY(-2px)'));
  button.addEventListener('mouseleave', () => (button.style.transform = 'translateY(0)'));
  button.addEventListener('click', () => {
    void createModal();
  });
  document.body.appendChild(button);
}

async function showCompletionButton(jobId) {
  removeCompletionButton();
  const { t } = await getI18n();
  const resultButton = document.createElement('a');
  resultButton.id = 'edrsr-ai-result-btn';
  resultButton.textContent = t('content.completionButton');
  resultButton.href = chrome.runtime.getURL(`results.html?jobId=${encodeURIComponent(jobId)}`);
  resultButton.target = '_blank';
  resultButton.style.cssText = `
        position: fixed; bottom: 80px; right: 20px; z-index: 10001; padding: 12px 20px;
        background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: #1a2a2a;
        border: none; border-radius: 25px; font-size: 14px; font-weight: bold; cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2); transition: all 0.3s ease; text-decoration: none;
    `;
  document.body.appendChild(resultButton);

  setTimeout(removeCompletionButton, 30000);
}

function removeCompletionButton() {
  const oldButton = document.getElementById('edrsr-ai-result-btn');
  if (oldButton) oldButton.remove();
}

// --- CORE LOGIC ---

async function markProcessedLinksAsVisited() {
  const links = getDecisionLinkElements();
  if (links.length === 0) return;

  const pageDecisions = links
    .map((link) => link.getAttribute('href'))
    .filter(Boolean)
    .map((href) => ({ url: 'https://reyestr.court.gov.ua' + href }));
  const processedUrls = new Set(await getProcessedUrls(pageDecisions));

  if (processedUrls.size === 0) return;

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    const fullUrl = 'https://reyestr.court.gov.ua' + href;
    if (!processedUrls.has(fullUrl)) return;

    link.style.color = '#551a8b';
    link.setAttribute('data-edrsr-processed', 'true');
  });

  if (!document.getElementById('edrsr-processed-links-style')) {
    const style = document.createElement('style');
    style.id = 'edrsr-processed-links-style';
    style.textContent = `
      a[data-edrsr-processed="true"]:visited,
      a[data-edrsr-processed="true"] {
        color: #551a8b !important;
      }
    `;
    document.head.appendChild(style);
  }
}

function collectDecisionLinks() {
  const decisions = [];
  const seen = new Set();
  const linkElements = getDecisionLinkElements();

  linkElements.forEach((linkElement) => {
    const href = linkElement.getAttribute('href');
    if (!href) return;
    const fullUrl = 'https://reyestr.court.gov.ua' + href;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const row = linkElement.closest('tr');
    if (row) {
      const dateElement = row.querySelector('td.RegDate');
      if (dateElement) {
        decisions.push({
          url: fullUrl,
          decisionDate: dateElement.textContent.trim(),
        });
        return;
      }
    }

    console.warn(`Не удалось найти дату для ссылки: ${fullUrl}`);
    decisions.push({
      url: fullUrl,
      decisionDate: null,
    });
  });
  console.log(`Найдено и будет отправлено ${decisions.length} ссылок. Содержимое:`, decisions);
  return decisions;
}

function showMessage(message, type = 'info') {
  let msgDiv = document.getElementById('edrsr-ai-message');
  if (msgDiv) msgDiv.remove();
  msgDiv = document.createElement('div');
  msgDiv.id = 'edrsr-ai-message';
  msgDiv.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10002; padding: 15px 20px; border-radius: 8px;
        font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: white;
        max-width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: opacity 0.3s ease; opacity: 1;
    `;
  const colors = { info: '#2196F3', success: '#4CAF50', warning: '#FF9800', error: '#F44336' };
  msgDiv.style.backgroundColor = colors[type] || colors.info;
  msgDiv.textContent = message;
  document.body.appendChild(msgDiv);
  setTimeout(() => {
    if (msgDiv) {
      msgDiv.style.opacity = '0';
      setTimeout(() => msgDiv.remove(), 300);
    }
  }, 5000);
}

async function getProcessedUrls(decisions) {
  const urls = Array.isArray(decisions)
    ? decisions
        .map((decision) => decision?.url)
        .filter((url) => typeof url === 'string' && url.length > 0)
    : [];

  if (urls.length === 0) {
    return [];
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'API_CHECK_PROCESSED',
      urls,
    });

    if (response?.success && Array.isArray(response.urls)) {
      return response.urls;
    }
  } catch (error) {
    console.warn('EDRSR-AI: Processed URL check skipped:', error);
  }

  return [];
}

async function collectAndSend(options) {
  if (isProcessing) {
    const { t } = await getI18n();
    showMessage(t('content.messages.previousInProgress'), 'warning');
    return;
  }
  isProcessing = true;
  removeCompletionButton();
  try {
    let decisions = collectDecisionLinks();
    if (decisions.length === 0) {
      const { t } = await getI18n();
      throw new Error(t('content.messages.noLinksFound'));
    }

    // Filter to only unique decisions for this user if requested
    if (options?.uniqueOnly) {
      const processedUrls = await getProcessedUrls(decisions);
      if (processedUrls.length > 0) {
        const processed = new Set(processedUrls);
        const before = decisions.length;
        decisions = decisions.filter((d) => d && d.url && !processed.has(d.url));
        const removed = before - decisions.length;
        if (decisions.length === 0) {
          const { t } = await getI18n();
          showMessage(t('content.messages.noUnique'), 'warning');
          return;
        }
        const { t } = await getI18n();
        showMessage(
          t('content.messages.filteredHistory', {
            before,
            removed,
            count: decisions.length,
          }),
          'info'
        );
      }
    }

    // Optionally ignore links already sent in this extension session
    if (options?.ignoreSessionVisited) {
      const sres = await chrome.runtime.sendMessage({ type: 'API_GET_SESSION_VISITED' });
      if (sres && sres.success && Array.isArray(sres.urls)) {
        const sessionSet = new Set(sres.urls);
        const before = decisions.length;
        decisions = decisions.filter((d) => d && d.url && !sessionSet.has(d.url));
        const removed = before - decisions.length;
        if (decisions.length === 0) {
          const { t } = await getI18n();
          showMessage(t('content.messages.noNewSession'), 'warning');
          return;
        }
        const { t } = await getI18n();
        showMessage(
          t('content.messages.filteredSession', { removed, count: decisions.length }),
          'info'
        );
      }
    }

    if (!options?.uniqueOnly && !options?.ignoreSessionVisited) {
      const { t } = await getI18n();
      showMessage(t('content.messages.foundLinks', { count: decisions.length }), 'info');
    }

    // Send job to service worker
    const tab = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' });

    const response = await chrome.runtime.sendMessage({
      type: 'START_JOB',
      payload: {
        links: decisions,
        cookie: '',
        prompt: options.prompt,
        promptLabel: options.promptLabel || null,
        autoTitleEnabled: options.autoTitleEnabled !== false,
        uniqueOnly: !!options?.uniqueOnly,
        ignoreSessionVisited: !!options?.ignoreSessionVisited,
        tabId: tab.id,
      },
    });

    if (!response || !response.success) {
      const { t } = await getI18n();
      throw new Error(response?.error || t('content.messages.createJobError'));
    }

    {
      const { t } = await getI18n();
      showMessage(t('content.messages.jobCreated'), 'success');
    }
    pageActiveJobId = response.jobId;
  } catch (error) {
    const { t } = await getI18n();
    showMessage(t('common.errorPrefix', { message: error.message }), 'error');
  } finally {
    isProcessing = false;
  }
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch {
      return false;
    }
  }
}

async function copyDecisionUrls(options) {
  try {
    let decisions = collectDecisionLinks();
    if (decisions.length === 0) {
      const { t } = await getI18n();
      showMessage(t('content.messages.noLinksFound'), 'warning');
      return;
    }

    if (options?.uniqueOnly) {
      const processedUrls = await getProcessedUrls(decisions);
      if (processedUrls.length > 0) {
        const processed = new Set(processedUrls);
        const before = decisions.length;
        decisions = decisions.filter((d) => d && d.url && !processed.has(d.url));
        const removed = before - decisions.length;
        if (decisions.length === 0) {
          const { t } = await getI18n();
          showMessage(t('content.messages.noUnique'), 'warning');
          return;
        }
        const { t } = await getI18n();
        showMessage(
          t('content.messages.filteredHistory', {
            before,
            removed,
            count: decisions.length,
          }),
          'info'
        );
      }
    }

    if (options?.ignoreSessionVisited) {
      const sres = await chrome.runtime.sendMessage({ type: 'API_GET_SESSION_VISITED' });
      if (sres && sres.success && Array.isArray(sres.urls)) {
        const sessionSet = new Set(sres.urls);
        const before = decisions.length;
        decisions = decisions.filter((d) => d && d.url && !sessionSet.has(d.url));
        const removed = before - decisions.length;
        if (decisions.length === 0) {
          const { t } = await getI18n();
          showMessage(t('content.messages.noNewSession'), 'warning');
          return;
        }
        const { t } = await getI18n();
        showMessage(
          t('content.messages.filteredSession', { removed, count: decisions.length }),
          'info'
        );
      }
    }

    const urls = decisions.map((d) => d.url).filter(Boolean);
    if (urls.length === 0) {
      const { t } = await getI18n();
      showMessage(t('content.messages.copyUrlsEmpty'), 'warning');
      return;
    }

    const ok = await copyTextToClipboard(urls.join('\n'));
    const { t } = await getI18n();
    if (!ok) {
      showMessage(t('content.messages.copyUrlsFailed'), 'error');
      return;
    }
    showMessage(t('content.messages.copyUrlsCopied', { count: urls.length }), 'success');
  } catch (error) {
    const { t } = await getI18n();
    showMessage(t('common.errorPrefix', { message: error.message }), 'error');
  }
}

// --- LISTENERS & INITIALIZATION ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_LINKS_COUNT') {
    const links = getDecisionLinkElements();
    sendResponse({ count: links.length });
    return true;
  }

  if (message.type === 'GET_DECISION_LINKS') {
    const decisions = collectDecisionLinks();
    sendResponse(decisions);
    return true;
  }

  if (message.type === 'GET_VERSION') {
    sendResponse(SCRIPT_VERSION);
    return true;
  }

  if (message.type === 'SET_TRACKING_JOB') {
    pageActiveJobId = message.payload.jobId;
    return true;
  }

  if (
    message.type === 'JOB_COMPLETED' &&
    pageActiveJobId &&
    message.payload.jobId === pageActiveJobId
  ) {
    void showCompletionButton(pageActiveJobId);
    pageActiveJobId = null; // Reset for the next job
    return true;
  }
});

function initialize() {
  if (hasDecisionLinks()) {
    void addCollectButton();
    void markProcessedLinksAsVisited();
  }
  const observer = new MutationObserver(() => {
    if (hasDecisionLinks() && !document.getElementById('edrsr-ai-collect-btn')) {
      void addCollectButton();
      void markProcessedLinksAsVisited();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'complete') {
  initialize();
} else {
  window.addEventListener('load', initialize);
}

console.log('🤖 EDRSR-AI Content Script v2.1 Loaded.');
