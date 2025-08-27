# 🛠️ Admin Scripts Reference

## **Обзор**

EDRSR-AI включает набор скриптов для административного управления системой. Скрипты находятся в `server/scripts/` (сервер) и `scripts/` (root). Их можно запускать через npm команды или напрямую через Node.js.

## **📁 Структура скриптов**

```
server/scripts/
├── create-admin.js              # Создание админа через Supabase Auth API
├── create-admin-simple.js       # Прямое назначение роли админа в БД
├── transfer-jobs-to-user.js     # Перенос заданий между пользователями
├── transfer-jobs-to-user.sql    # SQL скрипт для переноса данных
└── (root)/scripts/apply-rls.js  # Применение Row Level Security
├── memory-load-test.js          # Тест нагрузки памяти
├── test-race-condition-fix.js   # Тест race conditions
└── reset-user-password.js       # Сброс пароля пользователя
```

## **🔐 Управление администраторами**

### **1. Создание администратора через Supabase Auth API**

**Файл:** `server/scripts/create-admin.js`

**Команда:**
```bash
cd server
npm run admin:create
```

**Что делает:**
- Создает пользователя в Supabase Auth
- Назначает роль `admin` в таблице `user_roles`
- Использует `SUPABASE_SERVICE_ROLE_KEY`

**Требования:**
```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_URL=https://your-project.supabase.co
```

**Пример вывода:**
```
✅ Администратор успешно создан!
📧 Email: admin@example.com
🔑 Пароль: generated_password
🆔 User ID: uuid_here
```

### **2. Прямое назначение роли администратора**

**Файл:** `server/scripts/create-admin-simple.js`

**Команда:**
```bash
cd server
npm run admin:grant
```

**Что делает:**
- Обходит проблемы с Supabase Auth Admin API
- Прямо обновляет таблицу `user_roles` в PostgreSQL
- Более надежный способ назначения ролей

**Требования:**
```env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
```

**Пример вывода:**
```
✅ Роль администратора успешно назначена!
👤 Пользователь: user@example.com
🆔 User ID: uuid_here
🔐 Роль: admin
```

## **🔄 Перенос данных между пользователями**

### **3. Перенос всех заданий к пользователю**

**Файл:** `server/scripts/transfer-jobs-to-user.js`

**Команда:**
```bash
cd server
npm run transfer:jobs user@example.com
```

**Что делает:**
- ✅ Найдет пользователя по email в Supabase Auth
- ✅ Покажет сколько данных нужно перенести
- ✅ Перенесет все задания, ссылки, результаты и чат-сообщения к этому пользователю
- ✅ Покажет итоговую статистику

**Требования:**
```env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

**Пример вывода:**
```
🔍 Поиск пользователя: user@example.com
✅ Пользователь найден: user@example.com (uuid_here)

📊 Данные для переноса:
- Задания: 15
- Ссылки: 150
- Результаты: 15
- Чат-сообщения: 45
- Проанализированные дела: 120

🔄 Начинаю перенос...
✅ Перенос завершен!

📈 Итоговая статистика:
- Перенесено заданий: 15
- Перенесено ссылок: 150
- Перенесено результатов: 15
- Перенесено сообщений: 45
- Перенесено дел: 120
```

### **4. SQL скрипт для переноса данных**

**Файл:** `server/scripts/transfer-jobs-to-user.sql`

**Использование:**
1. Открыть Supabase SQL Editor
2. Заменить `'USER_ID_HERE'` на реальный UUID пользователя
3. Выполнить скрипт

**Содержимое:**
```sql
-- Перенос всех данных к указанному пользователю
UPDATE jobs SET user_id = 'USER_ID_HERE' WHERE user_id IS NULL;
UPDATE job_links SET user_id = 'USER_ID_HERE' WHERE user_id IS NULL;
UPDATE job_results SET user_id = 'USER_ID_HERE' WHERE user_id IS NULL;
UPDATE chat_messages SET user_id = 'USER_ID_HERE' WHERE user_id IS NULL;
UPDATE parsed_cases SET user_id = 'USER_ID_HERE' WHERE user_id IS NULL;
```

## **🔒 Безопасность и RLS**

### **5. Применение Row Level Security**

**Файл:** `scripts/apply-rls.js` (в корне)

**Команда:**
```bash
npm run apply:rls
```

**Что делает:**
- Включает RLS на всех таблицах
- Создает политики доступа
- Обеспечивает изоляцию данных пользователей

**Требования:**
```env
DATABASE_URL=postgresql://...
```

## **🧪 Тестирование и производительность**

### **6. Тест нагрузки памяти**

**Файл:** `server/scripts/memory-load-test.js`

**Команда:**
```bash
cd server
node scripts/memory-load-test.js
```

**Что делает:**
- Симулирует нагрузку на систему
- Мониторит использование памяти
- Проверяет стабильность при длительной работе

### **7. Тест race conditions**

**Файл:** `server/scripts/test-race-condition-fix.js`

**Команда:**
```bash
cd server
node scripts/test-race-condition-fix.js
```

**Что делает:**
- Тестирует обработку конкурентных запросов

## **🔧 Утилиты**

### **8. Сброс пароля пользователя**

**Файл:** `server/scripts/reset-user-password.js`

**Команда:**
```bash
cd server
node scripts/reset-user-password.js user@example.com
```

**Что делает:**
- Сбрасывает пароль пользователя
- Генерирует новый временный пароль
- Отправляет уведомление (если настроено)

## **📋 Полный список npm команд**

### **Корневые команды:**
```bash
npm run admin:create          # Создание админа через Supabase Auth
npm run admin:grant           # Прямое назначение роли админа
npm run transfer:jobs         # Перенос заданий к пользователю
```

### **Прямое выполнение скриптов:**
```bash
cd server

