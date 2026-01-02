# 🔌 API Reference

## **Обзор API**

EDRSR-AI предоставляет RESTful API для взаимодействия с системой анализа судебных решений. API разделен на публичные и административные endpoints.

**Base URL:** `https://edrsr-ai-server.fun` (production) или `http://localhost:4000` (development)

## **🔓 Публичные Endpoints**

### **Аутентификация**

#### POST `/api/auth/signin`
Вход для получения JWT. Тело: `{ "email", "password" }`. При успехе возвращает `access_token` и `user`.
Rate limit: 5 попыток/15 минут.

### **Проверка здоровья системы**

#### GET `/api/health/light`
Быстрая проверка доступности сервера.

**Response (200):**
```json
{
  "status": "ok"
}
```

#### GET `/api/health/full`
Полная проверка доступности сервиса (требуется админ‑роль). Ответ кэшируется на `HEALTH_FULL_TTL_MS`.

**Response (200):**
```json
{
  "status": "healthy",
  "services": {
    "gemini": "online"
  },
  "activeJobs": 3,
  "version": "1.1.0",
  "cachedAt": "2025-12-30T10:30:00Z",
  "ttlMs": 60000
}
```

## **📦 Задания (пользовательские)**

Все требуют `Authorization: Bearer <jwt>`.

#### POST `/api/collect`
Создать новое задание.

Тело:
```json
{
  "links": [{ "url": "...", "decisionDate": "DD.MM.YYYY" }],
  "cookie": "optional",
  "prompt": "optional",
  "prompt_label": "optional",
  "auto_title_enabled": true,
  "clientId": "optional"
}
```

Ответ: `{ success, jobId, ...state }`.
Ограничение: `MAX_LINKS_PER_REQUEST` (по умолчанию 300).

#### POST `/api/retry/:jobId`
Создать копию существующего задания и поставить в очередь.

#### GET `/api/me`
Вернуть базовый профиль пользователя (id + email).

Ответ: `{ "success": true, "user": { "id": "...", "email": "..." } }`.

#### GET `/api/jobs?limit=<n>&page=<n>&status=<value>&search=<query>`
Последние задания пользователя (короткая карточка) + постраничная выдача.

Параметры:
- `limit` — размер страницы (по умолчанию 100, ограничен `JOBS_MAX_LIMIT`).
- `page` — номер страницы (1..n).
- `status` — фильтр по статусу (`queued`, `downloading`, `analyzing`, `completed`, `failed`).
- `search` — поиск по `title` или `prompt`.

Ответ: `{ success: true, jobs: [...], pagination: { page, limit, total } }`.

Примечание: `limit=all` поддерживается только без фильтров (совместимость с расширением).

#### GET `/api/status/:id`
Статус конкретного задания (по умолчанию — лёгкий ответ без больших полей).

Поддерживаемые параметры:
- `include=analysis` — добавить итоговый анализ (`analysis_text`).
- `include=links` — добавить список ссылок без поля `content` (только `url, status, decision_date`).

#### PATCH `/api/jobs/:id/title`
Обновить заголовок задания: `{ title }`.

#### DELETE `/api/jobs/:id`
Удалить задание и все связанные данные.

#### POST `/api/urls/processed-check`
Проверка набора URL на предмет уже обработанных.

Тело запроса: `{ "urls": ["https://.../Review/123", ...] }`

Ответ: `{ "success": true, "processed": ["https://.../Review/123", ...] }`

Заменяет устаревший `GET /api/processed-urls`.

#### GET `/api/processed-urls` (deprecated)
Возвращает все обработанные URL пользователя. Не рекомендуется для больших объёмов.

Ответ: `{ "success": true, "urls": ["https://.../Review/123", ...] }`

#### GET `/api/jobs/:jobId/analysis`
Вернуть только итоговый анализ задания.

Ответ: `{ "success": true, "jobId": "...", "analysis": "...markdown..." }`

#### GET `/api/jobs/:jobId/links-content`
Вернуть контент обработанных ссылок для задания (используется для экспорта TXT).

Ответ: `{ "success": true, "jobId": "...", "links": [{ "url": "...", "content": "..." }] }`

#### GET `/api/jobs/last`
Последнее релевантное задание пользователя (лёгкий объект).

Ответ: `{ "success": true, "job": { ... } }`

## **🧩 Пользовательские промпты**

Все требуют `Authorization: Bearer <jwt>`.

#### GET `/api/prompts`
Список сохранённых промптов пользователя.

Поддерживает `If-None-Match` (ETag) для экономии трафика. При совпадении возвращает `304 Not Modified`.

Ответ: `{ "success": true, "prompts": [{ "id", "name", "content", "created_at", "updated_at" }], "lastUpdated": "..." }`

#### POST `/api/prompts`
Создать новый промпт. Тело: `{ name, content }`.

Если имя занято — сервер добавит суффикс ` (2)`, ` (3)` и т.д.

