# 🔌 API Reference

## **Обзор API**

EDRSR-AI предоставляет RESTful API для взаимодействия с системой анализа судебных решений. API разделен на публичные и административные endpoints.

**Base URL:** `https://edrsr-ai-server.onrender.com` (production) или `http://localhost:4000` (development)

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
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600
}
```

#### GET `/api/health/full`
Полная проверка здоровья системы включая базу данных.

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600,
  "database": "connected",
  "memory": {
    "heapUsed": "45.2 MB",
    "heapTotal": "67.8 MB",
    "rss": "89.1 MB"
  }
}
```

## **📦 Задания (пользовательские)**

Все требуют `Authorization: Bearer <jwt>`.

#### POST `/api/collect`
Создать новое задание. Тело: `{ links: [{url, decisionDate?}], cookie?, prompt?, clientId }`.
Ответ: `{ success, jobId, ...state }`.

#### POST `/api/retry/:jobId`
Создать копию существующего задания и поставить в очередь.

#### GET `/api/jobs?limit=<n>`
Последние задания пользователя (короткая карточка).

Примечание: лимит принудительно ограничен `JOBS_MAX_LIMIT` (по умолчанию 100), даже если передать `all`.

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

#### GET `/api/jobs/:jobId/analysis`
Вернуть только итоговый анализ задания.

Ответ: `{ "success": true, "jobId": "...", "analysis": "...markdown..." }`

#### GET `/api/jobs/:jobId/links-content`
Вернуть контент обработанных ссылок для задания (используется для экспорта TXT).

Ответ: `{ "success": true, "jobId": "...", "links": [{ "url": "...", "content": "..." }] }`

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

#### GET `/api/workers/active`
Список активных воркеров.

#### POST `/api/workers/:jobId/terminate`
Принудительно завершить воркер задания.

#### POST `/api/workers/terminate-all`
Завершить все воркеры.

#### GET `/api/system/stats`
Системная статистика (очередь, память и т.д.).

#### POST `/api/queue/clear`
Очистить in‑memory очередь (для отладки).

## **🔐 Административные Endpoints**

Все требуют роли `admin`.

