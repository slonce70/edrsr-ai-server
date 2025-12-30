const sendMessage = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve(response);
    });
  });

export async function getPrompts({ force = false } = {}) {
  return await sendMessage({ type: 'PROMPTS_GET', force: !!force });
}

export async function savePrompt({ id = null, name, content }) {
  return await sendMessage({ type: 'PROMPTS_SAVE', payload: { id, name, content } });
}

export async function deletePrompt(id) {
  return await sendMessage({ type: 'PROMPTS_DELETE', payload: { id } });
}
