# 🛠️ Admin Scripts Reference

## **Обзор**

В репозитории есть набор скриптов для администрирования, тестов и обслуживания. Большинство запускается из корня проекта через npm команды.

## **📁 Структура скриптов**

```
server/scripts/
├── create-admin.js              # Создать администратора через Supabase Auth
├── create-admin-simple.js       # Назначить админа по user_id (напрямую в БД)
├── transfer-jobs-to-user.js     # Перенос заданий между пользователями
├── transfer-jobs-to-user.sql    # SQL скрипт для переноса данных
├── memory-load-test.js          # Нагрузочный тест памяти
├── test-race-condition-fix.js   # Тест обработки конкурентных запросов
├── test-ai-modes.js             # QA: проверка формата ссылок в AI-отчёте
├── test-scraper-parsing.js      # Проверка парсинга реестра
├── test-scraper-fixtures.js     # Тесты парсинга на фикстурах
├── test-scraper-sample-links.js # Быстрый прогон по списку ссылок
└── fixtures/                    # Фикстуры для тестов

scripts/ (root)
├── apply-rls.js                  # Применение RLS
├── build-extension.js            # Сборка расширения
└── selfcheck.js                  # Репозиторный self-check
```

## **🔐 Управление администраторами**

### Создать администратора (Supabase Auth)

```bash
npm run admin:create -- admin@example.com
```

Требует: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
Скрипт инициализирует таблицы и покажет временный пароль для нового пользователя.

### Назначить админа по user_id (без Supabase Admin API)

```bash
npm run admin:grant -- <user_id>
```

Требует: `DATABASE_URL`.

## **🔄 Перенос заданий**

```bash
cd server
npm run transfer:jobs -- user@example.com
```

Требует: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## **🧪 QA и тестовые скрипты**

### Проверка AI‑формата ссылок (QA)

```bash
node server/scripts/test-ai-modes.js --mode practice_overview --verbose
node server/scripts/test-ai-modes.js --mode custom --prompt "Ваш промпт" --analysis-out /tmp/report.md
node server/scripts/test-ai-modes.js --analysis-file /tmp/report.md
```

### Нагрузочный тест памяти

```bash
npm run test:memory
```

### Тест конкурентных запросов

```bash
node server/scripts/test-race-condition-fix.js
```

### Скрейпер: тесты парсинга

```bash
node server/scripts/test-scraper-parsing.js
node server/scripts/test-scraper-fixtures.js
node server/scripts/test-scraper-sample-links.js
```

## **🔒 Безопасность и RLS**

```bash
npm run apply:rls
```

Требует: `DATABASE_URL`.

## **🧰 Полезные команды**

```bash
npm run build:extension
npm run build:extension:release
npm run test:selfcheck
```

## **⚙️ Переменные окружения**

Минимальный набор для админских скриптов:

```env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
```

Полный список — см. `docs/ENVIRONMENT_VARIABLES.md`.
