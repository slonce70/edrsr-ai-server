#!/usr/bin/env node

/**
 * Скрипт для создания первого администратора системы
 * Использование: node scripts/create-admin.js <email>
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import database from '../database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
config({ path: path.join(__dirname, '../.env') });
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function createFirstAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Ошибка: Укажите email администратора');
    console.log('Использование: node scripts/create-admin.js admin@example.com');
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      '❌ Ошибка: Не настроены переменные окружения SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY'
    );
    process.exit(1);
  }

  try {
    // Initialize database tables
    await database.initializeTables();
    console.log('✅ Таблицы базы данных инициализированы');

    // Create Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if user exists
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      throw new Error('Ошибка получения списка пользователей: ' + listError.message);
    }

    const existingUser = users.users.find((user) => user.email === email);
    let userId;

    if (existingUser) {
      userId = existingUser.id;
      console.log(`✅ Пользователь ${email} уже существует (ID: ${userId})`);
    } else {
      console.log(`📧 Пользователь ${email} не найден. Создание нового пользователя...`);

      // Generate a temporary password
      const tempPassword = generateTempPassword();

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true, // Auto-confirm email
      });

      if (createError) {
        throw new Error('Ошибка создания пользователя: ' + createError.message);
      }

      userId = newUser.user.id;
      console.log(`✅ Пользователь создан (ID: ${userId})`);
      console.log(`🔑 Временный пароль: ${tempPassword}`);
      console.log(`⚠️  Обязательно смените пароль после первого входа!`);
    }

    // Check if user is already admin
    const existingAdmin = await database.get(
      'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
      [userId, 'admin']
    );

    if (existingAdmin) {
      console.log(`✅ Пользователь ${email} уже является администратором`);
    } else {
      // Grant admin role
      await database.run(
        'INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $1) ON CONFLICT (user_id, role) DO NOTHING',
        [userId, 'admin']
      );
      console.log(`✅ Права администратора предоставлены пользователю ${email}`);
    }

    console.log('\n🎉 Настройка администратора завершена!');
    console.log(
      `📍 Админская панель доступна по адресу: http://localhost:${process.env.PORT || 4000}/admin`
    );
    console.log(`📧 Email: ${email}`);

    if (!existingUser) {
      console.log(`🔑 Пароль: ${tempPassword} (смените после первого входа)`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка создания администратора:', error.message);
    process.exit(1);
  }
}

function generateTempPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Run the script
createFirstAdmin();