# Администрирование
node scripts/create-admin.js
node scripts/create-admin-simple.js
node scripts/transfer-jobs-to-user.js user@example.com

# Безопасность
node scripts/apply-rls.js

# Тестирование
node scripts/memory-load-test.js
node scripts/test-race-condition-fix.js

# Утилиты
node scripts/reset-user-password.js user@example.com
```

## **⚙️ Конфигурация скриптов**

### **Переменные окружения для всех скриптов:**

```env
# Обязательные
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co

# Для админских скриптов
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key

# Для скриптов переноса
GEMINI_API_KEY=your_gemini_key
```

### **Настройки в package.json:**

```json
{
  "scripts": {
    "admin:create": "node scripts/create-admin.js",
    "admin:grant": "node scripts/create-admin-simple.js",
    "transfer:jobs": "node scripts/transfer-jobs-to-user.js"
  }
}
```

## **🚨 Устранение неполадок**

### **Ошибка "Variable not set":**
```bash
# Проверить .env файл
cat .env

# Проверить что находитесь в папке server
pwd

# Скопировать из примера
cp .env.example .env
```

### **Ошибка "Permission denied":**
```bash
# Проверить права на папку scripts
ls -la scripts/

# Исправить права если нужно
chmod 755 scripts/
chmod +x scripts/*.js
```

### **Ошибка "Module not found":**
```bash
# Установить зависимости
npm install

# Проверить что node_modules существует
ls -la node_modules/
```

### **Ошибка подключения к базе данных:**
```bash
# Проверить DATABASE_URL
echo $DATABASE_URL

# Проверить подключение
node -e "require('pg').Client({connectionString: process.env.DATABASE_URL}).connect().then(() => console.log('Connected')).catch(console.error)"
```

## **📊 Мониторинг выполнения скриптов**

### **Логи скриптов:**
Все скрипты логируют свои действия в консоль и могут быть перенаправлены в файл:

```bash
# Логирование в файл
npm run admin:create > admin-creation.log 2>&1

# Логирование с временной меткой
npm run transfer:jobs user@example.com 2>&1 | tee transfer-$(date +%Y%m%d-%H%M%S).log
```

### **Проверка результатов:**
```bash
# Проверить роли пользователей
psql $DATABASE_URL -c "SELECT * FROM user_roles;"

# Проверить количество заданий у пользователя
psql $DATABASE_URL -c "SELECT COUNT(*) FROM jobs WHERE user_id = 'USER_UUID';"
```

## **🔐 Безопасность выполнения**

### **Рекомендации:**
1. **Выполняйте скрипты только в доверенной среде**
2. **Проверяйте права доступа перед выполнением**
3. **Делайте резервные копии перед массовыми изменениями**
4. **Логируйте все административные действия**

### **Проверка перед выполнением:**
```bash
# Проверить текущего пользователя
whoami

# Проверить права на папку
ls -la

# Проверить переменные окружения
env | grep -E "(DATABASE_URL|SUPABASE)"
```

## **📚 Дополнительные ресурсы**

- [PROJECT_COMMANDS.md](./PROJECT_COMMANDS.md) - Полное руководство по командам
- [NPM_SCRIPTS.md](./NPM_SCRIPTS.md) - Справочник по npm скриптам
- [API_REFERENCE.md](./API_REFERENCE.md) - Документация API
- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) - Переменные окружения
