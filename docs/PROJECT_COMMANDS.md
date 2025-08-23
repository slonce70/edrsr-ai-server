# EDRSR-AI Project Commands & Usage Guide

## 🚀 **Основные команды проекта**

### **Разработка и запуск**
```bash
# Запуск сервера разработки
npm run dev                    # Запуск сервера на порту 4000
npm run start                  # Запуск в production режиме

# Установка зависимостей
npm install                    # Установка зависимостей в корне
cd server && npm install       # Установка зависимостей сервера
```

### **Сборка расширения**
```bash
# Создание production расширения
npm run build:extension        # Сборка с production URLs
# Результат: папка extension-build/ + ZIP файл
```

### **Административные команды**
```bash
cd server

# Создание администратора
npm run admin:create          # Создание админа через Supabase Auth API

# Предоставление прав администратора
npm run admin:grant           # Прямое назначение роли в БД

# Перенос заданий к пользователю
npm run transfer:jobs user@example.com  # Перенос всех данных к пользователю
```

## 🗄️ **Скрипты для работы с базой данных**

### **1. Перенос заданий между пользователями**

**Node.js скрипт (рекомендуется):**
```bash
cd server
npm run transfer:jobs admin@example.com
```

**Что делает этот скрипт:**
- ✅ Найдет пользователя по email в Supabase Auth
- ✅ Покажет сколько данных нужно перенести
- ✅ Перенесет все задания, ссылки, результаты и чат-сообщения к этому пользователю
- ✅ Покажет итоговую статистику

**SQL скрипт (для ручного выполнения):**
```bash
# В Supabase SQL Editor выполнить:
# server/scripts/transfer-jobs-to-user.sql
# Заменить 'USER_ID_HERE' на реальный UUID пользователя
```

### **2. Применение RLS политик**
```bash
cd server
node scripts/apply-rls.js      # Применение Row Level Security
```

### **3. Тестирование производительности**
```bash
cd server
node scripts/memory-load-test.js    # Тест нагрузки памяти
node scripts/test-race-condition-fix.js  # Тест race conditions
```

## 🔐 **Система безопасности**

### **Мониторинг безопасности**
- **Веб-интерфейс:** `/admin` → вкладка "Безопасность"
- **API endpoint:** `GET /api/admin/security/stats`
- **Логи:** Все подозрительные действия логируются

### **Что отслеживается:**
- 🔒 Попытки брутфорс атак (5 попыток → блокировка на 15 мин)
- 🚫 Подозрительные IP (10 попыток → блокировка на 1 час)
- 🕵️ Необычные User-Agent (curl, wget, python)
- 🚨 Паттерны атак (XSS, SQL injection, path traversal)

## 🌐 **Deployment на Render**

### **Переменные окружения для Render:**
```env
GEMINI_API_KEY=<your-gemini-api-key>
PORT=4000
NODE_ENV=production
MAX_CONCURRENT_REQUESTS=1
REQUEST_DELAY_MS=1000
MAX_CONCURRENT_AI_REQUESTS=3
MODEL_NAME=gemini-2.5-flash
TEMPERATURE=0.3
TOP_K=40
TOP_P=0.8
MAX_TOKENS=65536
MAX_TOKENS_PER_BATCH=60000
FALLBACK_MODEL_NAME=gemini-2.5-flash
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
OPTIMAL_BATCH_SIZE=10
BATCH_THRESHOLD=15
BATCH_DELAY=1000
LOG_LEVEL=info
CHAT_MAX_SESSIONS=100
CHAT_TTL_MS=14400000
CHAT_CLEANUP_INTERVAL_MS=300000
```

### **Настройки Render:**
- **Build Command:** `cd server && npm install`
- **Start Command:** `cd server && npm start`
- **Environment:** Node.js 18+

## 📊 **API Endpoints**

### **Публичные endpoints:**
```
POST /api/auth/signin          # Вход в админку
GET  /api/health/light        # Проверка здоровья сервера
GET  /api/health/full         # Полная проверка здоровья
```

### **Административные endpoints (требуют авторизации):**
```
GET  /api/admin/dashboard     # Статистика дашборда
GET  /api/admin/users         # Список пользователей
POST /api/admin/users/:id/make-admin     # Назначение админа
DELETE /api/admin/users/:id   # Удаление пользователя
DELETE /api/admin/users/:id/admin-role   # Отзыв прав админа
GET  /api/admin/jobs          # Список заданий
GET  /api/admin/jobs/:id/report  # Отчет по заданию
PUT  /api/admin/jobs/:id/title   # Изменение названия задания
DELETE /api/admin/jobs/:id    # Удаление задания
POST /api/admin/system/cleanup   # Очистка системы
GET  /api/admin/system/stats  # Статистика системы
GET  /api/admin/audit-log     # Логи аудита
GET  /api/admin/security/stats # Статистика безопасности
```

## 🛠️ **Устранение неполадок**

### **Ошибка подключения к базе данных:**
```
[ERROR] SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing
```

**Решение:**
1. Проверить `DATABASE_URL` в Render
2. Использовать порт `5432` вместо `6543`
3. Попробовать `db.kynohgbkpgngtbqdjyse.supabase.co` вместо `aws-0-eu-central-1.pooler.supabase.com`

### **Ошибка авторизации:**
```
[ERROR] Admin access required
```

**Решение:**
1. Проверить что пользователь имеет роль `admin` в таблице `user_roles`
2. Выполнить: `npm run admin:grant` для назначения роли

### **Ошибка сборки расширения:**
```
[ERROR] Build failed
```

**Решение:**
1. Проверить что все файлы расширения на месте
2. Проверить права доступа к папкам
3. Убедиться что Node.js версии 18+

## 📁 **Структура проекта**

```
edrsr-ai/
├── extension/                 # Chrome расширение
├── server/                    # Backend сервер
│   ├── middleware/           # Middleware (auth, security, rate limiting)
│   ├── routes/               # API routes
│   ├── scripts/              # Скрипты для администрирования
│   ├── public/admin/         # Веб-интерфейс админки
│   └── database/             # Подключение к БД
├── scripts/                   # Скрипты сборки
└── extension-build/           # Собранное production расширение
```

## 🔄 **Workflow разработки**

### **1. Локальная разработка:**
```bash
npm run dev                    # Запуск сервера
# Открыть http://localhost:4000/admin
```

### **2. Тестирование:**
```bash
npm run lint                   # Проверка кода
npm run format                 # Форматирование кода
npm run test:memory           # Тест памяти
```

### **3. Сборка и деплой:**
```bash
npm run build:extension        # Сборка расширения
git add . && git commit -m "Update"  # Коммит изменений
git push origin main          # Пуш на GitHub
# Render автоматически деплоит
```

## 📚 **Полезные ссылки**

- **Supabase Dashboard:** https://supabase.com/dashboard
- **Render Dashboard:** https://dashboard.render.com
- **Google AI Studio:** https://ai.google.dev (для Gemini API ключа)
- **Chrome Web Store:** https://chrome.google.com/webstore (для публикации расширения)

## 🆘 **Поддержка**

При возникновении проблем:
1. Проверить логи сервера
2. Проверить переменные окружения
3. Проверить подключение к базе данных
4. Проверить права доступа пользователей
