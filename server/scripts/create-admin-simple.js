#!/usr/bin/env node

/**
 * Простой скрипт для создания администратора (напрямую в базе)
 * Использование: node scripts/create-admin-simple.js <user_id>
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import database from '../database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
config({ path: path.join(__dirname, '../.env') });

async function createAdminFromUserId() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('❌ Ошибка: Укажите ID пользователя');
    console.log('Использование: node scripts/create-admin-simple.js <user_id>');
    console.log('Пример: node scripts/create-admin-simple.js 12345678-1234-1234-1234-123456789012');
    process.exit(1);
  }

  try {
    // Initialize database tables
    await database.initializeTables();
    console.log('✅ Таблицы базы данных инициализированы');

    // Check if user is already admin
    const existingAdmin = await database.get(
      'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
      [userId, 'admin']
    );

    if (existingAdmin) {
      console.log(`✅ Пользователь ${userId} уже является администратором`);
    } else {
      // Grant admin role
      await database.run(
        'INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $1) ON CONFLICT (user_id, role) DO NOTHING',
        [userId, 'admin']
      );
      console.log(`✅ Права администратора предоставлены пользователю ${userId}`);
    }

    console.log('\n🎉 Настройка администратора завершена!');
    console.log(
      `📍 Админская панель доступна по адресу: http://localhost:${process.env.PORT || 4000}/admin`
    );
    console.log(`👤 User ID: ${userId}`);
    console.log(
      `💡 Пользователь сможет войти в админку используя свой обычный email/пароль из расширения`
    );

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка создания администратора:', error.message);
    process.exit(1);
  }
}

// Run the script
createAdminFromUserId();
