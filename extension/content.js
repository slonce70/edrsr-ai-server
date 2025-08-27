// --- EDRSR-AI Content Script v2.1 ---
// This script's only responsibility is to listen for a request from the popup
// to get the number of links on the page. All other logic has been moved to
// the popup and service worker for a more robust architecture.

const SCRIPT_VERSION = '2.2';
let isProcessing = false;
let pageActiveJobId = null;

// --- UI & MODAL LOGIC (Restored from v1.5) ---

function createModal() {
  if (document.getElementById('edrsr-ai-modal')) return;

  const modalHTML = `
    <div id="edrsr-ai-modal-backdrop" class="edrsr-ai-fade-in" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 99998; display: flex; align-items: center; justify-content: center; font-family: 'Segoe UI', 'Roboto', sans-serif;">
        <div id="edrsr-ai-modal-content" class="edrsr-ai-slide-in" style="background: #fcfcfc; padding: 25px; border-radius: 16px; width: 550px; max-width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.2); border: 1px solid #e0e0e0;">
            <h2 style="text-align: center; margin-top: 0; margin-bottom: 25px; color: #333; font-weight: 600;">⚖️ Настройки анализа ИИ</h2>
            
            <div style="margin-bottom: 20px;">
                <label for="edrsr-prompt-template" style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #555;">Выберите тип анализа:</label>
                <select id="edrsr-prompt-template" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 15px; background: #fff;">
                    <!-- Options populated by script -->
                </select>
                <p id="edrsr-prompt-description" style="font-size: 13px; color: #666; margin-top: 10px; min-height: 3em; padding: 8px; border-radius: 6px; background: #f0f0f0; border-left: 3px solid #667eea;"></p>
            </div>

            <div id="edrsr-custom-prompt-container" style="display: none; margin-bottom: 20px;">
                <label for="edrsr-custom-prompt" style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #555;">Ваш индивидуальный запрос:</label>
                <textarea id="edrsr-custom-prompt" rows="4" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 14px; resize: vertical;" placeholder="Например: 'Найди все упоминания о недвижимости и укажи её статус...'"></textarea>
                
                <div style="margin-top: 15px; display: flex; gap: 10px; align-items: flex-end;">
                  <div style="flex-grow: 1;">
                      <label for="edrsr-prompt-name" style="display: block; margin-bottom: 5px; font-weight: 500; font-size: 12px; color: #555;">Имя для сохранения:</label>
                      <input type="text" id="edrsr-prompt-name" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 13px;" placeholder="Короткое название промпта">
                  </div>
                  <button id="edrsr-save-prompt" style="padding: 8px 15px; border: none; background: #6c757d; color: white; border-radius: 6px; font-size: 13px; cursor: pointer;">Сохранить</button>
            </div>
            </div>

             <div style="margin-bottom: 20px;">
                <label for="edrsr-saved-prompts" style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #555;">Сохраненные промпты:</label>
                <div style="display: flex; gap: 10px;">
                    <select id="edrsr-saved-prompts" style="flex-grow: 1; width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 15px; background: #fff;">
                        <option value="">-- Выберите сохранённый --</option>
                    </select>
                    <button id="edrsr-delete-prompt" style="padding: 8px 12px; border: none; background: #dc3545; color: white; border-radius: 8px; font-size: 14px; cursor: pointer;" title="Удалить выбранный промпт">🗑️</button>
                </div>
            </div>
            
            <button id="edrsr-start-analysis" style="width: 100%; padding: 15px; border: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s ease;">🚀 Начать анализ</button>
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
  const customPromptTextarea = document.getElementById('edrsr-custom-prompt');
  const promptNameInput = document.getElementById('edrsr-prompt-name');
  const savePromptBtn = document.getElementById('edrsr-save-prompt');
  const savedPromptsSelect = document.getElementById('edrsr-saved-prompts');
  const deletePromptBtn = document.getElementById('edrsr-delete-prompt');

  // Add checkboxes next to the start button (simple, accessible)
  if (!document.getElementById('edrsr-unique-only')) {
    const uniqueWrap = document.createElement('div');
    uniqueWrap.style.cssText = 'margin:10px 0; display:flex; flex-direction:column; gap:8px;';
    uniqueWrap.innerHTML = `
      <div class="edrsr-checks">
        <label class="edrsr-check">
          <input id="edrsr-unique-only" type="checkbox" checked />
          <span class="edrsr-check-text">Только уникальные дела</span>
        </label>
        <label class="edrsr-check">
          <input id="edrsr-ignore-session" type="checkbox" />
          <span class="edrsr-check-text">Игнорировать в этой сессии</span>
        </label>
      </div>
    `;
    startButton.insertAdjacentElement('beforebegin', uniqueWrap);
  }

  // --- Prompt Management Functions ---
  const getSavedPrompts = async () => {
    try {
      const result = await chrome.storage.local.get(['savedPrompts']);
      return result.savedPrompts || [];
    } catch (e) {
      console.error('EDRSR-AI: Error getting saved prompts', e);
      return [];
    }
  };

  const populateSavedPrompts = async () => {
    const savedPrompts = await getSavedPrompts();
    savedPromptsSelect.innerHTML = '<option value="">-- Выберите сохранённый --</option>'; // Reset
    savedPrompts.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = p.name;
      savedPromptsSelect.appendChild(option);
    });
  };

  savePromptBtn.addEventListener('click', async () => {
    const name = promptNameInput.value.trim();
    const content = customPromptTextarea.value.trim();
    if (!name || !content) {
      showMessage('Название и текст промпта не могут быть пустыми.', 'warning');
      return;
    }
    const savedPrompts = await getSavedPrompts();
    // Remove if exists to overwrite
    const newPrompts = savedPrompts.filter((p) => p.name !== name);
    newPrompts.push({ name, content });
    await chrome.storage.local.set({ savedPrompts: newPrompts });
    promptNameInput.value = '';
    showMessage(`Промпт "${name}" сохранён!`, 'success');
    await populateSavedPrompts();
  });

  deletePromptBtn.addEventListener('click', async () => {
    const selectedName = savedPromptsSelect.value;
    if (!selectedName) {
      showMessage('Выберите промпт для удаления.', 'warning');
      return;
    }
    if (confirm(`Вы уверены, что хотите удалить промпт "${selectedName}"?`)) {
      const savedPrompts = await getSavedPrompts();
      const newPrompts = savedPrompts.filter((p) => p.name !== selectedName);
      await chrome.storage.local.set({ savedPrompts: newPrompts });
      showMessage(`Промпт "${selectedName}" удалён.`, 'success');
      await populateSavedPrompts();
    }
  });

  savedPromptsSelect.addEventListener('change', async () => {
    const selectedName = savedPromptsSelect.value;
    if (!selectedName) return;
    const savedPrompts = await getSavedPrompts();
    const selectedPrompt = savedPrompts.find((p) => p.name === selectedName);
    if (selectedPrompt) {
      templateSelect.value = 'custom'; // Switch to custom type
      customContainer.style.display = 'block';
      customPromptTextarea.value = selectedPrompt.content;
    }
  });

  // --- Populate prompts and handle descriptions ---
  // Use the shared module for consistency
  Promise.all([import(chrome.runtime.getURL('prompt-definitions.js'))])
    .then(([promptModule]) => {
      const { PROMPT_GROUPS, PROMPT_DESCRIPTIONS } = promptModule;

      for (const groupLabel in PROMPT_GROUPS) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupLabel;
        for (const key in PROMPT_GROUPS[groupLabel]) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = PROMPT_GROUPS[groupLabel][key];
          optgroup.appendChild(option);
        }
        templateSelect.appendChild(optgroup);
      }

      const descriptionP = document.getElementById('edrsr-prompt-description');
      const updateDescription = () => {
        const selectedValue = templateSelect.value;
        descriptionP.textContent = PROMPT_DESCRIPTIONS[selectedValue] || '';
        customContainer.style.display = selectedValue === 'custom' ? 'block' : 'none';
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
        showMessage('Собственный промпт не может быть пустым.', 'warning');
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

function addCollectButton() {
  if (document.getElementById('edrsr-ai-collect-btn')) return;
  const button = document.createElement('button');
  button.id = 'edrsr-ai-collect-btn';
  button.textContent = '🤖 Проанализировать с ИИ';
  button.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 10000; padding: 12px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none;
        border-radius: 25px; font-size: 14px; font-weight: bold; cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2); transition: all 0.3s ease;
    `;
  button.addEventListener('mouseenter', () => (button.style.transform = 'translateY(-2px)'));
  button.addEventListener('mouseleave', () => (button.style.transform = 'translateY(0)'));
  button.addEventListener('click', createModal);
  document.body.appendChild(button);
}

