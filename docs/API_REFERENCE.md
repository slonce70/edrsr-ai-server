# 🔌 API Reference

## **Обзор API**

EDRSR-AI предоставляет RESTful API для взаимодействия с системой анализа судебных решений. API разделен на публичные и административные endpoints.

**Base URL:** `https://edrsr-ai-server.onrender.com` (production) или `http://localhost:4000` (development)

## **🔓 Публичные Endpoints**

### **Аутентификация**

#### **POST /api/auth/signin**
Вход в систему для получения JWT токена.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "admin"
  },
  "token": "jwt_token_here"
}
```

**Response (401):**
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

**Rate Limiting:** 5 попыток за 15 минут на IP

### **Проверка здоровья системы**

#### **GET /api/health/light**
Быстрая проверка доступности сервера.

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600
}
```

#### **GET /api/health/full**
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

## **🔐 Административные Endpoints**

**Требуют авторизации:** Добавить заголовок `Authorization: Bearer <jwt_token>`

### **Дашборд и статистика**

#### **GET /api/admin/dashboard**
Получение общей статистики системы.

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

### **Управление пользователями**

#### **GET /api/admin/users**
Список всех пользователей системы.

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

#### **POST /api/admin/users/:userId/make-admin**
Назначение пользователю роли администратора.

**Response (200):**
```json
{
  "success": true,
  "message": "User role updated to admin"
}
```

#### **DELETE /api/admin/users/:userId**
Удаление пользователя и всех его данных.

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
- `status` (optional): Фильтр по статусу (`pending`, `processing`, `completed`, `failed`)
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

**Response (200):**
```json
{
  "success": true,
  "message": "Job and all associated data deleted",
  "deleted": {
    "cases": 25,
    "chatMessages": 10,
    "results": 1
  }
}
```

### **Системные операции**

#### **POST /api/admin/system/cleanup**
Очистка устаревших данных системы.

**Query Parameters:**
- `older_than_days` (optional): Удалить данные старше N дней (default: 30)

**Response (200):**
```json
{
  "success": true,
  "message": "System cleanup completed",
  "cleaned": {
    "old_jobs": 15,
    "old_cases": 200,
    "old_chat_messages": 50,
    "freed_memory": "15.3 MB"
  }
}
```

#### **GET /api/admin/system/stats**
Детальная статистика системы.

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "system": {
      "uptime": 3600,
      "memory": {
        "heapUsed": "45.2 MB",
        "heapTotal": "67.8 MB",
        "rss": "89.1 MB"
      },
      "node_version": "18.17.0",
      "platform": "linux"
    },
    "database": {
      "connections": 5,
      "size": "125.7 MB",
      "tables": {
        "jobs": 150,
        "job_links": 1250,
        "job_results": 150,
        "chat_messages": 450,
        "parsed_cases": 1250
      }
    },
    "ai": {
      "total_requests": 1250,
      "successful_requests": 1200,
      "failed_requests": 50,
      "average_response_time": 2.5
    }
  }
}
```

### **Аудит и безопасность**

#### **GET /api/admin/audit-log**
Логи всех административных действий.

**Query Parameters:**
- `page` (optional): Номер страницы (default: 1)
- `limit` (optional): Количество записей на странице (default: 50)
- `action` (optional): Фильтр по типу действия
- `user_id` (optional): Фильтр по пользователю
- `date_from` (optional): Фильтр по дате (YYYY-MM-DD)
- `date_to` (optional): Фильтр по дате (YYYY-MM-DD)

**Response (200):**
```json
{
  "success": true,
  "logs": [
    {
      "id": "uuid",
      "action": "user_deleted",
      "user_id": "admin_uuid",
      "user_email": "admin@example.com",
      "target_user_id": "deleted_user_uuid",
      "target_user_email": "deleted@example.com",
      "details": "User account deleted",
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2024-01-15T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1250,
    "pages": 25
  }
}
```

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

## **📝 Примеры использования**

### **cURL примеры**

#### **Вход в систему:**
```bash
curl -X POST https://edrsr-ai-server.onrender.com/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password123"}'
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
