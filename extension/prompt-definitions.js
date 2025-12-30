export const PROMPT_GROUPS_I18N = {
  uk: {
    '📈 Стратегічний аналіз': {
      practice_overview: 'Огляд судової практики',
      detailed_annotation: 'Детальна анотація справи',
      statistical_analysis: 'Статистичний аналіз',
      risk_assessment: 'Аналіз правових ризиків',
    },
    '🎯 Тактична перевага': {
      competitive_intelligence: 'Аналіз стратегій та тактик',
      evidence_analysis: 'Аналіз доказової бази',
      procedural_violations: 'Аналіз процесуальних порушень',
    },
    '👥 Для клієнта': {
      client_explanation: 'Пояснення для клієнта',
    },
    '✍️ Індивідуальний': {
      custom: 'Свій варіант',
    },
  },
  ru: {
    '📈 Стратегический анализ': {
      practice_overview: 'Обзор судебной практики',
      detailed_annotation: 'Детальная аннотация дела',
      statistical_analysis: 'Статистический анализ',
      risk_assessment: 'Анализ правовых рисков',
    },
    '🎯 Тактическое преимущество': {
      competitive_intelligence: 'Анализ стратегий и тактик',
      evidence_analysis: 'Анализ доказательной базы',
      procedural_violations: 'Анализ процессуальных нарушений',
    },
    '👥 Для клиента': {
      client_explanation: 'Объяснение для клиента',
    },
    '✍️ Индивидуальный': {
      custom: 'Свой вариант',
    },
  },
};

export const PROMPT_DESCRIPTIONS_I18N = {
  uk: {
    practice_overview:
      'Створює загальний огляд судової практики, виявляє тенденції та ключові правові позиції по всій вибірці.',
    detailed_annotation:
      'Робить глибокий аналіз КОЖНОЇ справи окремо, з детальною структурою: сторони, аргументи, висновки суду.',
    statistical_analysis:
      'Розраховує статистику по справах: відсоток задоволених/відхилених позовів, найчастіші статті, географічний розподіл.',
    risk_assessment:
      'Аналізує типові помилки та визначає процесуальні й матеріально-правові ризики для учасників подібних справ.',
    competitive_intelligence:
      'Досліджує успішні та програшні тактики сторін, їхні сильні та слабкі аргументи.',
    evidence_analysis:
      'Аналізує, які докази суди вважають найбільш вагомими, а які відхиляють, та чому.',
    procedural_violations:
      'Фокусується на пошуку та систематизації процесуальних порушень, допущених сторонами або судом.',
    client_explanation:
      'Перекладає складний юридичний аналіз на просту мову, зрозумілу для клієнта, з оцінкою шансів та планом дій.',
    custom: 'Дозволяє ввести власний, унікальний запит для аналізу, ігноруючи стандартні шаблони.',
  },
  ru: {
    practice_overview:
      'Создаёт общий обзор судебной практики, выявляет тенденции и ключевые правовые позиции по всей выборке.',
    detailed_annotation:
      'Делает глубокий анализ КАЖДОГО дела отдельно, с детальной структурой: стороны, аргументы, выводы суда.',
    statistical_analysis:
      'Рассчитывает статистику по делам: процент удовлетворённых/отклонённых исков, самые частые статьи, географическое распределение.',
    risk_assessment:
      'Анализирует типовые ошибки и определяет процессуальные и материально-правовые риски для участников подобных дел.',
    competitive_intelligence:
      'Исследует успешные и проигрышные тактики сторон, их сильные и слабые аргументы.',
    evidence_analysis:
      'Анализирует, какие доказательства суды считают наиболее весомыми, а какие отклоняют, и почему.',
    procedural_violations:
      'Фокусируется на поиске и систематизации процессуальных нарушений, допущенных сторонами или судом.',
    client_explanation:
      'Переводит сложный юридический анализ на простой язык, понятный клиенту, с оценкой шансов и планом действий.',
    custom:
      'Позволяет ввести собственный, уникальный запрос для анализа, игнорируя стандартные шаблоны.',
  },
};

export const PROMPT_GROUPS = PROMPT_GROUPS_I18N.uk;
export const PROMPT_DESCRIPTIONS = PROMPT_DESCRIPTIONS_I18N.uk;

export function getPromptGroupLabels(locale = 'uk') {
  return PROMPT_GROUPS_I18N[locale] || PROMPT_GROUPS_I18N.uk;
}

export function getPromptDescriptions(locale = 'uk') {
  return PROMPT_DESCRIPTIONS_I18N[locale] || PROMPT_DESCRIPTIONS_I18N.uk;
}

export function getPromptName(promptKey) {
  if (!promptKey || promptKey === 'custom') {
    return 'Аналітичний звіт юриста (індивідуальний запит)';
  }

  for (const group in PROMPT_GROUPS) {
    if (PROMPT_GROUPS[group][promptKey]) {
      return PROMPT_GROUPS[group][promptKey];
    }
  }

  return 'Аналітичний звіт юриста'; // Fallback
}
