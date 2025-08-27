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

# Логин: <your-admin-email>
# Пароль: <your-admin-password>
```

### **Сборка расширения**
```bash
# Сборка для production
npm run build:extension

# Результат: папка extension-build/ + ZIP файл
```

## **Административные команды**

### **Управление пользователями**
```bash
cd server

# Создать админа
npm run admin:create

# Назначить права админа
npm run admin:grant

# Перенести все задания к пользователю
npm run transfer:jobs user@example.com
```

### **Проверка системы**
```bash
# Проверить здоровье сервера
curl http://localhost:4000/api/health/full

# Проверить статистику админки
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:4000/api/admin/dashboard
```

## **Deployment**

### **Обновление на Render**
```bash
# Закоммитить изменения
git add .
git commit -m "Update description"
git push origin main

# Render автоматически деплоит
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
**Быстрое решение:** В Render замените `DATABASE_URL` на строку подключения Supabase в формате:
```
postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres
```

### **Ошибка авторизации**
```
[ERROR] Admin access required
```
**Быстрое решение:**
```bash
cd server
npm run admin:grant
```

## **Полезные ссылки**

- **Локальный сервер:** http://localhost:4000
- **Админка:** http://localhost:4000/admin
- **Supabase:** https://supabase.com/dashboard
- **Render:** https://dashboard.render.com
- **Индекс документации:** [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)
