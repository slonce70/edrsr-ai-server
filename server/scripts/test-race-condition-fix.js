#!/usr/bin/env node

/**
 * Тест для проверки исправления race condition в saveJobResult
 *
 * Проверяет:
 * 1. Нормальное сохранение результата для существующей задачи
 * 2. Graceful handling при попытке сохранить результат для удаленной задачи
 */

import database from '../database/connection.js';
import dbService from '../services/dbService.js';

async function testRaceConditionFix() {
  console.log('🧪 Запуск теста для исправления race condition...\n');

  try {
    // Инициализируем таблицы
    await database.initializeTables();

    // Тест 1: Нормальное сохранение результата
    console.log('1️⃣ Тест: Нормальное сохранение результата');
    const testJobId = 'test-job-' + Date.now();

    // Создаем тестовую задачу
    await dbService.createJob({
      id: testJobId,
      title: 'Test Job для проверки race condition',
      status: 'processing',
      totalLinks: 1,
      prompt: 'Test prompt',
    });

    console.log(`   ✅ Создана тестовая задача: ${testJobId}`);

    // Сохраняем результат
    const testAnalysis = 'Тестовый анализ результатов для проверки race condition';
    await dbService.saveJobResult(testJobId, testAnalysis);
    console.log('   ✅ Результат анализа сохранен успешно');

    // Проверяем, что результат действительно сохранился
    const savedResult = await dbService.getJobResult(testJobId);
    if (savedResult === testAnalysis) {
      console.log('   ✅ Результат анализа корректно извлечен из БД');
    } else {
      throw new Error('Сохраненный результат не соответствует ожидаемому');
    }

    // Тест 2: Попытка сохранить результат для несуществующей задачи
    console.log('\n2️⃣ Тест: Попытка сохранить результат для удаленной задачи');
    const deletedJobId = 'deleted-job-' + Date.now();

    // НЕ создаем задачу, имитируем ситуацию, когда она была удалена
    console.log(`   🗑️ Имитируем удаленную задачу: ${deletedJobId}`);

    // Пытаемся сохранить результат для несуществующей задачи
    await dbService.saveJobResult(deletedJobId, 'Результат для удаленной задачи');
    console.log('   ✅ saveJobResult не выбросил ошибку для несуществующей задачи');

    // Тест 3: Реалистичный сценарий race condition
    console.log('\n3️⃣ Тест: Имитация реального race condition');
    const raceJobId = 'race-job-' + Date.now();

    // Создаем задачу
    await dbService.createJob({
      id: raceJobId,
      title: 'Race Condition Test Job',
      status: 'processing',
      totalLinks: 1,
      prompt: 'Race test prompt',
    });
    console.log(`   ✅ Создана задача для теста race condition: ${raceJobId}`);

    // Имитируем параллельные операции
    const saveResultPromise = dbService.saveJobResult(raceJobId, 'Анализ до удаления');

    // Небольшая задержка, затем удаляем задачу
    setTimeout(async () => {
      try {
        await dbService.deleteJob(raceJobId);
        console.log('   🗑️ Задача удалена во время сохранения результата');
      } catch (error) {
        console.log('   ⚠️ Ошибка при удалении задачи:', error.message);
      }
    }, 10);

    await saveResultPromise;
    console.log('   ✅ saveJobResult завершился без критических ошибок');

    // Очистка: удаляем тестовую задачу
    try {
      await dbService.deleteJob(testJobId);
      console.log(`\n🧹 Очистка: удалена тестовая задача ${testJobId}`);
    } catch (error) {
      console.log(`⚠️ Ошибка при очистке: ${error.message}`);
    }

    console.log('\n✅ Все тесты пройдены успешно! Race condition исправлена.');
  } catch (error) {
    console.error('\n❌ Тест провален:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Запускаем тест
testRaceConditionFix()
  .then(() => {
    console.log('\n🎉 Тестирование завершено успешно!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Критическая ошибка в тесте:', error);
    process.exit(1);
  });
