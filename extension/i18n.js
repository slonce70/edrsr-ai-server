const STRINGS = {
  ru: {
    common: {
      loading: 'Загрузка...',
      errorPrefix: ({ message }) => `Ошибка: ${message}`,
      warningPrefix: ({ message }) => `Предупреждение: ${message}`,
      errorLabel: 'Ошибка',
      ok: 'ОК',
      na: 'Н/Д',
      hoursShort: 'ч',
      minutesShort: 'м',
      secondsShort: 'с',
    },
    status: {
      queued: '⏳ В очереди',
      pending: '⏳ В очереди',
      downloading: '📥 Загрузка',
      download: '📥 Загрузка',
      processing: '🔄 Обработка',
      retrying: '🔁 Повтор',
      warning: '⚠️ Предупреждение',
      analyzing: '🤖 Анализ',
      completed: '✅ Завершено',
      error: '❌ Ошибка',
    },
    popup: {
      headerTitle: '🤖 ЄДРСР → Gemini AI',
      headerSubtitle: 'Анализ судебных решений с помощью искусственного интеллекта',
      authBadgeGuest: 'Гость',
      serverChecking: 'Проверяю сервер...',
      tabs: {
        collect: '📥 Сбор',
        status: '📊 Статус',
        results: '📋 Результаты',
        history: '🗂️ История',
        auth: '🔐 Вход',
      },
      collect: {
        currentPageLabel: 'Текущая страница:',
        linksFoundLabel: 'Найдено ссылок:',
        uniqueHistoryLabel: 'Уникальные (по истории):',
        uniqueSessionLabel: 'С учетом сессии:',
        promptTemplateLabel: 'Шаблон анализа:',
        uniqueOnlyLabel: 'Только уникальные дела',
        ignoreSessionLabel: 'Игнорировать в этой сессии',
        autoTitleLabel: 'Автообновление заголовка задания',
        customPromptLabel: 'Ваш промпт для ИИ:',
        customPromptPlaceholder: "Например: 'Найди все упоминания об экспертизах...'",
        promptNameLabel: 'Имя для сохранения:',
        promptNamePlaceholder: 'Название промпта',
        savePromptBtn: 'Сохранить',
        updatePromptBtn: 'Обновить',
        savedPromptsLabel: 'Сохраненные промпты',
        deletePromptBtn: '🗑️ Удалить выбранный промпт',
        collectBtn: '🔍 Собрать и проанализировать',
        collectBtnWithCount: ({ count }) => `🔍 Собрать и проанализировать (${count})`,
        collectBtnDeferred: '🔍 Проверить и проанализировать',
        copyUrlsBtn: '📋 Скопировать ссылки',
        copyUrlsBtnWithCount: ({ count }) => `📋 Скопировать ссылки (${count})`,
        copyUrlsBtnDeferred: '📋 Проверить и скопировать ссылки',
        countDeferred: 'Проверка при запуске',
        historyCountHint: 'Точное количество по истории будет проверено только после запуска.',
      },
      statusTab: {
        jobIdLabel: 'ID задания:',
        jobIdPlaceholder: 'Введите ID задания',
        checkStatusBtn: '📊 Проверить статус',
        loadLastBtn: '🔄 Последнее задание',
        retryBtn: '🔄 Перезапустить задание',
        forceRetryBtn: '⚠️ Принудительно перезапустить',
        statusLabel: 'Статус:',
        progressLabel: 'Прогресс:',
        linksLabel: 'Ссылок:',
        createdLabel: 'Время создания:',
      },
      resultsTab: {
        openNew: '🚀 Открыть в новом окне',
        showResult: '📋 Показать результат',
        copyResult: '📋 Копировать',
      },
      historyTab: {
        loading: 'Загрузка истории...',
        empty: 'История пуста',
      },
      auth: {
        emailLabel: 'Email',
        emailPlaceholder: 'you@example.com',
        passwordLabel: 'Пароль',
        passwordPlaceholder: '••••••••',
        showPwd: 'Показать',
        hidePwd: 'Скрыть',
        loginBtn: '🔐 Войти',
        signupBtn: '🆕 Регистрация',
        recoverBtn: '🔁 Забыли пароль?',
        logoutBtn: '🚪 Выйти',
      },
      footer: ({ version, apiHost }) => `Версия ${version || '—'} | API: ${apiHost || '—'}`,
      messages: {
        authRequired: 'Требуется вход. Пожалуйста, войдите.',
        serverConnected: 'Подключено',
        serverDisconnected: 'Отключено',
        serverReconnecting: 'Переподключение...',
        serverConnectionError: 'Ошибка соединения',
        stuckStatus: '⚠️ Зависло (можно перезапустить)',
        analyzingFallback: '🤖 Анализ',
        completed: '✅ Завершено',
        error: '❌ Ошибка',
        jobTitleFallback: ({ id }) => `Задание ${id}...`,
        jobIdTitleFallback: ({ id }) => `ID: ${id}...`,
        editTitle: 'Редактировать название',
        deleteTitle: 'Удалить задание',
        editPlaceholder: 'Введите новое название',
        confirmDeleteJob: ({ title }) =>
          `Вы уверены, что хотите удалить задание "${title}"? Это действие нельзя отменить.`,
        currentPageOk: 'ЄДРСР ✓',
        currentPageNo: 'Не страница ЄДРСР',
        errorNoLinks: 'На странице не найдено ссылок на дела. Возможно, нужно обновить страницу.',
        errorNoUnique: 'На этой странице нет уникальных дел для анализа.',
        errorNoNewSession: 'В этой сессии нет новых дел для анализа.',
        promptLabelCustom: 'Пользовательский',
        promptEmpty: 'Промпт не может быть пустым.',
        promptSaveEmpty: 'Название и текст промпта не могут быть пустыми.',
        promptSaved: ({ name }) => `Промпт "${name}" сохранён!`,
        promptSavedAs: ({ name }) => `Промпт сохранён как "${name}"!`,
        promptUpdated: ({ name }) => `Промпт "${name}" обновлён!`,
        promptDeleteSelect: 'Пожалуйста, выберите сохранённый промпт для удаления.',
        promptDeleteConfirm: ({ name }) => `Вы уверены, что хотите удалить промпт "${name}"?`,
        promptDeleted: ({ name }) => `Промпт "${name}" удалён.`,
        promptSavedDescription: ({ text }) => `Ваш сохранённый промпт: "${text}..."`,
        promptAuthRequired: 'Для сохранения промптов нужен вход.',
        promptUnnamed: 'Без названия',
        authLoginRequired: 'Укажите email и пароль',
        authSigningIn: 'Вход...',
        authSignedIn: 'Успешный вход.',
        authSignedUp: 'Аккаунт создан и выполнен вход.',
        authSignedUpConfirm: 'Аккаунт создан. Подтвердите почту по ссылке в письме, затем войдите.',
        authLoggedOut: 'Вы вышли.',
        authRecoverPrompt: 'Укажите email для восстановления пароля.',
        authRecoverSending: 'Отправляю письмо для восстановления...',
        authRecoverSent: 'Письмо для восстановления пароля отправлено. Проверьте почту.',
        authRecoverFailed: 'Не удалось отправить письмо для восстановления.',
        authError: ({ message }) => `Ошибка: ${message}`,
        authStatusAuthed: ({ email, id }) =>
          `Вы вошли как ${email || 'пользователь'}${id ? ` (ID: ${id})` : ''}`,
        authStatusGuest: 'Вы не вошли.',
        authBadgeAuthed: ({ email }) => `🔐 ${email || 'Вошли'}`,
        authBadgeGuest: 'Гость',
        retryStuckConfirm:
          'Это задание зависло. Перезапустить его? Будет создано новое задание с теми же параметрами.',
        retryConfirm:
          'Перезапустить это задание? Будет создано новое задание с теми же параметрами.',
        retryStuckButton: '🔄 Перезапустить зависшее',
        forceRetryConfirm:
          'ВНИМАНИЕ! Принудительно перезапустить активное задание? Текущий прогресс будет потерян, и будет создано новое задание.',
        copyResultCopied: '✅ Скопировано!',
        copyResult: '📋 Копировать',
        copyUrlsCopied: ({ count }) => `✅ Скопировано: ${count}`,
        copyUrlsEmpty: 'Нет ссылок для копирования.',
        copyUrlsFailed: 'Не удалось скопировать ссылки.',
      },
    },
    results: {
      pageTitle: 'Результаты анализа — EDRSR AI',
      metadataTitle: 'Метаданные задания',
      copyReportBtn: '📋 Копировать отчёт',
      pdfBtnReady: '📄 Скачать отчёт',
      pdfBtnLoading: '⏳ Загрузка библиотек...',
      pdfTypeText: '📄 Текстовый файл (TXT, небольшой размер)',
      pdfTypeRich: '📄 PDF (текст, кликабельные ссылки)',
      pdfTypeImage: '🖼️ PDF (изображение, точное оформление)',
      downloadCasesBtn: '📄 Скачать дела',
      analysisLoading: 'Получение данных от сервис-воркера...',
      analysisPending: 'Анализ ещё не завершён...',
      errorNoJobId: 'Ошибка: ID задания не найден.',
      statusLoading: 'Загрузка...',
      retryBtn: '↻ Повторить попытку',
      errorUnknown: 'Неизвестная ошибка',
      chatTitle: '💬 Чат с результатами анализа',
      chatThinking: 'ИИ думает...',
      chatPlaceholder: 'Задайте уточняющий вопрос...',
      chatSend: 'Отправить',
      chatRoleUser: 'Вы:',
      chatRoleAi: 'AI:',
      chatRoleUserShort: 'Вы:',
      chatRoleAiShort: 'AI:',
      userPromptHeading: 'Пользовательский запрос',
      retryingJob: 'Повторная попытка задания...',
      copyReportCopied: '✅ Скопировано!',
      copyReport: '📋 Копировать отчёт',
      generateTxt: 'Генерация TXT...',
      generatePdf: 'Генерация PDF...',
      generatePdfImage: 'Генерация PDF (изображение)...',
      txtError: 'Не удалось создать текстовый отчёт. Проверьте консоль для деталей.',
      pdfError: 'Не удалось создать PDF. Проверьте консоль для деталей.',
      imagePdfError: 'Не удалось создать PDF изображение. Проверьте консоль для деталей.',
      linksLoadError: 'Ошибка загрузки контента дел',
      statusLabel: 'Статус',
      createdLabel: 'Создано',
      totalLinksLabel: 'Всего ссылок',
      processedLinksLabel: 'Обработано',
      durationLabel: 'Длительность',
      statusBadge: ({ status }) => status,
      jobTitleFallback: ({ id }) => `Задание ${id}...`,
      editTitle: 'Редактировать название',
    },
    report: {
      metadataHeading: 'МЕТАДАНІ',
      userPromptHeading: 'КОРИСТУВАЦЬКИЙ ЗАПИТ',
      analysisHeading: 'РЕЗУЛЬТАТИ АНАЛІЗУ',
      analysisTitle: 'Звіт аналізу завдання',
      pageOf: ({ page, total }) => `Стор. ${page} з ${total}`,
      casesReportTitle: 'ЗВІТ ПО СПРАВАХ',
      caseLabel: 'СПРАВА',
      jobIdLabel: 'ID завдання',
      createdLabel: 'Дата створення',
    },
    notifications: {
      analysisCompleteTitle: '🎉 Анализ завершён!',
      analysisCompleteMessage: ({ id }) => `Задание ${id}... успешно завершено.`,
      analysisErrorTitle: '❌ Ошибка анализа',
      analysisErrorMessage: ({ id }) => `Задание ${id}... завершилось с ошибкой.`,
    },
    bg: {
      authRequired: 'Требуется вход. Откройте попап расширения и выполните вход.',
      contentScriptOutdated:
        'Версия скрипта на странице устарела. Пожалуйста, полностью обновите страницу (Ctrl+F5) и попробуйте снова.',
      noLinksForFilters: 'Нет дел для отправки на анализ с выбранными фильтрами.',
      fetchStatusError: ({ message }) => `Не удалось загрузить статус задания: ${message}`,
      fetchJobError: ({ message }) => `Не удалось загрузить данные задания: ${message}`,
      updateTitleError: ({ message }) => `Не удалось обновить название: ${message}`,
    },
    content: {
      modalTitle: '⚖️ Настройки анализа ИИ',
      selectAnalysisLabel: 'Выберите тип анализа:',
      customPromptLabel: 'Ваш индивидуальный запрос:',
      customPromptPlaceholder:
        "Например: 'Найди все упоминания о недвижимости и укажи её статус...'",
      promptNameLabel: 'Имя для сохранения:',
      promptNamePlaceholder: 'Короткое название промпта',
      savePromptBtn: 'Сохранить',
      savedPromptsLabel: 'Сохраненные промпты:',
      savedPromptsDefault: '-- Выберите сохранённый --',
      deletePromptTitle: 'Удалить выбранный промпт',
      startAnalysisBtn: '🚀 Начать анализ',
      copyUrlsBtn: '📋 Скопировать ссылки',
      uniqueOnlyLabel: 'Только уникальные дела',
      ignoreSessionLabel: 'Игнорировать в этой сессии',
      floatingButton: '🤖 Проанализировать с ИИ',
      completionButton: '✅ Анализ готов! Открыть отчёт',
      messages: {
        promptSaveEmpty: 'Название и текст промпта не могут быть пустыми.',
        promptSaved: ({ name }) => `Промпт "${name}" сохранён!`,
        promptDeleteSelect: 'Выберите промпт для удаления.',
        promptDeleteConfirm: ({ name }) => `Вы уверены, что хотите удалить промпт "${name}"?`,
        promptDeleted: ({ name }) => `Промпт "${name}" удалён.`,
        customPromptEmpty: 'Собственный промпт не может быть пустым.',
        promptAuthRequired: 'Для сохранения промптов нужен вход.',
        promptSavedAs: ({ name }) => `Промпт сохранён как "${name}"!`,
        promptUpdated: ({ name }) => `Промпт "${name}" обновлён!`,
        promptSaveError: 'Не удалось сохранить промпт.',
        promptDeleteError: 'Не удалось удалить промпт.',
        promptUnnamed: 'Без названия',
        previousInProgress: '⏳ Предыдущий запрос ещё выполняется.',
        noLinksFound: 'Не найдено ссылок на судебные решения.',
        noUnique: 'На этой странице нет уникальных дел для анализа.',
        noNewSession: 'В этой сессии нет новых дел для анализа.',
        foundLinks: ({ count }) => `📤 Найдено ${count} ссылок. Отправляю на сервер...`,
        filteredHistory: ({ before, removed, count }) =>
          `📤 Найдено ${before}. -${removed} (история) → ${count}.`,
        filteredSession: ({ removed, count }) => `📤 Фильтр сессии: -${removed} → ${count}.`,
        jobCreated: '✅ Задание создано. Отслеживайте прогресс в расширении.',
        createJobError: 'Ошибка при создании задания',
        copyUrlsCopied: ({ count }) => `✅ Скопировано: ${count}`,
        copyUrlsEmpty: 'Нет ссылок для копирования.',
        copyUrlsFailed: 'Не удалось скопировать ссылки.',
      },
    },
  },
  uk: {
    common: {
      loading: 'Завантаження...',
      errorPrefix: ({ message }) => `Помилка: ${message}`,
      warningPrefix: ({ message }) => `Попередження: ${message}`,
      errorLabel: 'Помилка',
      ok: 'Гаразд',
      na: 'Н/Д',
      hoursShort: 'год',
      minutesShort: 'хв',
      secondsShort: 'с',
    },
    status: {
      queued: '⏳ У черзі',
      pending: '⏳ У черзі',
      downloading: '📥 Завантаження',
      download: '📥 Завантаження',
      processing: '🔄 Обробка',
      retrying: '🔁 Повтор',
      warning: '⚠️ Попередження',
      analyzing: '🤖 Аналіз',
      completed: '✅ Завершено',
      error: '❌ Помилка',
    },
    popup: {
      headerTitle: '🤖 ЄДРСР → Gemini AI',
      headerSubtitle: 'Аналіз судових рішень за допомогою штучного інтелекту',
      authBadgeGuest: 'Гість',
      serverChecking: 'Перевіряю сервер...',
      tabs: {
        collect: '📥 Збір',
        status: '📊 Статус',
        results: '📋 Результати',
        history: '🗂️ Історія',
        auth: '🔐 Вхід',
      },
      collect: {
        currentPageLabel: 'Поточна сторінка:',
        linksFoundLabel: 'Знайдено посилань:',
        uniqueHistoryLabel: 'Унікальні (за історією):',
        uniqueSessionLabel: 'З урахуванням сесії:',
        promptTemplateLabel: 'Шаблон аналізу:',
        uniqueOnlyLabel: 'Лише унікальні справи',
        ignoreSessionLabel: 'Ігнорувати в цій сесії',
        autoTitleLabel: 'Автооновлення заголовка завдання',
        customPromptLabel: 'Ваш промпт для ШІ:',
        customPromptPlaceholder: "Наприклад: 'Знайди всі згадки про експертизи...'",
        promptNameLabel: 'Ім’я для збереження:',
        promptNamePlaceholder: 'Назва промпта',
        savePromptBtn: 'Зберегти',
        updatePromptBtn: 'Оновити',
        savedPromptsLabel: 'Збережені промпти',
        deletePromptBtn: '🗑️ Видалити вибраний промпт',
        collectBtn: '🔍 Зібрати та проаналізувати',
        collectBtnWithCount: ({ count }) => `🔍 Зібрати та проаналізувати (${count})`,
        collectBtnDeferred: '🔍 Перевірити та проаналізувати',
        copyUrlsBtn: '📋 Скопіювати посилання',
        copyUrlsBtnWithCount: ({ count }) => `📋 Скопіювати посилання (${count})`,
        copyUrlsBtnDeferred: '📋 Перевірити та скопіювати посилання',
        countDeferred: 'Перевірка під час запуску',
        historyCountHint: 'Точну кількість за історією буде перевірено лише після запуску.',
      },
      statusTab: {
        jobIdLabel: 'ID завдання:',
        jobIdPlaceholder: 'Введіть ID завдання',
        checkStatusBtn: '📊 Перевірити статус',
        loadLastBtn: '🔄 Останнє завдання',
        retryBtn: '🔄 Перезапустити завдання',
        forceRetryBtn: '⚠️ Примусово перезапустити',
        statusLabel: 'Статус:',
        progressLabel: 'Прогрес:',
        linksLabel: 'Посилань:',
        createdLabel: 'Час створення:',
      },
      resultsTab: {
        openNew: '🚀 Відкрити в новому вікні',
        showResult: '📋 Показати результат',
        copyResult: '📋 Копіювати',
      },
      historyTab: {
        loading: 'Завантаження історії...',
        empty: 'Історія порожня',
      },
      auth: {
        emailLabel: 'Email',
        emailPlaceholder: 'you@example.com',
        passwordLabel: 'Пароль',
        passwordPlaceholder: '••••••••',
        showPwd: 'Показати',
        hidePwd: 'Сховати',
        loginBtn: '🔐 Увійти',
        signupBtn: '🆕 Реєстрація',
        recoverBtn: '🔁 Забули пароль?',
        logoutBtn: '🚪 Вийти',
      },
      footer: ({ version, apiHost }) => `Версія ${version || '—'} | API: ${apiHost || '—'}`,
      messages: {
        authRequired: 'Потрібен вхід. Будь ласка, увійдіть.',
        serverConnected: 'Підключено',
        serverDisconnected: 'Відключено',
        serverReconnecting: 'Перепідключення...',
        serverConnectionError: "Помилка з'єднання",
        stuckStatus: '⚠️ Зависло (можна перезапустити)',
        analyzingFallback: '🤖 Аналіз',
        completed: '✅ Завершено',
        error: '❌ Помилка',
        jobTitleFallback: ({ id }) => `Завдання ${id}...`,
        jobIdTitleFallback: ({ id }) => `ID: ${id}...`,
        editTitle: 'Редагувати назву',
        deleteTitle: 'Видалити завдання',
        editPlaceholder: 'Введіть нову назву',
        confirmDeleteJob: ({ title }) =>
          `Ви впевнені, що хочете видалити завдання "${title}"? Цю дію не можна скасувати.`,
        currentPageOk: 'ЄДРСР ✓',
        currentPageNo: 'Не сторінка ЄДРСР',
        errorNoLinks:
          'На сторінці не знайдено посилань на справи. Можливо, потрібно оновити сторінку.',
        errorNoUnique: 'На цій сторінці немає унікальних справ для аналізу.',
        errorNoNewSession: 'У цій сесії немає нових справ для аналізу.',
        promptLabelCustom: 'Користувацький',
        promptEmpty: 'Промпт не може бути порожнім.',
        promptSaveEmpty: 'Назва і текст промпта не можуть бути порожніми.',
        promptSaved: ({ name }) => `Промпт "${name}" збережено!`,
        promptSavedAs: ({ name }) => `Промпт збережено як "${name}"!`,
        promptUpdated: ({ name }) => `Промпт "${name}" оновлено!`,
        promptDeleteSelect: 'Будь ласка, виберіть збережений промпт для видалення.',
        promptDeleteConfirm: ({ name }) => `Ви впевнені, що хочете видалити промпт "${name}"?`,
        promptDeleted: ({ name }) => `Промпт "${name}" видалено.`,
        promptSavedDescription: ({ text }) => `Ваш збережений промпт: "${text}..."`,
        promptAuthRequired: 'Для збереження промптів потрібен вхід.',
        promptUnnamed: 'Без назви',
        authLoginRequired: 'Вкажіть email і пароль',
        authSigningIn: 'Вхід...',
        authSignedIn: 'Успішний вхід.',
        authSignedUp: 'Акаунт створено та виконано вхід.',
        authSignedUpConfirm:
          'Акаунт створено. Підтвердьте пошту за посиланням у листі, потім увійдіть.',
        authLoggedOut: 'Ви вийшли.',
        authRecoverPrompt: 'Вкажіть email для відновлення пароля.',
        authRecoverSending: 'Надсилаю лист для відновлення...',
        authRecoverSent: 'Лист для відновлення пароля надіслано. Перевірте пошту.',
        authRecoverFailed: 'Не вдалося надіслати лист для відновлення.',
        authError: ({ message }) => `Помилка: ${message}`,
        authStatusAuthed: ({ email, id }) =>
          `Ви увійшли як ${email || 'користувач'}${id ? ` (ID: ${id})` : ''}`,
        authStatusGuest: 'Ви не увійшли.',
        authBadgeAuthed: ({ email }) => `🔐 ${email || 'Увійшли'}`,
        authBadgeGuest: 'Гість',
        retryStuckConfirm:
          'Це завдання зависло. Перезапустити його? Буде створено нове завдання з тими ж параметрами.',
        retryConfirm:
          'Перезапустити це завдання? Буде створено нове завдання з тими ж параметрами.',
        retryStuckButton: '🔄 Перезапустити зависле',
        forceRetryConfirm:
          'УВАГА! Примусово перезапустити активне завдання? Поточний прогрес буде втрачено, і буде створено нове завдання.',
        copyResultCopied: '✅ Скопійовано!',
        copyResult: '📋 Копіювати',
        copyUrlsCopied: ({ count }) => `✅ Скопійовано: ${count}`,
        copyUrlsEmpty: 'Немає посилань для копіювання.',
        copyUrlsFailed: 'Не вдалося скопіювати посилання.',
      },
    },
    results: {
      pageTitle: 'Результати аналізу — EDRSR AI',
      metadataTitle: 'Метадані завдання',
      copyReportBtn: '📋 Копіювати звіт',
      pdfBtnReady: '📄 Завантажити звіт',
      pdfBtnLoading: '⏳ Завантаження бібліотек...',
      pdfTypeText: '📄 Текстовий файл (TXT, невеликий розмір)',
      pdfTypeRich: '📄 PDF (текст, клікабельні посилання)',
      pdfTypeImage: '🖼️ PDF (зображення, точне оформлення)',
      downloadCasesBtn: '📄 Завантажити справи',
      analysisLoading: 'Отримання даних від сервіс-воркера...',
      analysisPending: 'Аналіз ще не завершено...',
      errorNoJobId: 'Помилка: ID завдання не знайдено.',
      statusLoading: 'Завантаження...',
      retryBtn: '↻ Повторити спробу',
      errorUnknown: 'Невідома помилка',
      chatTitle: '💬 Чат з результатами аналізу',
      chatThinking: 'ШІ думає...',
      chatPlaceholder: 'Поставте уточнювальне запитання...',
      chatSend: 'Надіслати',
      chatRoleUser: 'Ви:',
      chatRoleAi: 'AI:',
      chatRoleUserShort: 'Ви:',
      chatRoleAiShort: 'AI:',
      userPromptHeading: 'Користувацький запит',
      retryingJob: 'Повторна спроба завдання...',
      copyReportCopied: '✅ Скопійовано!',
      copyReport: '📋 Копіювати звіт',
      generateTxt: 'Генерація TXT...',
      generatePdf: 'Генерація PDF...',
      generatePdfImage: 'Генерація PDF (зображення)...',
      txtError: 'Не вдалося створити текстовий звіт. Перевірте консоль для деталей.',
      pdfError: 'Не вдалося створити PDF. Перевірте консоль для деталей.',
      imagePdfError: 'Не вдалося створити PDF-зображення. Перевірте консоль для деталей.',
      linksLoadError: 'Помилка завантаження контенту справ',
      statusLabel: 'Статус',
      createdLabel: 'Створено',
      totalLinksLabel: 'Всього посилань',
      processedLinksLabel: 'Опрацьовано',
      durationLabel: 'Тривалість',
      statusBadge: ({ status }) => status,
      jobTitleFallback: ({ id }) => `Завдання ${id}...`,
      editTitle: 'Редагувати назву',
    },
    report: {
      metadataHeading: 'МЕТАДАНІ',
      userPromptHeading: 'КОРИСТУВАЦЬКИЙ ЗАПИТ',
      analysisHeading: 'РЕЗУЛЬТАТИ АНАЛІЗУ',
      analysisTitle: 'Звіт аналізу завдання',
      pageOf: ({ page, total }) => `Стор. ${page} з ${total}`,
      casesReportTitle: 'ЗВІТ ПО СПРАВАХ',
      caseLabel: 'СПРАВА',
      jobIdLabel: 'ID завдання',
      createdLabel: 'Дата створення',
    },
    notifications: {
      analysisCompleteTitle: '🎉 Аналіз завершено!',
      analysisCompleteMessage: ({ id }) => `Завдання ${id}... успішно завершено.`,
      analysisErrorTitle: '❌ Помилка аналізу',
      analysisErrorMessage: ({ id }) => `Завдання ${id}... завершилось з помилкою.`,
    },
    bg: {
      authRequired: 'Потрібен вхід. Відкрийте попап розширення та виконайте вхід.',
      contentScriptOutdated:
        'Версія скрипта на сторінці застаріла. Будь ласка, повністю оновіть сторінку (Ctrl+F5) і спробуйте знову.',
      noLinksForFilters: 'Немає справ для аналізу з обраними фільтрами.',
      fetchStatusError: ({ message }) => `Не вдалося завантажити статус завдання: ${message}`,
      fetchJobError: ({ message }) => `Не вдалося завантажити дані завдання: ${message}`,
      updateTitleError: ({ message }) => `Не вдалося оновити назву: ${message}`,
    },
    content: {
      modalTitle: '⚖️ Налаштування аналізу ШІ',
      selectAnalysisLabel: 'Виберіть тип аналізу:',
      customPromptLabel: 'Ваш індивідуальний запит:',
      customPromptPlaceholder:
        "Наприклад: 'Знайди всі згадки про нерухомість і вкажи її статус...'",
      promptNameLabel: 'Ім’я для збереження:',
      promptNamePlaceholder: 'Коротка назва промпта',
      savePromptBtn: 'Зберегти',
      savedPromptsLabel: 'Збережені промпти:',
      savedPromptsDefault: '-- Виберіть збережений --',
      deletePromptTitle: 'Видалити вибраний промпт',
      startAnalysisBtn: '🚀 Почати аналіз',
      copyUrlsBtn: '📋 Скопіювати посилання',
      uniqueOnlyLabel: 'Лише унікальні справи',
      ignoreSessionLabel: 'Ігнорувати в цій сесії',
      floatingButton: '🤖 Проаналізувати з ШІ',
      completionButton: '✅ Аналіз готовий! Відкрити звіт',
      messages: {
        promptSaveEmpty: 'Назва і текст промпта не можуть бути порожніми.',
        promptSaved: ({ name }) => `Промпт "${name}" збережено!`,
        promptSavedAs: ({ name }) => `Промпт збережено як "${name}"!`,
        promptUpdated: ({ name }) => `Промпт "${name}" оновлено!`,
        promptDeleteSelect: 'Виберіть промпт для видалення.',
        promptDeleteConfirm: ({ name }) => `Ви впевнені, що хочете видалити промпт "${name}"?`,
        promptDeleted: ({ name }) => `Промпт "${name}" видалено.`,
        customPromptEmpty: 'Власний промпт не може бути порожнім.',
        promptAuthRequired: 'Для збереження промптів потрібен вхід.',
        promptSaveError: 'Не вдалося зберегти промпт.',
        promptDeleteError: 'Не вдалося видалити промпт.',
        promptUnnamed: 'Без назви',
        previousInProgress: '⏳ Попередній запит ще виконується.',
        noLinksFound: 'Не знайдено посилань на судові рішення.',
        noUnique: 'На цій сторінці немає унікальних справ для аналізу.',
        noNewSession: 'У цій сесії немає нових справ для аналізу.',
        foundLinks: ({ count }) => `📤 Знайдено ${count} посилань. Надсилаю на сервер...`,
        filteredHistory: ({ before, removed, count }) =>
          `📤 Знайдено ${before}. -${removed} (історія) → ${count}.`,
        filteredSession: ({ removed, count }) => `📤 Фільтр сесії: -${removed} → ${count}.`,
        jobCreated: '✅ Завдання створено. Відстежуйте прогрес у розширенні.',
        createJobError: 'Помилка при створенні завдання',
        copyUrlsCopied: ({ count }) => `✅ Скопійовано: ${count}`,
        copyUrlsEmpty: 'Немає посилань для копіювання.',
        copyUrlsFailed: 'Не вдалося скопіювати посилання.',
      },
    },
  },
};