#### PATCH `/api/prompts/:id`
Обновить промпт. Тело: `{ name?, content? }`.

Если новое имя занято — добавится суффикс.

#### DELETE `/api/prompts/:id`
Удалить промпт пользователя.

#### POST `/api/prompts/import`
Импорт массива промптов (для миграции).

Тело: `{ prompts: [{ name, content }, ...] }`.

## **💬 Чат по результатам**

#### GET `/api/chat/:jobId`
История сообщений.

#### POST `/api/chat/:jobId`
Отправить вопрос: `{ message }`. Ответ: `{ answer }`.

## **🧵 Воркеры и система**

Все эндпоинты ниже требуют роли `admin`.

#### GET `/api/workers/active`
Список активных воркеров.

#### POST `/api/workers/:jobId/terminate`
Принудительно завершить воркер задания.

#### POST `/api/workers/terminate-all`
Завершить все воркеры.

#### GET `/api/system/stats`
Системная статистика: очередь, воркеры, память, uptime.

#### GET `/api/system/chat-sessions`
Состояние in‑memory chat‑сессий.

#### POST `/api/queue/clear`
Очистить in‑memory очередь и отменить queued jobs (админ).

#### POST `/api/internal/process-queue`
Принудительно запустить обработку очереди (админ).

## **🔐 Административные Endpoints**

Все требуют роли `admin`.

