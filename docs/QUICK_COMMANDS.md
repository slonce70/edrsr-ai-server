# 🚀 EDRSR-AI Quick Commands

## **Ежедневные команды**

### **Запуск и остановка**
```bash
# Запуск сервера разработки
npm run dev

# Остановка сервера
Ctrl+C

# Проверка что сервер работает
curl http://localhost:4000/api/health/light
```

### **Админка**
```bash
# Открыть админку в браузере
http://localhost:4000/admin
```

### **Сборка расширения**
```bash
npm run build:extension
# Результат: папка extension-build/ + ZIP файл
```

## **Административные команды**

### **Управление пользователями**
```bash
# Создать админа (через Supabase Auth)
npm run admin:create -- admin@example.com

# Назначить роль админа по user_id
npm run admin:grant -- <user_id>

# Перенести все задания к пользователю
cd server
npm run transfer:jobs -- user@example.com
```

### **Проверка системы**
```bash
# Health light (public)
curl http://localhost:4000/api/health/light

# Health full (admin-only)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:4000/api/health/full

# Статистика админки
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:4000/api/admin/dashboard

# Ручное восстановление зависших заданий
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"grace_minutes": 10}' \
  http://localhost:4000/api/admin/jobs/recover-stuck
```

### **QA для AI‑отчётов**
```bash
node server/scripts/test-ai-modes.js --mode practice_overview --verbose
```

## **Deployment**

### **Обновление на Render**
```bash
git add .
git commit -m "docs: update documentation"
git push origin main
```

### **Проверка переменных окружения**
```bash
# В Render Dashboard проверить:
# - DATABASE_URL (порт 5432, не 6543)
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY
```

## **Устранение неполадок**

### **Ошибка подключения к БД**
```
[ERROR] SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing
```
**Быстрое решение:** в Render замените `DATABASE_URL` на строку Supabase:
```
postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres
```

### **Ошибка авторизации**
```
[ERROR] Admin access required
```
**Быстрое решение:**
```bash
npm run admin:grant -- <user_id>
```

## **Полезные ссылки**

- **Локальный сервер:** http://localhost:4000
- **Админка:** http://localhost:4000/admin
- **Supabase:** https://supabase.com/dashboard
- **Render:** https://dashboard.render.com
*Полезно:* см. также `docs/API_REFERENCE.md` и `docs/ENVIRONMENT_VARIABLES.md`.
