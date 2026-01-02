// Lightweight DTO validators (no extra deps)

const intFromEnv = (key, def) => {
  const v = parseInt(process.env[key] || '', 10);
  return Number.isFinite(v) ? v : def;
};

const LIMITS = {
  MAX_LINKS_PER_REQUEST: intFromEnv('MAX_LINKS_PER_REQUEST', 300),
  MAX_URL_LENGTH: intFromEnv('MAX_URL_LENGTH', 2048),
  MAX_PROMPT_LENGTH: intFromEnv('MAX_PROMPT_LENGTH', 4000),
  MAX_PROMPT_NAME_LENGTH: intFromEnv('MAX_PROMPT_NAME_LENGTH', 120),
  MAX_COOKIE_LENGTH: intFromEnv('MAX_COOKIE_LENGTH', 4096),
  MAX_CHAT_MESSAGE_LENGTH: intFromEnv('MAX_CHAT_MESSAGE_LENGTH', 4000),
  MAX_PROMPTS_IMPORT: intFromEnv('MAX_PROMPTS_IMPORT', 200),
};

const trimString = (value) => (typeof value === 'string' ? value.trim() : value);

export function validateCollectRequest(req, res, next) {
  try {
    const { links, cookie = '', prompt = null, clientId } = req.body || {};

    if (typeof clientId !== 'undefined' && typeof clientId !== 'string') {
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
  } catch {
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
  } catch {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
}

export function validatePromptCreate(req, res, next) {
  try {
    const { name, content } = req.body || {};
    const trimmedName = trimString(name);
    const trimmedContent = trimString(content);

    if (!trimmedName || !trimmedContent) {
      return res.status(400).json({ error: 'Название и текст промпта обязательны' });
    }
    if (trimmedName.length > LIMITS.MAX_PROMPT_NAME_LENGTH) {
      return res
        .status(422)
        .json({ error: `Название слишком длинное (> ${LIMITS.MAX_PROMPT_NAME_LENGTH})` });
    }
    if (trimmedContent.length > LIMITS.MAX_PROMPT_LENGTH) {
      return res.status(422).json({ error: 'Промпт слишком длинный' });
    }

    req.body.name = trimmedName;
    req.body.content = trimmedContent;
    return next();
  } catch {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
}

export function validatePromptUpdate(req, res, next) {
  try {
    const { name, content } = req.body || {};
    const hasName = typeof name !== 'undefined';
    const hasContent = typeof content !== 'undefined';
    if (!hasName && !hasContent) {
      return res.status(400).json({ error: 'Нечего обновлять' });
    }

    if (hasName) {
      const trimmedName = trimString(name);
      if (!trimmedName) {
        return res.status(400).json({ error: 'Название промпта не может быть пустым' });
      }
      if (trimmedName.length > LIMITS.MAX_PROMPT_NAME_LENGTH) {
        return res
          .status(422)
          .json({ error: `Название слишком длинное (> ${LIMITS.MAX_PROMPT_NAME_LENGTH})` });
      }
      req.body.name = trimmedName;
    }

    if (hasContent) {
      const trimmedContent = trimString(content);
      if (!trimmedContent) {
        return res.status(400).json({ error: 'Текст промпта не может быть пустым' });
      }
      if (trimmedContent.length > LIMITS.MAX_PROMPT_LENGTH) {
        return res.status(422).json({ error: 'Промпт слишком длинный' });
      }
      req.body.content = trimmedContent;
    }

    return next();
  } catch {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
}

export function validatePromptImport(req, res, next) {
  try {
    const { prompts } = req.body || {};
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: 'prompts должен быть непустым массивом' });
    }
    if (prompts.length > LIMITS.MAX_PROMPTS_IMPORT) {
      return res
        .status(422)
        .json({ error: `Слишком много промптов (>${LIMITS.MAX_PROMPTS_IMPORT})` });
    }

    const sanitized = prompts
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        name: trimString(p.name),
        content: trimString(p.content),
      }))
      .filter((p) => p.name && p.content)
      .filter(
        (p) =>
          p.name.length <= LIMITS.MAX_PROMPT_NAME_LENGTH &&
          p.content.length <= LIMITS.MAX_PROMPT_LENGTH
      );

    if (sanitized.length === 0) {
      return res.status(400).json({ error: 'Нет валидных промптов для импорта' });
    }

    req.body.prompts = sanitized;
    return next();
  } catch {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
}
