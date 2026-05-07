# 🌍 Environment Variables Reference

## **Обзор**

Сервер читает переменные из `server/.env`. Полный список с комментариями — в `server/env.example`. Ниже — актуальная сводка по ключевым параметрам.

## **🔑 Обязательные переменные**

### **Supabase / Database**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
DATABASE_URL=postgresql://postgres.username:password@host:port/database_name
```

### **Gemini API**
```env
# Один ключ
GEMINI_API_KEY=your_gemini_key

# Или несколько ключей (через запятую/пробел/переносы)
GEMINI_API_KEYS=key1,key2,key3
```

> Production default uses official Gemini keys directly. CLI Proxy is optional and disabled by default.

## **⚙️ Server Configuration**

```env
PORT=4000
NODE_ENV=production
LOG_LEVEL=info
```

## **🤖 AI Model Configuration**

```env
MODEL_NAME=gemini-2.5-flash
# Порожнє значення вимикає fallback; production VPS default.
FALLBACK_MODEL_NAME=
TEMPERATURE=0.3
TOP_K=40
TOP_P=0.8
MAX_TOKENS=65536
MAX_TOKENS_PER_BATCH=60000
```

## **🚀 CLI Proxy (optional)**

```env
ENABLE_CLI_PROXY=false
CLI_PROXY_URL=
CLI_PROXY_MODEL=gemini-3.1-pro-high
CLI_PROXY_API_KEYS=your-api-key-1, your-api-key-2
CLI_PROXY_MAX_ATTEMPTS_PER_KEY=1
```

## **📦 Batch Processing & Parallelism**

```env
# Fallback batch size when DOWNLOAD_BATCH_SIZE/AI_BATCH_SIZE are not set
BATCH_SIZE=10

DOWNLOAD_BATCH_SIZE=10
AI_BATCH_SIZE=5

# Минимальный размер для batch‑обработки (ниже = последовательная обработка)
BATCH_THRESHOLD=15

# Задержка между batch‑запросами (ms)
BATCH_DELAY=1000

# Максимум параллельных AI‑батчей
MAX_CONCURRENT_BATCHES=1
```

## **🕸️ Scraper & Parsing**

```env
MAX_CONCURRENT_REQUESTS=2
REQUEST_DELAY_MS=1000
CASE_TIMEOUT_MS=30000
OVERALL_REQUEST_TIMEOUT_MS=60000
GOT_REQUEST_TIMEOUT_MS=45000

MAX_HTML_BYTES=3000000
READABILITY_MAX_HTML_BYTES=1500000
MAX_SCRIPT_TAGS=200
MAX_HTML_LINE_LENGTH=200000
MAX_JS_KEYWORDS=3000

# Экспериментальная обработка HTML
USE_MARKDOWN_EXTRACTION=false
ENABLE_TEXT_DEDUP=true
ENABLE_TEXT_STRUCTURING=false
ENABLE_TECHNICAL_STRIP=false

# Лимит длины текста (не обрезает, только предупреждает)
MAX_CASE_TEXT_LENGTH=0
```

## **🧠 Memory Safeguards**

```env
MEMORY_WARNING_MB=200
MAX_MEMORY_MB=400
CRITICAL_MEMORY_MB=420
MEMORY_LIMIT_MB=500
```

## **🧵 Очередь и воркеры**

```env
WORKER_ID=<uuid-or-name>
QUEUE_PUMP_INTERVAL_MS=60000
MAX_JOB_DURATION_MS=1500000
MAX_STALL_DURATION_MS=1200000
```

## **🧹 Background Cleanup & Recovery**

```env
ENABLE_WORKER_CLEANUP=true
ENABLE_WORKER_AUTO_TERMINATE=true
ENABLE_PERIODIC_RECOVERY=true
ENABLE_CHAT_CLEANUP=true
ENABLE_CACHE_CLEANUP=true

WORKER_CLEANUP_INTERVAL_MS=300000
WORKER_MAX_LIFETIME_MS=7200000
WORKER_HEALTHCHECK_INTERVAL_MS=600000
WORKER_HEALTHCHECK_AFTER_MS=1200000
RECOVERY_INTERVAL_MS=900000
```

## **💬 Chat Sessions**

```env
CHAT_MAX_SESSIONS=5
CHAT_TTL_MS=900000
CHAT_CLEANUP_INTERVAL_MS=300000
```

## **🗃️ Cache**

```env
CACHE_MAX_PARSED_CASES=1000
CACHE_CLEANUP_INTERVAL_MS=900000
TEMP_CACHE_TTL_MS=3600000
```

## **🧾 Prompt Audit**

```env
PROMPT_AUDIT_RETENTION_DAYS=90
PROMPT_AUDIT_CLEANUP_INTERVAL_MS=21600000
```

## **🌐 CORS / WebSocket Origins**

```env
CORS_ALLOWED_ORIGINS=https://edrsr-ai-server.fun,https://www.edrsr-ai-server.fun,https://app.edrsr-ai-server.fun,chrome-extension://__CHROME_STORE_EXTENSION_ID__
WS_ALLOWED_ORIGINS=https://edrsr-ai-server.fun,https://www.edrsr-ai-server.fun,https://app.edrsr-ai-server.fun,chrome-extension://__CHROME_STORE_EXTENSION_ID__
CHROME_EXTENSION_IDS=__CHROME_STORE_EXTENSION_ID__
```

For the Chrome Web Store build, replace `__CHROME_STORE_EXTENSION_ID__` with the
real extension ID shown in `chrome://extensions` or the Web Store URL. Without
that origin, production CORS and WebSocket handshakes from the extension are
rejected even when the API itself is healthy.

## **🔗 Public URLs (share links)**

```env
# Base URL for the web portal (used to build share links)
APP_BASE_URL=https://app.edrsr-ai-server.fun
# Optional override for share links
PUBLIC_SHARE_BASE_URL=
```

## **🧰 Process / GC**

```env
MAX_OLD_SPACE_MB=1200
```

## **📏 API Validation Limits**

```env
MAX_LINKS_PER_REQUEST=300
MAX_URL_LENGTH=2048
MAX_PROMPT_LENGTH=4000
MAX_PROMPT_NAME_LENGTH=120
MAX_COOKIE_LENGTH=4096
MAX_CHAT_MESSAGE_LENGTH=4000
MAX_PROMPTS_IMPORT=200
```

## **🧩 Postgres Tuning (optional)**

```env
PGSSL=false
PGSSLMODE=require
# Keep certificate verification enabled by default in production.
# Set false only for explicit local/provider exceptions after verifying TLS requirements.
PG_SSL_REJECT_UNAUTHORIZED=true
PG_POOL_MAX=10
PG_IDLE_TIMEOUT_MS=30000
PG_CONN_TIMEOUT_MS=10000
PG_MAX_USES=7500
```

## **📝 Минимальный пример .env**

```env
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/edrsr_ai

GEMINI_API_KEY=<your-gemini-api-key>
MODEL_NAME=gemini-2.5-flash
FALLBACK_MODEL_NAME=

DOWNLOAD_BATCH_SIZE=10
AI_BATCH_SIZE=5
BATCH_SIZE=10
MAX_CONCURRENT_BATCHES=1
REQUEST_DELAY_MS=1000
MAX_CONCURRENT_REQUESTS=2

PORT=4000
NODE_ENV=production
```

> Для production на VPS рекомендуется настроить CORS/WS только на домен и держать PostgreSQL локально.

## **🆘 Устранение неполадок**

### Проверка .env
```bash
ls -la server/.env
cat server/.env
```

### Проверка здоровья (admin‑only)
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:4000/api/health/full
```
