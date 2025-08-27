# 🌍 Environment Variables Reference

## **Обзор**

EDRSR-AI использует переменные окружения для конфигурации различных компонентов системы. Все переменные должны быть определены в файле `.env` в папке `server/`.

## **🔑 Обязательные переменные**

### **Supabase Configuration**
```env
# URL вашего Supabase проекта
SUPABASE_URL=https://your-project.supabase.co

# Публичный ключ (anon key) для клиентской аутентификации
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Секретный ключ (service role key) для административных операций
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### **Database Connection**
```env
# Строка подключения к PostgreSQL базе данных
DATABASE_URL=postgresql://postgres.username:password@host:port/database_name
```

### **Gemini AI API**
```env
# Ключ API для Google Gemini AI
GEMINI_API_KEY=AIzaSyB1FTFsvkAqa19r461AJlfQlMELRamV3ZI
```

## **⚙️ Конфигурация сервера**

### **Основные настройки**
```env
# Порт на котором будет работать сервер
PORT=4000

# Режим работы (development/production)
NODE_ENV=production
```

### **Ограничения и производительность**
```env
# Максимальное количество одновременных запросов
MAX_CONCURRENT_REQUESTS=1

# Задержка между запросами (миллисекунды)
REQUEST_DELAY_MS=1000

# Максимальное количество одновременных AI запросов
MAX_CONCURRENT_AI_REQUESTS=3
```

## **🤖 AI Model Configuration**

### **Gemini Model Settings**
```env
# Название модели Gemini
MODEL_NAME=gemini-2.5-flash

# Температура генерации (0.0 - 1.0)
TEMPERATURE=0.3

# Top-K параметр для генерации
TOP_K=40

# Top-P параметр для генерации
TOP_P=0.8

# Максимальное количество токенов в ответе
MAX_TOKENS=65536

# Максимальное количество токенов на батч
MAX_TOKENS_PER_BATCH=60000

# Резервная модель при ошибках
FALLBACK_MODEL_NAME=gemini-2.5-flash
```

## **📊 Batch Processing**

### **Настройки батчевой обработки**
```env
# Оптимальный размер батча
OPTIMAL_BATCH_SIZE=10

# Порог для запуска батча
BATCH_THRESHOLD=15

# Задержка между батчами (миллисекунды)
BATCH_DELAY=1000
```

## **📝 Логирование и мониторинг**

### **Настройки логов**
```env
# Уровень логирования (debug, info, warn, error)
LOG_LEVEL=info
```

### **Chat System**
```env
# Максимальное количество активных чат-сессий
CHAT_MAX_SESSIONS=100

# Время жизни чат-сессии (миллисекунды)
CHAT_TTL_MS=14400000

# Интервал очистки чат-сессий (миллисекунды)
CHAT_CLEANUP_INTERVAL_MS=300000
```

### **Очередь и задания**
```env
# Интервал периодического восстановления зависших задач (мс)
QUEUE_PUMP_INTERVAL_MS=60000

# Идентификатор воркера (опционально, для логирования/кластера)
WORKER_ID=<uuid-or-name>

# Размер батча ссылок при скачивании
BATCH_SIZE=25

# Таймауты скачивания
OVERALL_REQUEST_TIMEOUT_MS=60000
GOT_REQUEST_TIMEOUT_MS=45000

# Порог памяти для предупреждений (МБ)
MEMORY_LIMIT_MB=500

# Внешний URL сервиса (для пинга Render keep-alive)
RENDER_EXTERNAL_URL=https://your-app.onrender.com
```

## **🔒 Безопасность**

### **Rate Limiting**
```env
# Лимит попыток входа в админку (по умолчанию: 5 за 15 минут)
ADMIN_LOGIN_RATE_LIMIT=5

# Время блокировки при превышении лимита (миллисекунды)
ADMIN_LOGIN_BLOCK_TIME=900000

# Лимит запросов к админским API (по умолчанию: 100 в минуту)
ADMIN_API_RATE_LIMIT=100
```

## **📋 Полный пример .env файла**

```env
# =============================================================================
# SUPABASE CONFIGURATION
# =============================================================================
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres

# =============================================================================
# GEMINI AI API
# =============================================================================
GEMINI_API_KEY=<your-gemini-api-key>

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================
PORT=4000
NODE_ENV=production

# =============================================================================
# PERFORMANCE SETTINGS
# =============================================================================
MAX_CONCURRENT_REQUESTS=1
REQUEST_DELAY_MS=1000
MAX_CONCURRENT_AI_REQUESTS=3

# =============================================================================
# AI MODEL SETTINGS
# =============================================================================
MODEL_NAME=gemini-2.5-flash
TEMPERATURE=0.3
TOP_K=40
TOP_P=0.8
MAX_TOKENS=65536
MAX_TOKENS_PER_BATCH=60000
FALLBACK_MODEL_NAME=gemini-2.5-flash

# =============================================================================
# BATCH PROCESSING
# =============================================================================
OPTIMAL_BATCH_SIZE=10
BATCH_THRESHOLD=15
BATCH_DELAY=1000

# =============================================================================
# LOGGING AND MONITORING
# =============================================================================
LOG_LEVEL=info

# =============================================================================
# CHAT SYSTEM
# =============================================================================
CHAT_MAX_SESSIONS=100
CHAT_TTL_MS=14400000
CHAT_CLEANUP_INTERVAL_MS=300000

# =============================================================================
# SECURITY SETTINGS
# =============================================================================
ADMIN_LOGIN_RATE_LIMIT=5
ADMIN_LOGIN_BLOCK_TIME=900000
ADMIN_API_RATE_LIMIT=100
```

## **🌐 Render Deployment**

### **Переменные для Render (Production)**

При деплое на Render используйте следующие переменные:

```env
# Обязательные для работы
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

### **Важные моменты для Render:**

1. **DATABASE_URL**: Используйте порт `5432` (не `6543`)
2. **NODE_ENV**: Должно быть `production`
3. **PORT**: Render автоматически устанавливает порт, но `4000` как fallback

## **🔧 Локальная разработка**

### **Переменные для разработки**

```env
# Локальная разработка
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug

# Остальные переменные те же что и в production
```

## **⚠️ Безопасность**

### **Никогда не коммитьте в Git:**
- `.env` файлы
- API ключи
- Пароли от базы данных
- Секретные ключи

### **Используйте .gitignore:**
```gitignore
# Игнорировать все .env файлы
.env
.env.local
.env.production
.env.development

# Игнорировать файлы с секретами
*.key
*.pem
secrets.json
```

## **🔄 Обновление переменных**

### **При изменении переменных:**

1. **Остановите сервер** если он запущен
2. **Обновите .env файл**
3. **Перезапустите сервер** для применения изменений

### **Для Render:**
1. **Обновите переменные** в Render Dashboard
2. **Redeploy** автоматически запустится
3. **Проверьте логи** на наличие ошибок

## **📊 Мониторинг переменных**

### **Проверка загруженных переменных:**

```bash
# В админке: /admin → вкладка "Система"
# Или через API: GET /api/admin/system/stats

# Проверка здоровья системы
curl http://localhost:4000/api/health/full
```

### **Логирование переменных:**

Система автоматически логирует:
- Загруженные переменные окружения
- Ошибки конфигурации
- Предупреждения о недостающих переменных

## **🆘 Устранение неполадок**

### **Ошибка "Variable not set":**
```bash
# Проверить .env файл
cat .env

# Проверить что файл в правильной папке
ls -la server/.env

# Скопировать из примера
cp server/.env.example server/.env
```

### **Ошибка подключения к базе данных:**
```bash
# Проверить DATABASE_URL
echo $DATABASE_URL

# Проверить формат
# Должно быть: postgresql://username:password@host:port/database
```

### **Ошибка Supabase:**
```bash
# Проверить SUPABASE_URL и ключи
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY
echo $SUPABASE_SERVICE_ROLE_KEY

# Проверить в Supabase Dashboard
```