function showCompletionButton(jobId) {
  removeCompletionButton();
  const resultButton = document.createElement('a');
  resultButton.id = 'edrsr-ai-result-btn';
  resultButton.textContent = '✅ Анализ готов! Открыть отчёт';
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
  try {
    console.log('EDRSR-AI: Запитую список оброблених URL...');

    // Get API URL from background script
    const apiUrl = await chrome.runtime.sendMessage({ type: 'GET_API_URL' });

    // Получаем список обработанных URL с сервера через background (добавит Authorization)
    const response = await chrome.runtime.sendMessage({ type: 'API_GET_PROCESSED_URLS' });

    if (!response || response.success === false) {
      console.warn('EDRSR-AI: Не вдалося отримати оброблені URL:', response?.error);
      return;
    }

    const data = response;
    console.log('EDRSR-AI: Дані з сервера:', data);

    if (!data.success || !Array.isArray(data.urls)) {
      console.warn('EDRSR-AI: Невірний формат відповіді сервера:', data);
      return;
    }

    console.log(
      `EDRSR-AI: Знайдено ${data.urls.length} оброблених URL для візуального відображення`
    );

    // Создаем Set для быстрого поиска обработанных URL
    const processedUrls = new Set(data.urls);

    // Находим все ссылки на дела и отмечаем обработанные визуально
    const links = document.querySelectorAll('a.doc_text2[href^="/Review/"]');
    let markedCount = 0;

    links.forEach((link) => {
      const fullUrl = 'https://reyestr.court.gov.ua' + link.getAttribute('href');
      if (processedUrls.has(fullUrl)) {
        // Применяем стили посещенной ссылки без добавления в историю
        link.style.color = '#551a8b'; // Фиолетовый цвет посещенной ссылки
        link.setAttribute('data-edrsr-processed', 'true');
        markedCount++;
      }
    });

    // Добавляем CSS правило для всех обработанных ссылок
    if (!document.getElementById('edrsr-processed-links-style')) {
      const style = document.createElement('style');
      style.id = 'edrsr-processed-links-style';
      style.textContent = `
        a.doc_text2[data-edrsr-processed="true"]:visited,
        a.doc_text2[data-edrsr-processed="true"] {
          color: #551a8b !important;
        }
      `;
      document.head.appendChild(style);
    }

    console.log(
      `EDRSR-AI: Успішно позначено ${markedCount} із ${data.urls.length} оброблених посилань як відвідані`
    );
  } catch (error) {
    console.error('EDRSR-AI: Помилка отримання оброблених URL:', error);
  }
}

