# Настройка административной панели EDRSR-AI

## Быстрый старт

### 1. Переменные окружения

В `server/.env` должны быть настроены:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://...
PORT=4000
```

### 2. Создание администратора

```bash
npm run admin:create -- admin@example.com
```

Скрипт:
- Инициализирует таблицы БД.
- Создает пользователя в Supabase (если его нет).
- Назначает роль `admin`.
- Показывает временный пароль (для нового пользователя).

Если пользователь уже существует и нужен только role‑grant:

```bash
npm run admin:grant -- <user_id>
```

### 3. Запуск сервера

```bash
npm run dev
```

### 4. Вход в админку

Откройте: `http://localhost:4000/admin` и войдите под админским аккаунтом.

## Функции админки

- Дашборд и базовая статистика.
- Пользователи: просмотр, поиск, выдача/отзыв прав админа.
- Задания: список, фильтры, перезапуски, восстановление зависших.
- Система: мониторинг, очистки, аудит, безопасность.

## Админские API (кратко)

- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `POST /api/admin/users/:userId/make-admin`
- `DELETE /api/admin/users/:userId/admin-role`
- `GET /api/admin/jobs`
- `POST /api/admin/jobs/:id/requeue`
- `POST /api/admin/jobs/recover-stuck`
- `GET /api/admin/system/stats`

Полная спецификация: `docs/API_REFERENCE.md`.

## Устранение неполадок

### “Supabase not configured”
Проверьте `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в `.env`.

### “У вас нет прав администратора”
Назначьте роль:

```bash
npm run admin:grant -- <user_id>
```

### База данных недоступна
Проверьте `DATABASE_URL` и доступ к сети.

## Архитектура

```
server/
├── public/admin/          # Статические файлы админки
├── routes/admin.js        # API endpoints для админки
├── middleware/adminAuth.js
└── scripts/create-admin.js
```