const SUPPORTED_LOCALES = ['ru', 'uk'];
const LOCALE_MAP = { ru: 'ru-RU', uk: 'uk-UA' };
let currentLocale = null;

function detectLocale() {
  const lang = (navigator.language || '').toLowerCase();
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('uk')) return 'uk';
  return 'uk';
}

async function getStoredLocale() {
  try {
    const result = await chrome.storage.local.get(['locale']);
    if (result.locale && SUPPORTED_LOCALES.includes(result.locale)) {
      return result.locale;
    }
  } catch {
    // ignore
  }
  return detectLocale();
}

export async function initI18n() {
  currentLocale = await getStoredLocale();
  return currentLocale;
}

export function getLocale() {
  return currentLocale || detectLocale();
}

export async function setLocale(locale) {
  const next = SUPPORTED_LOCALES.includes(locale) ? locale : detectLocale();
  currentLocale = next;
  try {
    await chrome.storage.local.set({ locale: next });
  } catch {
    // ignore
  }
  return next;
}

function getByPath(obj, path) {
  return path
    .split('.')
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

export function t(key, vars = {}, localeOverride = null) {
  const locale = localeOverride || getLocale();
  const bundle = STRINGS[locale] || STRINGS.uk;
  let value = getByPath(bundle, key);
  if (value === null || value === undefined) {
    value = getByPath(STRINGS.uk, key);
  }
  if (typeof value === 'function') return value(vars);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

export function formatUiDate(date) {
  try {
    const locale = getLocale();
    return new Date(date).toLocaleString(LOCALE_MAP[locale] || 'uk-UA');
  } catch {
    return String(date);
  }
}

export function formatUiDateOnly(date) {
  try {
    const locale = getLocale();
    return new Date(date).toLocaleDateString(LOCALE_MAP[locale] || 'uk-UA');
  } catch {
    return String(date);
  }
}

export function formatReportDate(date) {
  try {
    return new Date(date).toLocaleString('uk-UA');
  } catch {
    return String(date);
  }
}

export function applyTranslations(root = document) {
  const locale = getLocale();
  if (root?.documentElement) {
    root.documentElement.lang = locale === 'ru' ? 'ru' : 'uk';
  }
  const scope = root.querySelectorAll ? root : document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const value = t(key);
    if (el.tagName === 'TITLE') {
      document.title = value;
    } else {
      el.textContent = value;
    }
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    el.setAttribute('placeholder', t(key));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    el.setAttribute('title', t(key));
  });
  scope.querySelectorAll('[data-i18n-value]').forEach((el) => {
    const key = el.getAttribute('data-i18n-value');
    if (!key) return;
    el.value = t(key);
  });
}

export { STRINGS };