function collectDecisionLinks() {
  const decisions = [];
  // Находим все элементы с ссылками, которые нас интересуют
  const linkElements = document.querySelectorAll('td.RegNumber a.doc_text2[href^="/Review/"]');

  linkElements.forEach((linkElement) => {
    // Находим ближайшего родителя <tr> для каждой ссылки
    const row = linkElement.closest('tr');
    if (row) {
      // Ищем дату только внутри этой конкретной строки
      const dateElement = row.querySelector('td.RegDate');
      if (dateElement) {
        decisions.push({
          url: 'https://reyestr.court.gov.ua' + linkElement.getAttribute('href'),
          decisionDate: dateElement.textContent.trim(),
        });
      } else {
        // Если дату найти не удалось, все равно добавляем ссылку, чтобы не терять дела
        console.warn(`Не удалось найти дату для ссылки: ${linkElement.href}`);
        decisions.push({
          url: 'https://reyestr.court.gov.ua' + linkElement.getAttribute('href'),
          decisionDate: null, // Отправляем null, чтобы сервер знал, что даты нет
        });
      }
    }
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

async function collectAndSend(options) {
  if (isProcessing) {
    showMessage('⏳ Предыдущий запрос ещё выполняется.', 'warning');
    return;
  }
  isProcessing = true;
  removeCompletionButton();
  try {
    let decisions = collectDecisionLinks();
    if (decisions.length === 0) throw new Error('Не найдено ссылок на судебные решения.');

    // Filter to only unique decisions for this user if requested
    if (options?.uniqueOnly) {
      const res = await chrome.runtime.sendMessage({ type: 'API_GET_PROCESSED_URLS' });
      if (res && res.success && Array.isArray(res.urls)) {
        const processed = new Set(res.urls);
        const before = decisions.length;
        decisions = decisions.filter((d) => d && d.url && !processed.has(d.url));
        const removed = before - decisions.length;
        if (decisions.length === 0) {
          showMessage('На этой странице нет уникальных дел для анализа.', 'warning');
          return;
        }
        showMessage(`📤 Найдено ${before}. -${removed} (история) → ${decisions.length}.`, 'info');
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
          showMessage('В этой сессии нет новых дел для анализа.', 'warning');
          return;
        }
        showMessage(`📤 Фильтр сессии: -${removed} → ${decisions.length}.`, 'info');
      }
    }

    if (!options?.uniqueOnly && !options?.ignoreSessionVisited) {
      showMessage(`📤 Найдено ${decisions.length} ссылок. Отправляю на сервер...`, 'info');
    }

    const cookies = await chrome.runtime.sendMessage({ type: 'GET_COOKIES' });

    // Send job to service worker
    const tab = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' });

    const response = await chrome.runtime.sendMessage({
      type: 'START_JOB',
      payload: {
        links: decisions,
        cookie: cookies,
        prompt: options.prompt,
        promptLabel: options.promptLabel || null,
        autoTitleEnabled: options.autoTitleEnabled !== false,
        uniqueOnly: !!options?.uniqueOnly,
        ignoreSessionVisited: !!options?.ignoreSessionVisited,
        tabId: tab.id,
      },
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Ошибка при создании задания');
    }

    showMessage(`✅ Задание создано. Отслеживайте прогресс в расширении.`, 'success');
    pageActiveJobId = response.jobId;
  } catch (error) {
    showMessage(`❌ Ошибка: ${error.message}`, 'error');
  } finally {
    isProcessing = false;
  }
}

// --- LISTENERS & INITIALIZATION ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_LINKS_COUNT') {
    const links = document.querySelectorAll('a.doc_text2[href^="/Review/"]');
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
    showCompletionButton(pageActiveJobId);
    pageActiveJobId = null; // Reset for the next job
    return true;
  }
});

function initialize() {
  if (document.querySelector('a.doc_text2[href^="/Review/"]')) {
    addCollectButton();
    // Отмечаем обработанные ссылки как посещенные
    markProcessedLinksAsVisited();
  }
  const observer = new MutationObserver(() => {
    if (
      document.querySelector('a.doc_text2[href^="/Review/"]') &&
      !document.getElementById('edrsr-ai-collect-btn')
    ) {
      addCollectButton();
      // Отмечаем обработанные ссылки при динамическом добавлении контента
      markProcessedLinksAsVisited();
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
