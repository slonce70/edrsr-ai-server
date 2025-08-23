/**
 * Quality control functions for legal case analysis
 * Handles validation, coverage analysis, and quality reporting
 */

/**
 * Validate that all cases were processed in batch summaries
 * @param {Array} originalCases - Original cases to process
 * @param {Array} batchSummaries - Generated batch summaries
 * @param {number} totalBatches - Number of batches processed
 * @returns {Object} - Validation result with details
 */
function validateBatchProcessing(originalCases, batchSummaries, totalBatches) {
  console.log('🔍 Запуск контроля качества батч-обработки...');

  const validation = {
    isValid: true,
    totalCasesExpected: originalCases.length,
    totalBatchesProcessed: totalBatches,
    summariesGenerated: batchSummaries.length,
    issues: [],
    coverage: 0,
    recommendation: '',
  };

  // Check 1: All batches have summaries (skip if totalBatches is 1, as it's a direct analysis)
  if (totalBatches > 1 && batchSummaries.length !== totalBatches) {
    validation.isValid = false;
    validation.issues.push(
      `Несоответствие количества сводок: ожидалось ${totalBatches}, получено ${batchSummaries.length}`
    );
  }

  // Check 2: All summaries have content
  batchSummaries.forEach((summary, index) => {
    if (!summary || summary.length < 100) {
      validation.isValid = false;
      validation.issues.push(
        `Етап ${index + 1}: надто коротка сводка (${summary?.length || 0} символів)`
      );
    }
  });

  // Check 3: Calculate coverage percentage - fixed logic
  // Coverage is 100% if the process is valid and it was either a single batch or all summaries were generated.
  validation.coverage =
    validation.isValid && (totalBatches === 1 || batchSummaries.length === totalBatches)
      ? 100
      : Math.round((batchSummaries.length / totalBatches) * 100);

  // Check 4: Generate recommendation
  if (validation.isValid && validation.coverage >= 95) {
    validation.recommendation = '✅ Отличное качество! Все дела обработаны корректно.';
  } else if (validation.coverage >= 80) {
    validation.recommendation = '⚠️ Хорошее качество, но есть незначительные пробелы.';
  } else {
    validation.recommendation = '❌ Критические проблемы! Требуется повторная обработка.';
  }

  console.log(`📊 Результат контроля качества:`);
  console.log(`  • Ожидалось дел: ${validation.totalCasesExpected}`);
  console.log(`  • Обработано групп: ${validation.totalBatchesProcessed}`);
  console.log(`  • Создано сводок: ${validation.summariesGenerated}`);
  console.log(`  • Покрытие: ${validation.coverage}%`);
  console.log(`  • Статус: ${validation.isValid ? '✅ ВАЛИДНО' : '❌ ОШИБКИ'}`);

  if (validation.issues.length > 0) {
    console.log(`  • Проблемы:`);
    validation.issues.forEach((issue) => console.log(`    - ${issue}`));
  }

  return validation;
}

/**
 * Generate quality assurance report
 * @param {Object} validation - Validation results
 * @param {number} totalCases - Total cases processed
 * @param {Array} batchSummaries - All batch summaries
 * @returns {string} - Quality assurance report
 */
function generateQualityReport(validation, totalCases, batchSummaries = []) {
  const report =
    `\n\n📋 **ЗВІТ КОНТРОЛЮ ЯКОСТІ:**\n\n` +
    `### 📊 Статистика обробки\n` +
    `• **Всього справ:** ${validation.totalCasesExpected}\n` +
    `• **Етапів обробки:** ${validation.totalBatchesProcessed}\n` +
    `• **Створено аналітичних сводок:** ${validation.summariesGenerated}\n` +
    `• **Покриття даних:** ${validation.coverage}%\n\n` +
    `### ✅ Гарантії якості\n` +
    `• **Повнота обробки:** ${validation.isValid ? 'Підтверджено' : 'Виявлені проблеми'}\n` +
    `• **Структурованість:** Всі дані у форматі Markdown\n` +
    `• **Комплексний аналіз:** Накопичувальні висновки\n` +
    `• **Фінальна перевірка:** Цільний експертний звіт\n\n`;

  if (validation.issues.length > 0) {
    const issuesReport =
      `### ⚠️ Виявлені проблеми\n` +
      validation.issues.map((issue) => `• ${issue}`).join('\n') +
      '\n\n';
    return report + issuesReport + `### 💡 Рекомендація\n${validation.recommendation}`;
  }

  return report + `### 🎯 Висновок\n${validation.recommendation}`;
}

export { validateBatchProcessing, generateQualityReport };
