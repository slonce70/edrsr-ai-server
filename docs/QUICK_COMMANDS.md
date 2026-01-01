# 🚀 EDRSR-AI Quick Commands

## **Ежедневные команды**

### **Запуск и остановка**
```bash
# Запуск сервера разработки
npm run dev

# Остановка сервера
Ctrl+C

# Проверка что сервер работает (локально)
curl http://localhost:4000/api/health/light

# Проверка что сервер работает (production)
curl https://edrsr-ai-server.fun/api/health/light
```

### **Админка**
```bash
# Открыть админку в браузере (локально)
http://localhost:4000/admin

# Открыть админку в браузере (production)
https://edrsr-ai-server.fun/admin
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
curl https://edrsr-ai-server.fun/api/health/light

# Health full (admin-only)
curl -H "Authorization: Bearer YOUR_TOKEN" https://edrsr-ai-server.fun/api/health/full

# Статистика админки
curl -H "Authorization: Bearer YOUR_TOKEN" https://edrsr-ai-server.fun/api/admin/dashboard

# Ручное восстановление зависших заданий
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"grace_minutes": 10}' \
  https://edrsr-ai-server.fun/api/admin/jobs/recover-stuck
```

### **QA для AI‑отчётов**
```bash
node server/scripts/test-ai-modes.js --mode practice_overview --verbose
```

## **Deployment**

### **Systemd (production VPS)**
```bash
sudo systemctl status edrsr-ai
sudo systemctl restart edrsr-ai
sudo journalctl -u edrsr-ai -n 200 --no-pager
```

## **Устранение неполадок**

### **Ошибка подключения к БД**
```
[ERROR] SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing
```
**Быстрое решение:** проверь `DATABASE_URL`.
Для Supabase Postgres:
```
postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres
```
Для локальной БД на VPS:
```
postgresql://postgres:<password>@127.0.0.1:5432/edrsr_ai
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
- **Админка (prod):** https://edrsr-ai-server.fun/admin
- **Supabase:** https://supabase.com/dashboard
*Полезно:* см. также `docs/API_REFERENCE.md` и `docs/ENVIRONMENT_VARIABLES.md`.
