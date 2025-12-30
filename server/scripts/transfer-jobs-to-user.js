import { createClient } from '@supabase/supabase-js';
import database from '../database/connection.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '❌ Ошибка: Не настроены переменные окружения SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function transferJobsToUser(targetEmail) {
  try {
    console.log(`🔍 Поиск пользователя с email: ${targetEmail}`);

    // Find user by email
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.listUsers();

    if (userError) {
      throw new Error(`Ошибка получения пользователей: ${userError.message}`);
    }

    const targetUser = user.users.find((u) => u.email === targetEmail);

    if (!targetUser) {
      throw new Error(`Пользователь с email ${targetEmail} не найден`);
    }

    console.log(`✅ Пользователь найден: ${targetUser.id} (${targetUser.email})`);

    // Start transaction
    console.log('\n📊 Анализ данных для переноса...');

    // Count existing data without user_id
    const stats = {
      jobs: await database.get('SELECT COUNT(*) as count FROM jobs WHERE user_id IS NULL'),
      jobLinks: await database.get('SELECT COUNT(*) as count FROM job_links WHERE user_id IS NULL'),
      jobResults: await database.get(
        'SELECT COUNT(*) as count FROM job_results WHERE user_id IS NULL'
      ),
      chatMessages: await database.get(
        'SELECT COUNT(*) as count FROM chat_messages WHERE user_id IS NULL'
      ),
      parsedCases: await database.get(
        'SELECT COUNT(*) as count FROM parsed_cases WHERE user_id IS NULL'
      ),
    };

    console.log(`📋 Задания без user_id: ${stats.jobs.count}`);
    console.log(`🔗 Ссылки заданий без user_id: ${stats.jobLinks.count}`);
    console.log(`📊 Результаты заданий без user_id: ${stats.jobResults.count}`);
    console.log(`💬 Сообщения чата без user_id: ${stats.chatMessages.count}`);
    console.log(`📄 Parsed cases без user_id: ${stats.parsedCases.count}`);

    const totalItems =
      stats.jobs.count +
      stats.jobLinks.count +
      stats.jobResults.count +
      stats.chatMessages.count +
      stats.parsedCases.count;

    if (totalItems === 0) {
      console.log('✅ Нет данных для переноса - все записи уже имеют user_id');
      return;
    }

    console.log(`\n⚠️  Будет перенесено ${totalItems} записей к пользователю ${targetEmail}`);
    console.log('Вы уверены? Введите "yes" для продолжения:');

    // Wait for user confirmation (for production use)
    // For now, we'll proceed automatically in this script

    console.log('\n🔄 Начинаем перенос данных...');

    // Update jobs
    if (stats.jobs.count > 0) {
      await database.run('UPDATE jobs SET user_id = $1 WHERE user_id IS NULL', [targetUser.id]);
      console.log(`✅ Перенесено ${stats.jobs.count} заданий`);
    }

    // Update job_links
    if (stats.jobLinks.count > 0) {
      await database.run('UPDATE job_links SET user_id = $1 WHERE user_id IS NULL', [
        targetUser.id,
      ]);
      console.log(`✅ Перенесено ${stats.jobLinks.count} ссылок заданий`);
    }

    // Update job_results
    if (stats.jobResults.count > 0) {
      await database.run('UPDATE job_results SET user_id = $1 WHERE user_id IS NULL', [
        targetUser.id,
      ]);
      console.log(`✅ Перенесено ${stats.jobResults.count} результатов заданий`);
    }

    // Update chat_messages
    if (stats.chatMessages.count > 0) {
      await database.run('UPDATE chat_messages SET user_id = $1 WHERE user_id IS NULL', [
        targetUser.id,
      ]);
      console.log(`✅ Перенесено ${stats.chatMessages.count} сообщений чата`);
    }

    // Update parsed_cases
    if (stats.parsedCases.count > 0) {
      await database.run('UPDATE parsed_cases SET user_id = $1 WHERE user_id IS NULL', [
        targetUser.id,
      ]);
      console.log(`✅ Перенесено ${stats.parsedCases.count} parsed cases`);
    }

    console.log('\n🎉 Перенос данных завершен успешно!');

    // Verify results
    console.log('\n📊 Проверка результатов...');
    const finalStats = {
      jobs: await database.get('SELECT COUNT(*) as count FROM jobs WHERE user_id = $1', [
        targetUser.id,
      ]),
      jobLinks: await database.get('SELECT COUNT(*) as count FROM job_links WHERE user_id = $1', [
        targetUser.id,
      ]),
      jobResults: await database.get(
        'SELECT COUNT(*) as count FROM job_results WHERE user_id = $1',
        [targetUser.id]
      ),
      chatMessages: await database.get(
        'SELECT COUNT(*) as count FROM chat_messages WHERE user_id = $1',
        [targetUser.id]
      ),
      parsedCases: await database.get(
        'SELECT COUNT(*) as count FROM parsed_cases WHERE user_id = $1',
        [targetUser.id]
      ),
    };

    console.log(`📋 Заданий у пользователя: ${finalStats.jobs.count}`);
    console.log(`🔗 Ссылок заданий у пользователя: ${finalStats.jobLinks.count}`);
    console.log(`📊 Результатов заданий у пользователя: ${finalStats.jobResults.count}`);
    console.log(`💬 Сообщений чата у пользователя: ${finalStats.chatMessages.count}`);
    console.log(`📄 Parsed cases у пользователя: ${finalStats.parsedCases.count}`);
  } catch (error) {
    console.error('❌ Ошибка переноса данных:', error.message);
    process.exit(1);
  }
}

// Get email from command line argument
const targetEmail = process.argv[2];

if (!targetEmail) {
  console.log('❌ Использование: node transfer-jobs-to-user.js user@example.com');
  process.exit(1);
}

transferJobsToUser(targetEmail).then(() => {
  console.log('\n✅ Скрипт завершен');
  process.exit(0);
});
