(() => {
  const STRINGS = {
    ru: {
      title: 'EDRSR-AI - Админская панель',
      nav: {
        dashboard: 'Дашборд',
        users: 'Пользователи',
        jobs: 'Задания',
        system: 'Система',
        audit: 'Аудит',
        security: 'Безопасность',
      },
      sidebar: {
        currentUserLoading: 'Загрузка...',
        adminLabel: 'Администратор',
        logout: 'Выйти',
      },
      header: {
        refresh: 'Обновить',
        language: 'Язык',
      },
      dashboard: {
        totalUsers: 'Всего пользователей',
        totalJobs: 'Всего заданий',
        completed: 'Завершено',
        failed: 'С ошибками',
        retryable: 'Можно повторить',
        memory: 'Память (МБ)',
        jobsToday: 'Задания за сегодня (Kyiv)',
        avgDuration: 'Среднее время выполнения',
        uptime: 'Время работы системы',
      },
      users: {
        searchPlaceholder: 'Поиск пользователей...',
        thEmail: 'Email',
        thRegistered: 'Дата регистрации',
        thLastLogin: 'Последний вход',
        thRoles: 'Роли',
        thActions: 'Действия',
        loading: 'Загрузка...',
        empty: 'Пользователи не найдены',
      },
      jobs: {
        statusAll: 'Все статусы',
        statusQueued: 'В очереди',
        statusRetrying: 'Повтор',
        statusProcessing: 'Обработка',
        statusCompleted: 'Завершено',
        statusError: 'Ошибка',
        emailFilterPlaceholder: 'Фильтр по email...',
        searchPlaceholder: 'Поиск заданий...',
        clearFilters: 'Очистить',
        searching: 'Поиск...',
        thTitle: 'Название',
        thEmail: 'Email',
        thStatus: 'Статус',
        thProgress: 'Прогресс',
        thLinks: 'Ссылок',
        thCreated: 'Создано',
        thActions: 'Действия',
        loading: 'Загрузка...',
        empty: 'Задания не найдены',
      },
      system: {
        cleanupTitle: 'Очистка данных',
        cleanupDesc: 'Удаление старых заданий и кеша для оптимизации производительности',
        cleanupOldJobs: 'Старые задания (90+ дней)',
        cleanupFailedJobs: 'Проваленные задания (7+ дней)',
        cleanupOldCache: 'Старый кеш (30+ дней)',
        recoveryTitle: 'Восстановление заданий',
        recoveryDesc: 'Автоматическое восстановление и повторный запуск проблемных заданий',
        recoverStuck: 'Восстановить зависшие сейчас',
        retryFailed: 'Retry всех failed заданий',
        viewErrorJobs: 'Просмотр заданий с ошибками',
        statsTitle: 'Статистика системы',
        loading: 'Загрузка...',
        statsMemory: ({ used, total }) => `Память: ${used} МБ используется / ${total} МБ выделено`,
        statsUptime: ({ value }) => `Время работы: ${value}`,
        statsNode: ({ value }) => `Node.js: ${value}`,
        statsPlatform: ({ value }) => `Платформа: ${value}`,
        statsDbTitle: 'Статистика базы данных:',
        statsRecords: ({ table, count }) => `${table}: ${count} записей`,
      },
      audit: {
        thTime: 'Время',
        thUser: 'Пользователь',
        thAction: 'Действие',
        thObject: 'Объект',
        thIp: 'IP адрес',
        loading: 'Загрузка...',
        empty: 'Логи аудита не найдены',
      },
      security: {
        title: 'Мониторинг безопасности',
        blockedTitle: 'Заблокированные IP/Аккаунты',
        blockedEmpty: 'Нет заблокированных адресов',
        attemptsTitle: 'Попытки взлома',
        attemptsEmpty: 'Нет подозрительной активности',
        refresh: 'Обновить статистику',
      },
      login: {
        title: 'Авторизация в админ панели',
        emailLabel: 'Email:',
        passwordLabel: 'Пароль:',
        submit: 'Войти',
        noAdmin: 'У вас нет прав администратора',
        authFailed: 'Authentication failed',
        accessFailed: 'Failed to access admin panel',
        verifyFailed: 'Failed to verify admin access',
      },
      common: {
        loading: 'Загрузка...',
        never: 'Никогда',
        you: 'Вы',
        delete: 'Удалить',
        report: 'Отчет',
        na: 'Н/Д',
        admin: 'Админ',
        user: 'Пользователь',
        errorLabel: 'Ошибка',
        hoursShort: 'ч',
        minutesShort: 'м',
        secondsShort: 'с',
        foundCount: ({ count }) => `Найдено: ${count}`,
        untitled: 'Без названия',
      },
      status: {
        pending: 'Ожидание',
        processing: 'Обработка',
        completed: 'Завершено',
        error: 'Ошибка',
        queued: 'В очереди',
        retrying: 'Повтор',
        analyzing: 'Анализ',
      },
      actions: {
        makeAdmin: 'Сделать админом',
        revokeAdmin: 'Отозвать права',
        retryJob: 'Перезапустить задание',
        retryShort: 'Повтор',
        editTitlePrompt: 'Введите новое название задания:',
      },
      messages: {
        loadError: ({ message }) => `Ошибка загрузки данных: ${message}`,
        securityLoadError: ({ message }) => `Ошибка загрузки статистики безопасности: ${message}`,
        adminGranted: 'Права администратора предоставлены',
        adminRevoked: 'Права администратора отозваны',
        adminGrantError: ({ message }) => `Ошибка предоставления прав: ${message}`,
        adminRevokeError: ({ message }) => `Ошибка отзыва прав: ${message}`,
        userDeleted: 'Пользователь удален',
        userDeleteError: ({ message }) => `Ошибка удаления пользователя: ${message}`,
        jobDeleted: 'Задание удалено',
        jobDeleteError: ({ message }) => `Ошибка удаления задания: ${message}`,
        jobRetryQueued: ({ message }) => message || 'Задание поставлено на повторное выполнение',
        jobRetryError: ({ message }) => `Ошибка перезапуска задания: ${message}`,
        jobTitleUpdated: 'Название задания обновлено',
        jobTitleError: ({ message }) => `Ошибка обновления названия: ${message}`,
        cleanupSuccess: ({ count }) => `Очистка выполнена. Удалено: ${count}`,
        cleanupError: ({ message }) => `Ошибка очистки: ${message}`,
        retryAllError: ({ message }) => `Ошибка массового перезапуска: ${message}`,
        retryAllSuccess: ({ count }) => `Перезапущено ${count} заданий`,
        recoverSuccess: ({ count }) => `Восстановлено ${count} заданий`,
        recoverError: ({ message }) => `Ошибка восстановления: ${message}`,
        errorJobsEmpty: 'Заданий с ошибками не найдено!',
        errorJobsFound: ({ count }) => `Найдено ${count} заданий с ошибками`,
        errorJobsLoadError: ({ message }) => `Ошибка загрузки заданий с ошибками: ${message}`,
        sessionExpired: 'Сессия истекла. Пожалуйста, войдите снова.',
        reportIdMissing: 'ID задания не найден в URL',
        reportLoadError: ({ message }) => `Ошибка загрузки отчета: ${message}`,
        reportCopySuccess: 'Отчет скопирован в буфер обмена',
        reportDownloadSuccess: 'Отчет загружен',
      },
      confirm: {
        grantAdmin: 'Предоставить права администратора этому пользователю?',
        revokeAdmin: 'Отозвать права администратора у этого пользователя?',
        deleteUser: ({ email }) =>
          `Удалить пользователя ${email}? Это действие нельзя отменить и удалит все данные пользователя.`,
        deleteJob: 'Удалить это задание? Это действие нельзя отменить.',
        retryJob:
          'Перезапустить это задание? Оно будет поставлено в очередь на повторное выполнение.',
        cleanupOldJobs: 'Удалить все задания старше 90 дней?',
        cleanupFailedJobs: 'Удалить все проваленные задания старше 7 дней?',
        cleanupOldCache: 'Очистить кеш старше 30 дней?',
        retryAllFailed:
          'Перезапустить все задания с временными ошибками? Они будут поставлены в очередь на повторное выполнение.',
        recoverStuck: 'Восстановить зависшие задания (без ожидания lease)?',
      },
      securityReasons: {
        reason: ({ reason }) => `Причина: ${reason}`,
        emailAttempts: 'Много попыток входа',
        ipSuspicious: 'Подозрительная активность IP',
        remainingTime: ({ minutes }) => `Осталось времени: ${minutes} мин`,
        attemptsCount: ({ count }) => `Попыток: ${count}`,
        lastAttempt: ({ time }) => `Последняя: ${time}`,
      },
      report: {
        title: 'Звіт за завданням',
        reportTitle: 'Звіт',
        metadataTitle: 'Інформація про завдання',
        metadataId: 'ID',
        metadataStatus: 'Статус',
        metadataCreated: 'Створено',
        metadataUpdated: 'Оновлено',
        metadataLinks: 'Посилань оброблено',
        na: 'Н/Д',
        status: {
          pending: 'Очікування',
          processing: 'Обробка',
          completed: 'Завершено',
          error: 'Помилка',
          queued: 'У черзі',
          retrying: 'Повтор',
          analyzing: 'Аналіз',
        },
      },
      reportPage: {
        title: 'Отчет по заданию - EDRSR-AI Admin',
        backToAdmin: 'Назад к админке',
        loadingTitle: 'Загрузка отчета...',
        loadingBody: 'Загрузка отчета...',
        copyBtn: 'Копировать отчет',
        downloadBtn: 'Скачать TXT',
        printBtn: 'Печать',
      },
    },
    uk: {
      title: 'EDRSR-AI - Адмін панель',
      nav: {
        dashboard: 'Дашборд',
        users: 'Користувачі',
        jobs: 'Завдання',
        system: 'Система',
        audit: 'Аудит',
        security: 'Безпека',
      },
      sidebar: {
        currentUserLoading: 'Завантаження...',
        adminLabel: 'Адміністратор',
        logout: 'Вийти',
      },
      header: {
        refresh: 'Оновити',
        language: 'Мова',
      },
      dashboard: {
        totalUsers: 'Всього користувачів',
        totalJobs: 'Всього завдань',
        completed: 'Завершено',
        failed: 'З помилками',
        retryable: 'Можна повторити',
        memory: 'Пам’ять (МБ)',
        jobsToday: 'Завдання за сьогодні (Kyiv)',
        avgDuration: 'Середній час виконання',
        uptime: 'Час роботи системи',
      },
      users: {
        searchPlaceholder: 'Пошук користувачів...',
        thEmail: 'Email',
        thRegistered: 'Дата реєстрації',
        thLastLogin: 'Останній вхід',
        thRoles: 'Ролі',
        thActions: 'Дії',
        loading: 'Завантаження...',
        empty: 'Користувачів не знайдено',
      },
      jobs: {
        statusAll: 'Всі статуси',
        statusQueued: 'У черзі',
        statusRetrying: 'Повтор',
        statusProcessing: 'Обробка',
        statusCompleted: 'Завершено',
        statusError: 'Помилка',
        emailFilterPlaceholder: 'Фільтр за email...',
        searchPlaceholder: 'Пошук завдань...',
        clearFilters: 'Очистити',
        searching: 'Пошук...',
        thTitle: 'Назва',
        thEmail: 'Email',
        thStatus: 'Статус',
        thProgress: 'Прогрес',
        thLinks: 'Посилань',
        thCreated: 'Створено',
        thActions: 'Дії',
        loading: 'Завантаження...',
        empty: 'Завдань не знайдено',
      },
      system: {
        cleanupTitle: 'Очищення даних',
        cleanupDesc: 'Видалення старих завдань і кешу для оптимізації продуктивності',
        cleanupOldJobs: 'Старі завдання (90+ днів)',
        cleanupFailedJobs: 'Провалені завдання (7+ днів)',
        cleanupOldCache: 'Старий кеш (30+ днів)',
        recoveryTitle: 'Відновлення завдань',
        recoveryDesc: 'Автоматичне відновлення та повторний запуск проблемних завдань',
        recoverStuck: 'Відновити завислі зараз',
        retryFailed: 'Retry всіх failed завдань',
        viewErrorJobs: 'Перегляд завдань з помилками',
        statsTitle: 'Статистика системи',
        loading: 'Завантаження...',
        statsMemory: ({ used, total }) => `Пам’ять: ${used} МБ використано / ${total} МБ виділено`,
        statsUptime: ({ value }) => `Час роботи: ${value}`,
        statsNode: ({ value }) => `Node.js: ${value}`,
        statsPlatform: ({ value }) => `Платформа: ${value}`,
        statsDbTitle: 'Статистика бази даних:',
        statsRecords: ({ table, count }) => `${table}: ${count} записів`,
      },
      audit: {
        thTime: 'Час',
        thUser: 'Користувач',
        thAction: 'Дія',
        thObject: 'Об’єкт',
        thIp: 'IP адреса',
        loading: 'Завантаження...',
        empty: 'Логи аудиту не знайдено',
      },
      security: {
        title: 'Моніторинг безпеки',
        blockedTitle: 'Заблоковані IP/Акаунти',
        blockedEmpty: 'Немає заблокованих адрес',
        attemptsTitle: 'Спроби зламу',
        attemptsEmpty: 'Немає підозрілої активності',
        refresh: 'Оновити статистику',
      },
      login: {
        title: 'Авторизація в адмін панелі',
        emailLabel: 'Email:',
        passwordLabel: 'Пароль:',
        submit: 'Увійти',
        noAdmin: 'У вас немає прав адміністратора',
        authFailed: 'Authentication failed',
        accessFailed: 'Failed to access admin panel',
        verifyFailed: 'Failed to verify admin access',
      },
      common: {
        loading: 'Завантаження...',
        never: 'Ніколи',
        you: 'Ви',
        delete: 'Видалити',
        report: 'Звіт',
        na: 'Н/Д',
        admin: 'Адмін',
        user: 'Користувач',
        errorLabel: 'Помилка',
        hoursShort: 'год',
        minutesShort: 'хв',
        secondsShort: 'с',
        foundCount: ({ count }) => `Знайдено: ${count}`,
        untitled: 'Без назви',
      },
      status: {
        pending: 'Очікування',
        processing: 'Обробка',
        completed: 'Завершено',
        error: 'Помилка',
        queued: 'У черзі',
        retrying: 'Повтор',
        analyzing: 'Аналіз',
      },
      actions: {
        makeAdmin: 'Зробити адміном',
        revokeAdmin: 'Відкликати права',
        retryJob: 'Перезапустити завдання',
        retryShort: 'Повтор',
        editTitlePrompt: 'Введіть нову назву завдання:',
      },
      messages: {
        loadError: ({ message }) => `Помилка завантаження даних: ${message}`,
        securityLoadError: ({ message }) => `Помилка завантаження статистики безпеки: ${message}`,
        adminGranted: 'Права адміністратора надано',
        adminRevoked: 'Права адміністратора відкликано',
        adminGrantError: ({ message }) => `Помилка надання прав: ${message}`,
        adminRevokeError: ({ message }) => `Помилка відкликання прав: ${message}`,
        userDeleted: 'Користувача видалено',
        userDeleteError: ({ message }) => `Помилка видалення користувача: ${message}`,
        jobDeleted: 'Завдання видалено',
        jobDeleteError: ({ message }) => `Помилка видалення завдання: ${message}`,
        jobRetryQueued: ({ message }) => message || 'Завдання поставлено на повторне виконання',
        jobRetryError: ({ message }) => `Помилка перезапуску завдання: ${message}`,
        jobTitleUpdated: 'Назву завдання оновлено',
        jobTitleError: ({ message }) => `Помилка оновлення назви: ${message}`,
        cleanupSuccess: ({ count }) => `Очищення виконано. Видалено: ${count}`,
        cleanupError: ({ message }) => `Помилка очищення: ${message}`,
        retryAllError: ({ message }) => `Помилка масового перезапуску: ${message}`,
        retryAllSuccess: ({ count }) => `Перезапущено ${count} завдань`,
        recoverSuccess: ({ count }) => `Відновлено ${count} завдань`,
        recoverError: ({ message }) => `Помилка відновлення: ${message}`,
        errorJobsEmpty: 'Завдань з помилками не знайдено!',
        errorJobsFound: ({ count }) => `Знайдено ${count} завдань з помилками`,
        errorJobsLoadError: ({ message }) => `Помилка завантаження завдань з помилками: ${message}`,
        sessionExpired: 'Сесія закінчилася. Будь ласка, увійдіть знову.',
        reportIdMissing: 'ID завдання не знайдено в URL',
        reportLoadError: ({ message }) => `Помилка завантаження звіту: ${message}`,
        reportCopySuccess: 'Звіт скопійовано до буфера обміну',
        reportDownloadSuccess: 'Звіт завантажено',
      },
      confirm: {
        grantAdmin: 'Надати права адміністратора цьому користувачу?',
        revokeAdmin: 'Відкликати права адміністратора у цього користувача?',
        deleteUser: ({ email }) =>
          `Видалити користувача ${email}? Цю дію не можна скасувати і вона видалить усі дані користувача.`,
        deleteJob: 'Видалити це завдання? Цю дію не можна скасувати.',
        retryJob: 'Перезапустити це завдання? Воно буде поставлено в чергу на повторне виконання.',
        cleanupOldJobs: 'Видалити всі завдання старші за 90 днів?',
        cleanupFailedJobs: 'Видалити всі провалені завдання старші за 7 днів?',
        cleanupOldCache: 'Очистити кеш старший за 30 днів?',
        retryAllFailed:
          'Перезапустити всі завдання з тимчасовими помилками? Вони будуть поставлені в чергу на повторне виконання.',
        recoverStuck: 'Відновити завислі завдання (без очікування lease)?',
      },
      securityReasons: {
        reason: ({ reason }) => `Причина: ${reason}`,
        emailAttempts: 'Багато спроб входу',
        ipSuspicious: 'Підозріла активність IP',
        remainingTime: ({ minutes }) => `Залишилось часу: ${minutes} хв`,
        attemptsCount: ({ count }) => `Спроб: ${count}`,
        lastAttempt: ({ time }) => `Остання: ${time}`,
      },
      report: {
        title: 'Звіт за завданням',
        reportTitle: 'Звіт',
        metadataTitle: 'Інформація про завдання',
        metadataId: 'ID',
        metadataStatus: 'Статус',
        metadataCreated: 'Створено',
        metadataUpdated: 'Оновлено',
        metadataLinks: 'Посилань оброблено',
        na: 'Н/Д',
        status: {
          pending: 'Очікування',
          processing: 'Обробка',
          completed: 'Завершено',
          error: 'Помилка',
          queued: 'У черзі',
          retrying: 'Повтор',
          analyzing: 'Аналіз',
        },
      },
      reportPage: {
        title: 'Звіт за завданням - EDRSR-AI Admin',
        backToAdmin: 'Назад до адмінки',
        loadingTitle: 'Завантаження звіту...',
        loadingBody: 'Завантаження звіту...',
        copyBtn: 'Скопіювати звіт',
        downloadBtn: 'Завантажити TXT',
        printBtn: 'Друк',
      },
    },
  };

  const SUPPORTED = ['ru', 'uk'];
  let currentLocale = null;

  function detectLocale() {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('uk')) return 'uk';
    if (lang.startsWith('ru')) return 'ru';
    return 'uk';
  }

  function getLocale() {
    if (currentLocale) return currentLocale;
    const stored = localStorage.getItem('admin_locale');
    if (stored && SUPPORTED.includes(stored)) {
      currentLocale = stored;
      return currentLocale;
    }
    currentLocale = detectLocale();
    return currentLocale;
  }

  function setLocale(locale) {
    const next = SUPPORTED.includes(locale) ? locale : detectLocale();
    currentLocale = next;
    localStorage.setItem('admin_locale', next);
    applyTranslations(document);
    return next;
  }

  function getByPath(obj, path) {
    return path
      .split('.')
      .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
  }

  function t(key, vars = {}) {
    const locale = getLocale();
    const bundle = STRINGS[locale] || STRINGS.uk;
    let value = getByPath(bundle, key);
    if (value === null || value === undefined) value = getByPath(STRINGS.uk, key);
    if (typeof value === 'function') return value(vars);
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  }

  function applyTranslations(root = document) {
    const locale = getLocale();
    if (root.documentElement) root.documentElement.lang = locale === 'ru' ? 'ru' : 'uk';
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      if (el.tagName === 'TITLE') {
        document.title = t(key);
      } else {
        el.textContent = t(key);
      }
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      el.setAttribute('placeholder', t(key));
    });
  }

  function formatDate(dateString) {
    try {
      const locale = getLocale() === 'ru' ? 'ru-RU' : 'uk-UA';
      return new Date(dateString).toLocaleDateString(locale);
    } catch {
      return dateString;
    }
  }

  function formatDateTime(dateString) {
    try {
      const locale = getLocale() === 'ru' ? 'ru-RU' : 'uk-UA';
      return new Date(dateString).toLocaleString(locale);
    } catch {
      return dateString;
    }
  }

  window.AdminI18n = {
    t,
    applyTranslations,
    getLocale,
    setLocale,
    formatDate,
    formatDateTime,
  };
})();
