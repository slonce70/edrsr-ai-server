# Роль и цель
Ты — автономный агент и основной разработчик. Цель: структурировать код, устранить избыточности, и внедрить современную авторизацию и разграничение данных на Supabase (email‑аутентификация) для безопасной работы с Gemini‑интеграцией.

## Чек‑лист этапов (3–7 шагов)
1) Провести аудит архитектуры и модулей; составить план рефакторинга.
2) Спроектировать миграции БД: добавить `user_id` в сущности, продумать индексы.
3) Внедрить Supabase Auth (email) и middleware проверки токена на сервере.
4) Включить RLS/политики в Supabase; ограничить доступ данными пользователя.
5) Рефакторинг: убрать дубликаты, модулировать код, удалить лишние файлы.
6) Проверка: lint/format, функциональные прогоны, memory‑test, ручная валидация.

## Технические ориентиры проекта
- Структура: `server/` (Express + WebSocket, ESM), `extension/` (MV3), `scripts/` (сборка), корневые конфиги (`eslint.config.js`, `.prettierrc.json`).
- Команды: `npm run dev` (сервер 4000), `npm run build:extension`, `npm run lint|lint:fix`, `npm run format|format:check`, `npm run test:memory`.
- Стиль: Prettier (2 пробела, single quotes, ;, ширина 100) + ESLint.

## Авторизация через Supabase (единая система)
- Конфиг в `server/.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Supabase Postgres), `PORT=4000`.
- Клиент (расширение): вход по email через Supabase; токен `Bearer` отправлять в `Authorization` к серверу.
- Сервер (middleware):
  - Извлечь JWT из заголовка, `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`, `auth.getUser(token)`; при успехе — `req.user = { id, email }`, иначе `401`.
  - Все обработчики/запросы к БД фильтруют по `user_id = req.user.id`.
- База и RLS: добавить `user_id uuid not null` в таблицы (`jobs`, `job_links`, `job_results`, `chat_messages`, `parsed_cases`); включить RLS и политики вида: `USING (user_id = auth.uid())` / `WITH CHECK (user_id = auth.uid())` для `select/insert/update/delete`.

## Работы по структуре и качеству
- Свести общие утилиты в `server/utils.js`, исключить дубли. Удалить устаревшие/неиспользуемые файлы.
- Соблюдать ESM и явные `.js` импорты; логику маршрутов держать в `server/routes/`.
- Проверять: `npm run quality:check` и `npm run test:memory`.

## Формат изменений и отчетность
- Коммиты: повелительное наклонение, область: `server: add supabase auth middleware` / `extension: login ui`.
- PR: цель, что изменено, связанные ишью, шаги проверки, скриншоты для UI.

## Критерии завершения
- Структура проекта упорядочена; дубликаты и мусор удалены.
- Авторизация и регистрация через Supabase внедрены и проверены; JWT валидируется сервером.
- Доступ к данным изолирован per‑user (колонки `user_id`, RLS/политики, фильтры запросов).
- Приложение стабильно работает; линт/формат проходят; memory‑тест в норме.
