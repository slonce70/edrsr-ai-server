# 📦 NPM Scripts Reference

## **📋 Полный список всех доступных скриптов**

### **Корневые скрипты (из папки проекта)**
```bash
# Разработка
npm run dev                    # Запуск сервера разработки
npm run start:gc              # Запуск с garbage collection
npm run test:memory           # Тест нагрузки памяти

# Сборка
npm run build:extension        # Сборка Chrome расширения

# Качество кода
npm run lint                   # Проверка ESLint
npm run lint:fix               # Автоматическое исправление ESLint
npm run format                 # Форматирование Prettier
npm run format:check           # Проверка форматирования
npm run quality:check          # Полная проверка качества
npm run quality:fix            # Автоматическое исправление качества

# Администрирование
npm run admin:create          # Создание администратора
npm run admin:grant           # Назначение роли админа
npm run apply:rls             # Применение Row Level Security

# Серверные команды
npm run lint:server           # Проверка ESLint сервера
npm run format:server         # Форматирование сервера
```

### **Серверные скрипты (из папки server/)**
```bash
cd server

# Запуск
npm run dev                    # Запуск с nodemon
npm run start                  # Запуск в production

# Администрирование
npm run admin:create          # Создание администратора
npm run admin:grant           # Назначение роли админа
npm run transfer:jobs         # Перенос заданий к пользователю
```

## **Корневые скрипты (package.json)**

### **Разработка**
```bash
npm run dev                    # Запуск сервера разработки (порт 4000)
npm run start:gc              # Запуск с garbage collection
npm run test:memory           # Тест нагрузки памяти
```

### **Сборка расширения**
```bash
npm run build:extension        # Сборка Chrome расширения для production
# Создает папку extension-build/ и ZIP архив
```

### **Качество кода**
```bash
npm run lint                   # Проверка ESLint
npm run lint:fix               # Автоматическое исправление ESLint ошибок
npm run format                 # Форматирование Prettier
npm run format:check           # Проверка форматирования
npm run quality:check          # Полная проверка качества кода
npm run quality:fix            # Автоматическое исправление качества
```

## **Скрипты сервера (server/package.json)**

### **Запуск**
```bash
cd server
npm run dev                    # Запуск с nodemon (автоперезагрузка)
npm run start                  # Запуск в production
npm run start:gc              # Запуск с garbage collection
```

### **Администрирование**
```bash
cd server

# Создание администратора
npm run admin:create          # Создание через Supabase Auth API
npm run admin:grant           # Прямое назначение роли в БД

# Перенос данных
npm run transfer:jobs user@example.com  # Перенос всех заданий к пользователю
```

### **Корневые админские команды**
```bash
# Создание администратора (из корня проекта)
npm run admin:create          # Создание через Supabase Auth API
npm run admin:grant           # Прямое назначение роли в БД
```

### **Тестирование**
```bash
cd server
npm run test:memory           # Тест нагрузки памяти
npm run test:race             # Тест race conditions
```

### **База данных**
```bash
cd server
npm run db:migrate            # Применение миграций
npm run db:seed               # Заполнение тестовыми данными
npm run db:reset              # Сброс базы данных
npm run apply:rls             # Применение Row Level Security (из корня)
```

## **Детальное описание скриптов**

### **npm run dev**
- **Файл:** `server/index.js`
- **Описание:** Запуск сервера в режиме разработки
- **Порт:** 4000
- **Особенности:** Автоперезагрузка при изменениях, подробные логи

### **npm run build:extension**
- **Файл:** `scripts/build-extension.js`
- **Описание:** Сборка Chrome расширения для production
- **Действия:**
  - Заменяет `DEV_API_URL` на `PROD_API_URL`
  - Заменяет `DEV_WS_URL` на `PROD_WS_URL`
  - Обновляет `manifest.json`
  - Создает ZIP архив
- **Результат:** Папка `extension-build/` + ZIP файл

### **npm run admin:create**
- **Файл:** `server/scripts/create-admin.js`
- **Описание:** Создание администратора через Supabase Auth API
- **Требования:** `SUPABASE_SERVICE_ROLE_KEY` в `.env`
- **Результат:** Пользователь с ролью `admin` в таблице `user_roles`

### **npm run admin:grant**
- **Файл:** `server/scripts/create-admin-simple.js`
- **Описание:** Прямое назначение роли администратора в БД
- **Обход:** Проблем с Supabase Auth Admin API
- **Результат:** Роль `admin` в таблице `user_roles`

### **npm run transfer:jobs**
- **Файл:** `server/scripts/transfer-jobs-to-user.js`
- **Описание:** Перенос всех заданий от одного пользователя к другому
- **Действия:**
  - Поиск пользователя по email
  - Подсчет данных для переноса
  - Обновление `user_id` во всех таблицах
  - Показ статистики
- **Таблицы:** `jobs`, `job_links`, `job_results`, `chat_messages`, `parsed_cases`

## **Переменные окружения для скриптов**

### **Обязательные для всех скриптов:**
```env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### **Для админских скриптов:**
```env
SUPABASE_SERVICE_ROLE_KEY=...  # Для admin:create
```

### **Для скриптов переноса:**
```env
DATABASE_URL=postgresql://...  # Для transfer:jobs
```

## **Примеры использования**

### **Полный цикл разработки:**
```bash
# 1. Запуск сервера
npm run dev

# 2. В другом терминале - сборка расширения
npm run build:extension

# 3. Тестирование качества кода
npm run lint:fix
npm run format

# 4. Проверка памяти
cd server && npm run test:memory
```

### **Администрирование системы:**
```bash
cd server

# Создание первого админа
npm run admin:create

# Если не работает - прямое назначение
npm run admin:grant

# Перенос данных к новому пользователю
npm run transfer:jobs newuser@example.com
```

### **Deployment:**
```bash
# 1. Сборка расширения
npm run build:extension

# 2. Проверка качества
npm run lint && npm run format:check

# 3. Коммит и пуш
git add .
git commit -m "Update description"
git push origin main

# 4. Render автоматически деплоит
```

## **Устранение неполадок**

### **Ошибка "command not found"**
```bash
# Проверить что находитесь в правильной папке
pwd  # Должно быть /path/to/edrsr-ai или /path/to/edrsr-ai/server

# Установить зависимости
npm install
```

### **Ошибка переменных окружения**
```bash
# Проверить .env файл
cat .env

# Скопировать из примера
cp .env.example .env
```

### **Ошибка прав доступа**
```bash
# Проверить права на папки
ls -la

# Исправить права если нужно
chmod 755 scripts/
chmod +x scripts/*.js
```
