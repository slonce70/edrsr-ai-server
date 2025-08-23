const STATUS_TEXT_MAP = {
  queued: '⏳ В черзі',
  downloading: '📥 Завантаження',
  analyzing: '🤖 Аналіз',
  completed: '✅ Завершено',
  error: '❌ Помилка',
};

/**
 * Повертає форматований текст статусу для відображення.
 * @param {string} status - Системна назва статусу ('queued', 'downloading', etc.).
 * @param {number} [progress] - Прогрес у відсотках (опціонально).
 * @returns {string} - Текст для відображення.
 */
function getStatusDisplay(status, progress) {
  const baseText = STATUS_TEXT_MAP[status] || status;

  if ((status === 'downloading' || status === 'analyzing') && progress > 0) {
    return `${baseText} (${progress}%)`;
  }

  return baseText;
}

// This file is intended to contain shared utility functions
// for the extension, if any are needed in the future.
// Currently, all logic is well-contained within the popup,
// service worker, and content script.

console.log('EDRSR-AI Utils Loaded.');

function getPromptText(templateName, caseCount) {
  const prompts = {
    // ... (prompt definitions will be here)
  };
  return prompts[templateName] || prompts['default'];
}
