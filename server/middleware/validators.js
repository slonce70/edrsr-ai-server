// Lightweight DTO validators (no extra deps)

const intFromEnv = (key, def) => {
  const v = parseInt(process.env[key] || '', 10);
  return Number.isFinite(v) ? v : def;
};

const LIMITS = {
  MAX_LINKS_PER_REQUEST: intFromEnv('MAX_LINKS_PER_REQUEST', 300),
  MAX_URL_LENGTH: intFromEnv('MAX_URL_LENGTH', 2048),
  MAX_PROMPT_LENGTH: intFromEnv('MAX_PROMPT_LENGTH', 4000),
  MAX_COOKIE_LENGTH: intFromEnv('MAX_COOKIE_LENGTH', 4096),
  MAX_CHAT_MESSAGE_LENGTH: intFromEnv('MAX_CHAT_MESSAGE_LENGTH', 4000),
};

export function validateCollectRequest(req, res, next) {
  try {
    const { links, cookie = '', prompt = null, clientId } = req.body || {};

    if (!clientId || typeof clientId !== 'string') {
      return res.status(400).json({ error: 'Неверный clientId' });
    }
    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: 'Поле links должно быть непустым массивом' });
    }
    if (links.length > LIMITS.MAX_LINKS_PER_REQUEST) {
      return res
        .status(422)
        .json({ error: `Слишком много ссылок: максимум ${LIMITS.MAX_LINKS_PER_REQUEST}` });
    }
    if (typeof cookie === 'string' && cookie.length > LIMITS.MAX_COOKIE_LENGTH) {
      return res.status(422).json({ error: 'Cookie слишком длинное' });
    }
    if (prompt && typeof prompt === 'string' && prompt.length > LIMITS.MAX_PROMPT_LENGTH) {
      return res.status(422).json({ error: 'Prompt слишком длинный' });
    }

    // Validate link shapes quickly (url present and length reasonable)
    const malformed = links.find(
      (l) => !l || typeof l !== 'object' || typeof l.url !== 'string' || l.url.length === 0
    );
    if (malformed) {
      return res.status(422).json({ error: 'Некорректный формат элемента в links' });
    }
    const tooLong = links.find((l) => (l.url || '').length > LIMITS.MAX_URL_LENGTH);
    if (tooLong) {
      return res.status(422).json({ error: 'URL слишком длинный' });
    }

    return next();
  } catch (e) {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
}

export function validateChatMessage(req, res, next) {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Сообщение обязательно' });
    }
    if (message.length > LIMITS.MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(422).json({ error: 'Сообщение слишком длинное' });
    }
    return next();
  } catch (e) {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
}
