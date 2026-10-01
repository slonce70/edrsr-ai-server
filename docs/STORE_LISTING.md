Chrome Web Store Listing — EDRSR‑AI

Short name: EDRSR AI
Full name: EDRSR AI Помощник (must match `name` in `extension/manifest.json`)

Short description (80 chars):
Анализ судебных решений ЄДРСР с ИИ: сбор, отчёты, экспорт PDF/TXT.

Full description:
EDRSR AI — помощник для анализа публичных судебных решений из реестра ЄДРСР
(reyestr.court.gov.ua). Расширение собирает ссылки на решения со страницы реестра,
отправляет их на сервер для пакетного анализа при помощи ИИ и показывает
детальные отчёты с возможностью экспорта (TXT или PDF с кликабельными ссылками).

Основные возможности:
- Сбор ссылок на решения с текущей страницы реестра (по кнопке внизу экрана).
- Асинхронная обработка с прогресс‑баром и подробными статусами.
- История заданий на вкладке расширения.
- Экспорт результатов: TXT (компактно) и PDF (текст, кликабельные ссылки).
- Чат по итогам анализа для уточняющих вопросов.

Политика конфиденциальности:
https://gist.github.com/slonce70/eda62b0a36e77d775fae626fc18ed391

Permissions (justification):
- activeTab — определить активную вкладку для привязки задания и открыть страницу отчёта.
- storage — хранить сессию аутентификации и локальные настройки пользователя.
- notifications — оповещения о завершении или ошибке заданий.
Host permissions:
- https://reyestr.court.gov.ua/* — доступ к DOM страницы реестра для сбора видимых ссылок на решения.
- https://edrsr-ai-server.fun/* — API и WebSocket backend для заданий, истории, промптов и отчётов.
- https://app.edrsr-ai-server.fun/* — открытие портала/публичных share-страниц.
- https://hosvrzhfdotstghdoycv.supabase.co/* — только для аутентификации (email/пароль) и обновления токенов.

Data Safety (guidance for form):
- Собираемые данные: аккаунт (email через Supabase), пользовательские запросы (prompt), выбранные ссылки дел, результаты анализа и статусы заданий.
- Назначение: предоставление функционала (Core functionality) и улучшение надежности.
- Передача третьим лицам: нет продажи, нет рекламных SDK. Используется Supabase для аутентификации.
- Хранение: на сервере — задания и отчёты до удаления пользователем; в расширении — сессия.

Assets (рекомендации):
- Иконки 128x128, 48x48, 16x16 — уже в пакете.
- Скриншоты: 1280×800 (3–5 штук):
  1) Кнопка «Проанализировать с ИИ» на странице реестра.
  2) Вкладка прогресса с реальным временем.
  3) Страница отчёта с PDF/TXT экспортом.
  4) История заданий.

Prohibited content/behavior (комплаенс):
- Нет удалённого кода или CDN‑скриптов; все библиотеки упакованы.
- Нет доступа к cookies/истории/вводу с клавиатуры.
- Один сценарий использования (single‑purpose): анализ ЄДРСР.

Release checklist:
1) Bump the version in `package.json`, `package-lock.json` and `extension/manifest.json` (the build refuses a manifest/package mismatch).
2) Run the release build: `npm run build:extension:release` (see README, "Chrome extension release").
3) Upload `edrsr-ai-extension-vX.Y.Z.zip` to the Chrome Web Store (Unlisted).
4) Provide the Privacy Policy URL and fill in Data Safety.
5) List and justify permissions/host_permissions in the description.
6) After publishing, make sure the production API allows the Store origin
   `chrome-extension://dknfodmbknjengdbmdecidpapbiabgdb` (`CHROME_EXTENSION_IDS`, see docs/DEPLOYMENT.md).