#### GET `/api/admin/dashboard`
Статистика дашборда.

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "totalUsers": 25,
    "totalJobs": 150,
    "activeJobs": 3,
    "completedJobs": 147,
    "totalCases": 1250,
    "systemMemory": "45.2 MB",
    "uptime": 3600
  }
}
```

#### GET `/api/admin/users`
Список пользователей (с пагинацией и поиском).

**Query Parameters:**
- `page` (optional): Номер страницы (default: 1)
- `limit` (optional): Количество пользователей на странице (default: 20)

**Response (200):**
```json
{
  "success": true,
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "role": "user",
      "created_at": "2024-01-15T10:30:00Z",
      "last_login": "2024-01-15T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25,
    "pages": 2
  }
}
```

#### POST `/api/admin/users/:userId/make-admin`
Назначить роль администратора.

**Response (200):**
```json
{
  "success": true,
  "message": "User role updated to admin"
}
```

#### DELETE `/api/admin/users/:userId`
Удалить пользователя и его данные.

#### POST `/api/admin/jobs/:id/requeue`
Перезапустить задание: сбрасывает блокировки и переводит задание в `retrying`/очередь. Тело: `{ reset_links?: boolean }`.
После успешного запроса очередь автоматически запускается (внутренний self‑call `/api/internal/process-queue` с локальным fallback при ошибке HTTP).

**Response (200):**
```json
{
  "success": true,
  "message": "User and all associated data deleted",
  "deleted": {
    "jobs": 15,
    "cases": 120,
    "chatMessages": 45
  }
}
```

#### **DELETE /api/admin/users/:userId/admin-role**
Отзыв прав администратора у пользователя.

**Response (200):**
```json
{
  "success": true,
  "message": "Admin role revoked"
}
```

### **Управление заданиями**

#### **GET /api/admin/jobs**
Список всех заданий в системе.

**Query Parameters:**
- `page` (optional): Номер страницы (default: 1)
- `limit` (optional): Количество заданий на странице (default: 20)
- `status` (optional): Фильтр по статусу (`pending`, `queued`, `retrying`, `processing`, `completed`, `error`)
- `user_id` (optional): Фильтр по пользователю

**Response (200):**
```json
{
  "success": true,
  "jobs": [
    {
      "id": "uuid",
      "title": "Анализ решений по гражданским делам",
      "status": "completed",
      "user_id": "user_uuid",
      "user_email": "user@example.com",
      "created_at": "2024-01-15T10:30:00Z",
      "completed_at": "2024-01-15T11:00:00Z",
      "total_cases": 25,
      "progress": 100
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

#### **GET /api/admin/jobs/:jobId/report**
Получение отчета по конкретному заданию.

**Response (200):**
```json
{
  "success": true,
  "report": {
    "job_id": "uuid",
    "title": "Анализ решений по гражданским делам",
    "status": "completed",
    "created_at": "2024-01-15T10:30:00Z",
    "completed_at": "2024-01-15T11:00:00Z",
    "total_cases": 25,
    "analysis": "markdown_content_here",
    "metadata": {
      "user_email": "user@example.com",
      "processing_time": 1800,
      "ai_requests": 5
    }
  }
}
```

#### **PUT /api/admin/jobs/:jobId/title**
Изменение названия задания.

#### **GET /api/admin/jobs/errors**
Список последних заданий в статусе `error`.

#### **POST /api/admin/jobs/:jobId/retry**
Перезапустить конкретное задание из статуса `error` в `retrying`. После запроса очередь автоматически запускается (self‑call + fallback).

#### **POST /api/admin/jobs/retry-failed**
Массовый перезапуск всех заданий с временными ошибками. Автоматически запускает очередь при наличии перезапущенных заданий.

#### **POST /api/admin/jobs/recover-stuck**
Ручное восстановление зависших заданий (без heartbeat дольше порога). Тело: `{ grace_minutes?: number }` (по умолчанию 5). Все подходящие задания переводятся в `retrying` и запускается очередь.

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
  "message": "Job title updated",
  "job": {
    "id": "uuid",
    "title": "Новое название задания",
    "updated_at": "2024-01-15T12:00:00Z"
  }
}
```

#### **DELETE /api/admin/jobs/:jobId**
Удаление задания и всех связанных данных.


#### **GET /api/admin/security/stats**
Статистика безопасности системы.

**Response (200):**
```json
{
  "success": true,
  "security": {
    "blocked_ips": [
      {
        "ip": "192.168.1.100",
        "reason": "brute_force",
        "blocked_until": "2024-01-15T15:00:00Z",
        "attempts": 8
      }
    ],
    "failed_attempts": [
      {
        "ip": "10.0.0.50",
        "email": "test@example.com",
        "attempts": 3,
        "last_attempt": "2024-01-15T12:30:00Z"
      }
    ],
    "suspicious_activity": [
      {
        "ip": "172.16.0.25",
        "type": "unusual_user_agent",
        "user_agent": "curl/7.68.0",
        "timestamp": "2024-01-15T12:15:00Z"
      }
    ],
    "rate_limits": {
      "login_attempts": "5 per 15 minutes",
      "admin_requests": "100 per minute"
    }
  }
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
curl -X GET https://edrsr-ai-server.onrender.com/api/admin/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### **Удаление пользователя:**
```bash
curl -X DELETE https://edrsr-ai-server.onrender.com/api/admin/users/USER_UUID \
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
const token = data.token;
```

#### **Получение статистики:**
```javascript
const response = await fetch('/api/admin/dashboard', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const stats = await response.json();
console.log('Total users:', stats.stats.totalUsers);
```

## **🔄 WebSocket Events**

### **Подключение**
```javascript
const ws = new WebSocket('wss://edrsr-ai-server.onrender.com');

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