#### GET `/api/admin/dashboard`
Статистика дашборда. Ответ кэшируется на стороне сервера (TTL 60s).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "total_jobs": 150,
    "completed_jobs": 147,
    "failed_jobs": 3,
    "retryable_jobs": 2,
    "jobs_today": 10,
    "total_links_processed": 1250,
    "avg_job_duration": 240,
    "total_chat_messages": 560,
    "cached_cases": 420,
    "total_users": 120,
    "new_users_30d": 15,
    "admin_count": 2,
    "last_job_created": "2024-01-15T10:30:00Z",
    "last_job_updated": "2024-01-15T11:00:00Z",
    "memory_usage": 280,
    "uptime_hours": 12.5
  }
}
```

#### GET `/api/admin/users`
Список пользователей (с пагинацией и поиском по email).

**Query Parameters:**
- `page` (optional): Номер страницы (default: 1)
- `limit` (optional): Количество пользователей на странице (default: 20)
- `search` (optional): Поиск по email (client-side filter)

**Response (200):**
```json
{
  "success": true,
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "created_at": "2024-01-15T10:30:00Z",
      "last_sign_in_at": "2024-01-15T12:00:00Z",
      "email_confirmed_at": "2024-01-15T10:31:00Z",
      "roles": ["user"],
      "is_admin": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25
  }
}
```

#### POST `/api/admin/users/:userId/make-admin`
Назначить роль администратора.

**Response (200):**
```json
{
  "success": true,
  "message": "Права администратора предоставлены"
}
```

#### DELETE `/api/admin/users/:userId`
Удалить пользователя и его данные.

**Response (200):**
```json
{
  "success": true,
  "message": "Пользователь удален"
}
```

#### DELETE `/api/admin/users/:userId/admin-role`
Отзыв прав администратора у пользователя.

**Response (200):**
```json
{
  "success": true,
  "message": "Права администратора отозваны"
}
```

### **Управление заданиями**

#### GET `/api/admin/jobs`
Список всех заданий в системе.

**Query Parameters:**
- `page` (optional): Номер страницы (default: 1)
- `limit` (optional): Количество заданий на странице (default: 20)
- `status` (optional): Фильтр по статусу (`pending`, `queued`, `retrying`, `processing`, `completed`, `error`)
- `search` (optional): Поиск по `title` или `prompt`

**Response (200):**
```json
{
  "success": true,
  "jobs": [
    {
      "id": "uuid",
      "title": "Анализ решений по гражданским делам",
      "status": "completed",
      "progress": 100,
      "total_links": 25,
      "processed_links": 25,
      "user_id": "user_uuid",
      "user_email": "user@example.com",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T11:00:00Z",
      "duration": 1800,
      "error_message": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

#### POST `/api/admin/jobs/:id/requeue`
Перезапустить задание: сбрасывает блокировки и переводит в `retrying`/очередь. Тело: `{ reset_links?: boolean }`.
После успешного запроса очередь автоматически запускается.

**Response (200):**
```json
{
  "success": true,
  "message": "Задание <id> поставлено в очередь на повтор"
}
```

#### GET `/api/admin/jobs/:jobId/report`
Получение отчета по конкретному заданию.

**Response (200):**
```json
{
  "success": true,
  "job": {
    "id": "uuid",
    "title": "Анализ решений по гражданским делам",
    "status": "completed",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:00:00Z",
    "total_links": 25,
    "processed_links": 25
  },
  "analysis": "markdown_content_here"
}
```

#### PUT `/api/admin/jobs/:jobId/title`
Изменение названия задания.

**Request Body:**
```json
{
  "title": "Новое название задания"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Название задания обновлено"
}
```

#### DELETE `/api/admin/jobs/:jobId`
Удаление задания и всех связанных данных.

#### GET `/api/admin/jobs/errors`
Список последних заданий в статусе `error`.

#### POST `/api/admin/jobs/:jobId/retry`
Перезапустить конкретное задание из статуса `error` в `retrying`. После запроса очередь автоматически запускается.

#### POST `/api/admin/jobs/retry-failed`
Массовый перезапуск всех заданий с временными ошибками. Автоматически запускает очередь при наличии перезапущенных заданий.

#### POST `/api/admin/jobs/recover-stuck`
Ручное восстановление зависших заданий (без heartbeat дольше порога). Тело: `{ grace_minutes?: number }` (по умолчанию 5). Все подходящие задания переводятся в `retrying` и запускается очередь.

**Response (200):**
```json
{
  "success": true,
  "recovered": 3,
  "grace_minutes": 5
}
```

### **Система и аудит**

#### GET `/api/admin/system/stats`
Системная статистика (память/uptime + counts по таблицам).

#### POST `/api/admin/system/cleanup`
Очистка данных. Тело: `{ cleanupType: "old_jobs" | "failed_jobs" | "old_cache" }`.

**Response (200):**
```json
{
  "success": true,
  "message": "Очистка выполнена. Удалено: 12",
  "cleaned": 12
}
```

#### GET `/api/admin/audit-log`
Журнал административных действий (с пагинацией).

#### GET `/api/admin/security/stats`
Статистика безопасности (in-memory).

**Response (200):**
```json
{
  "success": true,
  "blockedIPs": [
    { "target": "ip:192.168.1.1", "reason": "ip_attempts", "remainingTime": 12 }
  ],
  "failedAttempts": [
    { "target": "email:test@example.com", "count": 3, "lastAttempt": "2024-01-15T12:30:00Z" }
  ]
}
```

### **Gemini API статистика**

#### GET `/api/admin/gemini/stats`
Статистика использования ключей Gemini (включая queued jobs и summary).

#### POST `/api/admin/gemini/reset-stats`
Сброс статистики использования ключей.

**Response (200):**
```json
{
  "success": true,
  "message": "Статистику Gemini API скинуто"
}
```

## **📊 Коды ответов**

### **Успешные ответы**
- **200 OK** - Запрос выполнен успешно
- **201 Created** - Ресурс создан

### **Ошибки клиента**
- **400 Bad Request** - Неверный запрос
- **401 Unauthorized** - Требуется авторизация
- **403 Forbidden** - Доступ запрещен (не админ)
- **404 Not Found** - Ресурс не найден
- **429 Too Many Requests** - Превышен лимит запросов

### **Ошибки сервера**
- **500 Internal Server Error** - Внутренняя ошибка сервера
- **503 Service Unavailable** - Сервис недоступен

## **🔒 Безопасность**

### **Rate Limiting**
- **Вход в админку:** 5 попыток за 15 минут на IP
- **Административные запросы:** 100 запросов в минуту на IP

### **Аутентификация**
- JWT токены с временем жизни
- Автоматическая блокировка при подозрительной активности
- Логирование всех действий

### **Защита от атак**
- Защита от брутфорс атак
- Блокировка подозрительных IP
- Обнаружение необычных User-Agent
- Защита от XSS и SQL injection

## **📝 Пример cURL**

Вход в систему:
```bash
curl -X POST http://localhost:4000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password123"}'
```

#### **Ручное восстановление зависших заданий**
```bash
curl -X POST http://localhost:4000/api/admin/jobs/recover-stuck \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"grace_minutes": 10}'
```

#### **Получение списка пользователей:**
```bash
curl -X GET https://edrsr-ai-server.fun/api/admin/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### **Удаление пользователя:**
```bash
curl -X DELETE https://edrsr-ai-server.fun/api/admin/users/USER_UUID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### **JavaScript примеры**

#### **Вход в систему:**
```javascript
const response = await fetch('/api/auth/signin', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'admin@example.com',
    password: 'password123'
  })
});

const data = await response.json();
const token = data.access_token;
```

#### **Получение статистики:**
```javascript
const response = await fetch('/api/admin/dashboard', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const stats = await response.json();
console.log('Total users:', stats.data.total_users);
```

## **🔄 WebSocket Events**

### **Подключение**
```javascript
const ws = new WebSocket('wss://edrsr-ai-server.fun');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};
```

### **События**
- **job_progress** - Обновление прогресса задания
- **job_completed** - Задание завершено
- **memory_update** - Обновление использования памяти
- **error** - Ошибка в системе

### **Пример обработки событий:**
```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'job_progress':
      console.log(`Job ${data.job_id}: ${data.progress}%`);
      break;
    case 'job_completed':
      console.log(`Job ${data.job_id} completed!`);
      break;
    case 'memory_update':
      console.log(`Memory: ${data.memory.heapUsed}`);
      break;
  }
};
```
