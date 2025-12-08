import got from 'got';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import 'dotenv/config';
import dbService from './services/dbService.js'; // Import the dbService
import { isValidEDRSRUrl } from './utils.js';

// const limit = pLimit(parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 1); // Removed for sequential processing
const requestDelay = parseInt(process.env.REQUEST_DELAY_MS) || 1000;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CASE_TIMEOUT_MS = parsePositiveInt(
  process.env.CASE_TIMEOUT_MS ||
    process.env.FETCH_CASE_TIMEOUT_MS ||
    process.env.OVERALL_REQUEST_TIMEOUT_MS,
  30000
);

// Defensive guards against bad/huge pages
const MAX_HTML_BYTES = parseInt(process.env.MAX_HTML_BYTES, 10) || 3_500_000; // ~3.5 MB
const MAX_SCRIPT_TAGS = parseInt(process.env.MAX_SCRIPT_TAGS, 10) || 200;
const MAX_HTML_LINE_LENGTH = parseInt(process.env.MAX_HTML_LINE_LENGTH, 10) || 200_000;
const MAX_JS_KEYWORDS = parseInt(process.env.MAX_JS_KEYWORDS, 10) || 1500; // occurrences of "function("

// Предкомпилированные регулярные выражения для производительности
const COMPILED_REGEX = {
  // Case metadata
  caseNumber: /(?:справи|справа)\s№\s*([0-9-кс/]+)/,
  dateEffective: /Дата набрання законної сили:\s*(\d{2}\.\d{2}\.\d{4})/,
  dateRegistered: /Зареєстровано:\s*(\d{2}\.\d{2}\.\d{4})/,

  // Legal articles (создаем новые экземпляры для каждого использования)
  ukArticles: () =>
    /стать[яі]\s*(\d+(?:\.\d+)?)\s*(?:УК|Уголовного\s*кодекса|Кримінального\s*кодекса)/gi,
  gkArticles: () =>
    /стать[яі]\s*(\d+(?:\.\d+)?)\s*(?:ГК|Гражданского\s*кодекса|Цивільного\s*кодекса)/gi,
  kasArticles: () =>
    /стать[яі]\s*(\d+(?:\.\d+)?)\s*(?:КАС|Кодекса\s*адміністративного\s*судочинства)/gi,
  gpkArticles: () =>
    /стать[яі]\s*(\d+(?:\.\d+)?)\s*(?:ГПК|Цивільного\s*процесуального\s*кодекса)/gi,
  kpkArticles: () =>
    /стать[яі]\s*(\d+(?:\.\d+)?)\s*(?:КПК|Кримінального\s*процесуального\s*кодекса)/gi,

  // Financial amounts
  uahAmounts: () => /(\d+(?:\s*\d+)*(?:[.,]\d+)?)\s*(?:грн|гривен[ьи]?|UAH)/gi,
  usdAmounts: () => /(\d+(?:\s*\d+)*(?:[.,]\d+)?)\s*(?:USD|доларів?|долларов?)/gi,

  // Parties
  plaintiffs: () => /позивач[іи]?\s*[:-]?\s*([А-ЯҐЄІЇ][а-яґєіїй\s.'-]+)/gi,
  defendants: () => /відповідач[іи]?\s*[:-]?\s*([А-ЯҐЄІЇ][а-яґєіїй\s.'-]+)/gi,

  // Case types keywords
  criminal: /кримінальн|обвинувач|підозрюван|злочин/i,
  administrative: /адміністративн|оскарження рішень|органи державної влади|бездіяльність/i,
  labor: /трудов|роботодавець|працівник|звільнення/i,
  family: /розлучення|аліменти|батьківські права|шлюб/i,
  commercial: /господарськ|комерційн|підприємств|договір постач/i,
  property: /нерухомість|квартира|будинок|земельна ділянка/i,
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeByteLength(str) {
  try {
    return Buffer.byteLength(str, 'utf8');
  } catch {
    return str?.length || 0;
  }
}

// Heuristic checks to skip obviously broken or hazardous pages
function analyzeRawHtmlForHazards(rawHtml) {
  // 1) Quick size check
  const bytes = safeByteLength(rawHtml);
  if (bytes > MAX_HTML_BYTES) {
    return { skip: true, reason: `HTML too large: ${bytes} bytes > ${MAX_HTML_BYTES}` };
  }

  // 2) Count <script> occurrences without allocating huge arrays
  let scriptCount = 0;
  {
    const re = /<script\b/gi;
    while (re.exec(rawHtml)) {
      scriptCount++;
      if (scriptCount > MAX_SCRIPT_TAGS) {
        return { skip: true, reason: `Too many <script> tags: ${scriptCount}` };
      }
    }
  }

  // 3) Max line length check to catch minified/bad pages
  // Scan manually to avoid splitting into an array of lines
  let currentLineLen = 0;
  for (let i = 0; i < rawHtml.length; i++) {
    const ch = rawHtml.charCodeAt(i);
    if (ch === 10 /* \n */ || ch === 13 /* \r */) {
      if (currentLineLen > MAX_HTML_LINE_LENGTH) {
        return { skip: true, reason: `Overlong HTML line: ${currentLineLen} chars` };
      }
      currentLineLen = 0;
    } else {
      currentLineLen++;
      if (currentLineLen > MAX_HTML_LINE_LENGTH) {
        return { skip: true, reason: `Overlong HTML line: ${currentLineLen} chars` };
      }
    }
  }

  // 4) Excessive JS keyword density
  let funcCount = 0;
  {
    const reFunc = /function\s*\(/gi;
    let m;
    while ((m = reFunc.exec(rawHtml))) {
      funcCount++;
      if (funcCount > MAX_JS_KEYWORDS) {
        return { skip: true, reason: `Too many JS functions: ${funcCount}` };
      }
    }
  }

  return { skip: false };
}

function detectCharset(buffer, contentTypeHeader = '') {
  const DEFAULT_CHARSET = 'utf-8';
  if (!buffer) return DEFAULT_CHARSET;

  const headerMatch = contentTypeHeader.match(/charset=([^;]+)/i);
  if (headerMatch) {
    const candidate = headerMatch[1].trim().toLowerCase();
    if (candidate && iconv.encodingExists(candidate)) {
      return candidate;
    }
  }

  const snippet = buffer.toString('ascii', 0, Math.min(buffer.length, 2048)).replace(/\s+/g, ' ');

  const metaCharsetMatch = snippet.match(/<meta[^>]+charset=['"]?([^\s"'>]+)/i);
  if (metaCharsetMatch) {
    const candidate = metaCharsetMatch[1].trim().toLowerCase();
    if (candidate && iconv.encodingExists(candidate)) {
      return candidate;
    }
  }

  const httpEquivMatch = snippet.match(/<meta[^>]+content=['"][^>]*charset=([^"'>\s]+)/i);
  if (httpEquivMatch) {
    const candidate = httpEquivMatch[1].trim().toLowerCase();
    if (candidate && iconv.encodingExists(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_CHARSET;
}

function decodeHtmlBody(buffer, contentTypeHeader = '') {
  const charset = detectCharset(buffer, contentTypeHeader);
  try {
    if (charset === 'utf-8' || charset === 'utf8') {
      return buffer.toString('utf8');
    }
    return iconv.decode(buffer, charset);
  } catch (error) {
    console.warn(`⚠️ [DECODE] Failed to decode using charset ${charset}: ${error.message}`);
    return buffer.toString('utf8');
  }
}

function stripNonContentElements($) {
  if (!$) return;
  const selectors = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'canvas', 'svg'];
  for (const selector of selectors) {
    $(selector).remove();
  }
}

const JS_LINE_PATTERNS = [
  /^\s*function\b/i,
  /^\s*(var|let|const)\b/i,
  /^\s*\$\(/,
  /^\s*window\./i,
  /^\s*document\./i,
  /\);\s*$/,
  /=>/,
  /\{\s*$/,
  /^\s*if\s*\(/i,
];

const CYRILLIC_REGEX = /[А-Яа-яҐЄІЇёЁ]/;

function looksLikeJavascriptLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (CYRILLIC_REGEX.test(trimmed)) {
    return false;
  }

  if (JS_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  const punctuationCount = trimmed.replace(/[^{}();=]/g, '').length;
  const latinLetters = trimmed.replace(/[^A-Za-z]/g, '').length;

  if (latinLetters === 0 && punctuationCount >= 4) {
    return true;
  }

  if (trimmed.length <= 160 && /[{};]/.test(trimmed) && !/[А-Яа-яҐЄІЇ]/.test(trimmed)) {
    return true;
  }

  return false;
}

function removeResidualScripts(text) {
  if (!text) return text;
  const filteredLines = [];
  for (const line of text.split('\n')) {
    if (looksLikeJavascriptLine(line)) {
      continue;
    }
    filteredLines.push(line);
  }
  return filteredLines.join('\n');
}

/**
 * Витягує основний контент судового рішення, застосовуючи фінальний, гібридний алгоритм очищення.
 * @param {cheerio.CheerioAPI} $ - Cheerio об'єкт завантаженої сторінки.
 * @returns {string} - Максимально очищений текст судового рішення.
 */
function extractMainContent($) {
  const contentSelectors = [
    '#divdocument',
    '#login',
    '.WordSection1',
    '#doc_text',
    '.decision-content',
    '.document-content',
  ];

  // ===== НОВАЯ ЛОГИКА: СБОР КОНТЕНТА ИЗ МНОЖЕСТВЕННЫХ ИСТОЧНИКОВ =====
  let combinedContent = '';
  const foundSelectors = [];

  // Этап 1: Собираем контент из всех доступных селекторов
  for (const selector of contentSelectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, element) => {
        const $element = $(element);
        const elementText = $element.text().trim();
        if (elementText.length > 50) {
          // Игнорируем слишком короткие фрагменты
          combinedContent += '\n' + elementText;
          foundSelectors.push(selector);
        }
      });
    }
  }

  // Этап 2: Если основные селекторы не дали результата, ищем по структуре документа
  if (combinedContent.length < 200) {
    console.log(
      `⚠️ Основные селекторы дали мало контента (${combinedContent.length} символов). Ищем в других элементах...`
    );

    // Ищем div'ы с большим количеством текста
    $('div').each((_, element) => {
      const $div = $(element);
      const divText = $div.text().trim();

      // Проверяем, что div содержит судебную информацию
      if (
        divText.length > 500 &&
        (divText.includes('УХВАЛА') ||
          divText.includes('РІШЕННЯ') ||
          divText.includes('ПОСТАНОВА') ||
          divText.includes('ВСТАНОВИВ') ||
          divText.includes('ВИРІШИВ') ||
          divText.includes('ПОСТАНОВИВ'))
      ) {
        console.log(`✅ Найден дополнительный контент в div (${divText.length} символов)`);
        combinedContent += '\n' + divText;
        foundSelectors.push('fallback-div');
      }
    });
  }

  // Этап 3: Последний резерв - весь body, но с фильтрацией
  if (combinedContent.length < 200) {
    console.log(`⚠️ Крайний случай: используем body с фильтрацией`);
    const bodyText = $('body').text().trim();
    if (bodyText.length > 200) {
      combinedContent = bodyText;
      foundSelectors.push('body-fallback');
    }
  }

  console.log(
    `📊 Контент собран из: ${foundSelectors.join(', ')} (${combinedContent.length} символов)`
  );

  // Этап 4: Очистка объединенного контента
  if (!combinedContent) {
    return 'Текст рішення не знайдено після пошуку по всіх селекторах.';
  }

  let cleanText = combinedContent;

  // Удаление дубликатов (если один и тот же текст попал из разных селекторов)
  const lines = cleanText.split('\n');
  const uniqueLines = [];
  const seenLines = new Set();

  for (const line of lines) {
    const normalizedLine = line.trim().toLowerCase();
    if (normalizedLine.length > 10 && !seenLines.has(normalizedLine)) {
      uniqueLines.push(line.trim());
      seenLines.add(normalizedLine);
    }
  }

  cleanText = uniqueLines.join('\n');

  // УСИЛЕННАЯ ОЧИСТКА ОТ HTML ТЕГОВ И ТЕХНИЧЕСКОГО МУСОРА
  // 1. Убираем оставшиеся HTML теги (на случай если они попали в текст)
  cleanText = cleanText
    .replace(/<[^>]*>/g, '') // Удаляем все HTML теги
    .replace(/&nbsp;/g, ' ') // Заменяем HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ''); // Убираем числовые HTML entities

  // 2. УСИЛЕННОЕ УДАЛЕНИЕ JAVASCRIPT И ТЕХНИЧЕСКОГО МУСОРА
  const junkKeywords = [
    'jQuery(function',
    'jQuery(',
    '$(document).ready',
    '$(function',
    'document.write',
    'function()',
    'function windowResize',
    '.css(',
    '.height(',
    '.width(',
    '.offset(',
    '.outerHeight(',
    '.outerWidth(',
    'Введіть cуму цифр',
    'З метою упередження зловживання',
    '<!DOCTYPE HTML',
    '<meta',
    'Rtf2Html Converter',
    'var el =',
    '$(',
  ];

  // ДВУХСТУПЕНЧАТАЯ ОЧИСТКА JAVASCRIPT
  // Шаг 1: Ищем начало любого JS блока с конца текста
  let junkIndex = -1;
  for (const keyword of junkKeywords) {
    const index = cleanText.lastIndexOf(keyword); // ищем с конца
    if (index !== -1 && index > cleanText.length * 0.5) {
      // ищем в последних 50% (было 80%)
      junkIndex = junkIndex === -1 ? index : Math.min(junkIndex, index);
    }
  }

  // Шаг 2: Если нашли JS, обрезаем до начала блока
  if (junkIndex !== -1) {
    // Ищем ближайший конец предложения перед JS блоком
    const beforeJunk = cleanText.substring(0, junkIndex);
    const lastSentenceEnd = Math.max(
      beforeJunk.lastIndexOf('.'),
      beforeJunk.lastIndexOf('!'),
      beforeJunk.lastIndexOf('?'),
      beforeJunk.lastIndexOf('\n')
    );

    if (lastSentenceEnd > beforeJunk.length * 0.8) {
      // Если нашли конец предложения близко к JS, обрезаем там
      cleanText = cleanText.substring(0, lastSentenceEnd + 1);
    } else {
      // Иначе просто обрезаем до начала JS
      cleanText = cleanText.substring(0, junkIndex);
    }
  }

  // Шаг 3: Убираем остатки JS‑строк без дорогих глобальных регексов
  cleanText = removeResidualScripts(cleanText);

  // 3. Убираем технические строки, но сохраняем судебный контент
  const linesToRemove = [
    /^Логін:\s*$/gm,
    /^Пароль:\s*$/gm,
    /^reyestr\.court\.gov\.ua\s*$/gm,
    /^Єдиний державний реєстр\s*$/gm,
    /^Єдиний державний реєстр судових рішень\s*$/gm,
  ];

  for (const regex of linesToRemove) {
    cleanText = cleanText.replace(regex, '');
  }

  // Усовершенствованная очистка текста
  cleanText = cleanText
    .replace(/[ \t\u00A0]+/g, ' ') // Заменяем множественные пробелы на один
    .replace(/(\r\n|\n|\r)/g, '\n') // Унифицируем переносы строк
    .replace(/\n[\s]*\n/g, '\n') // Убираем пустые строки с пробелами
    .replace(/\n{3,}/g, '\n\n') // Максимум 2 переноса подряд
    .replace(/^\s+|\s+$/gm, '') // Убираем пробелы в начале/конце строк
    .replace(/^[\n\s]*|[\n\s]*$/g, '') // Убираем пустые строки в начале/конце
    .trim();

  // Финальное структурирование контента
  if (cleanText && cleanText.length > 100) {
    cleanText = structureCourtDecision(cleanText);
  }

  // Очистка объекта Cheerio из памяти
  $ = null;

  return cleanText || 'Текст рішення не знайдено після фінального очищення.';
}

/**
 * Структурирует текст судебного решения для лучшей читаемости
 * @param {string} text - очищенный текст решения
 * @returns {string} - структурированный текст
 */
function structureCourtDecision(text) {
  try {
    let structured = text;

    // 1. ДОПОЛНИТЕЛЬНАЯ ОЧИСТКА ОТ HTML И ТЕХНИЧЕСКИХ ОСТАТКОВ
    structured = structured
      .replace(/<[^>]*>/g, '') // Убираем все HTML теги
      .replace(/&nbsp;/g, ' ') // HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, ''); // Числовые HTML entities

    // 2. ОСТОРОЖНО убираем только техническую информацию, НЕ удаляя судебное содержание
    structured = structured
      .replace(/Надіслано судом:.*?(?=\n|$)/gi, '')
      .replace(/Зареєстровано:.*?(?=\n|$)/gi, '')
      .replace(/Забезпечено надання загального доступу:.*?(?=\n|$)/gi, '')
      .replace(/Унікальний ідентифікатор:.*?(?=\n|$)/gi, '')
      .replace(/Єдиний державний реєстр судових рішень/gi, '')
      .replace(/<!DOCTYPE HTML.*?>/gi, '')
      .replace(/Rtf2Html Converter/gi, '');

    // НЕ удаляем "Категорія справи" полностью - она может содержать полезную информацию
    // Вместо этого просто очищаем от лишних технических деталей внутри

    // 3. Исправляем только номера (убираем агрессивное склеивание слов)
    structured = structured
      .replace(/№\s*(\d+)/g, '№$1') // Номера дел
      .replace(/ст\.\s*(\d+)/g, 'ст. $1') // Статьи законов
      .replace(/ч\.\s*(\d+)/g, 'ч. $1') // Части статей
      .replace(/п\.\s*(\d+)/g, 'п. $1'); // Пункты

    // 4. Форматируем заголовки украинских судебных документов
    structured = structured
      .replace(/(УХВАЛА|РІШЕННЯ|ПОСТАНОВА|ВИЗНАЧЕННЯ)/gi, '\n\n=== $1 ===\n')
      .replace(/(про\s+[а-яї\s]+)/gi, '$1\n') // Подзаголовок "про..."
      .replace(
        /(\d{2}\.\d{2}\.\d{4})\s*(року?)?\s*(м\.?\s*[А-ЯҐЄІЇ][а-яґєії']+)/gi,
        '\n📅 $1 $2 📍 $3\n'
      );

    // 5. Форматируем основные разделы судебного решения
    structured = structured
      .replace(
        /(ВСТАНОВИВ:|МОТИВУВАЛЬНА ЧАСТИНА:|РЕЗОЛЮТИВНА ЧАСТИНА:|ВИРІШИВ:|ПОСТАНОВИВ:|УХВАЛИВ:)/gi,
        '\n\n🔵 $1\n'
      )
      .replace(
        /(Слідчий суддя|Суддя|Головуючий суддя)\s+([А-ЯҐЄІЇ][а-яґєії''\s]+)/gi,
        '\n👨‍⚖️ $1: $2'
      )
      .replace(/(секретар судового засідання)\s+([А-ЯҐЄІЇ][а-яґєії''\s]+)/gi, '\n📝 $1: $2');

    // 6. Форматируем номера дел и проваджень
    structured = structured
      .replace(/(Справа\s*№\s*[\d/]+)/gi, '\n📋 $1\n')
      .replace(/(провадження\s*№\s*[\d/-]+)/gi, '📂 $1')
      .replace(/(кримінальному провадженні\s*№\s*[\d]+)/gi, '🔍 $1');

    // 7. Улучшаем структуру параграфов
    structured = structured
      .replace(/([.!?])\s*([А-ЯҐЄІЇ][а-яґєії])/g, '$1\n\n$2') // Новый параграф
      .replace(/(\d+\.)\s*([А-ЯҐЄІЇ])/g, '\n$1 $2') // Нумерованные пункты
      .replace(/([а-я])\)\s*([А-ЯҐЄІЇ])/g, '$1)\n$2'); // Пункты с буквами

    // 8. Убираем анонимизированные имена и лишнюю техническую информацию
    structured = structured.replace(/ОСОБА_\d+/g, '[ОСОБА]');
    // УДАЛЕН ПРОБЛЕМНЫЙ REGEX: .replace(/розглянувши у відкритому судовому засіданні клопотання.*?(?=ВСТАНОВИВ|$)/gis, '');
    // Этот regex удалял весь контент когда не находил "ВСТАНОВИВ"

    // 9. Финальная очистка
    structured = structured
      .replace(/\n{3,}/g, '\n\n') // Максимум 2 переноса
      .replace(/^\s+|\s+$/gm, '') // Пробелы в начале/конце строк
      .replace(/^[\n\s]*|[\n\s]*$/g, '') // Пустые строки в начале/конце
      .trim();

    return structured;
  } catch (error) {
    console.error('[Структурирование] Ошибка форматирования:', error);
    return text; // Возвращаем оригинальный текст при ошибке
  }
}

/**
 * Інтелектуально доповнює метадані, шукаючи їх у сирому тексті сторінки.
 * @param {object} caseData - Об'єкт з уже зібраними даними.
 * @param {string} fullPageText - Повний текст сторінки для пошуку.
 * @returns {object} - Оновлений об'єкт caseData.
 */
function enhanceMetadataFromText(caseData, fullPageText) {
  // Покращуємо Номер справи
  if (caseData.caseNumber === 'Не вказано' || !caseData.caseNumber) {
    const caseNumberMatch = fullPageText.match(COMPILED_REGEX.caseNumber);
    if (caseNumberMatch && caseNumberMatch[1]) {
      caseData.caseNumber = caseNumberMatch[1].trim();
      console.log(`[Enhancer] Знайдено номер справи з тексту: ${caseData.caseNumber}`);
    }
  }

  // Покращуємо Дату
  if (caseData.date === 'Дата не знайдена' || !caseData.date) {
    // Шукаємо дату в пріоритетному порядку: спочатку дата набрання сили, потім дата реєстрації.
    const dateEffectiveMatch = fullPageText.match(COMPILED_REGEX.dateEffective);
    const dateRegisteredMatch = fullPageText.match(COMPILED_REGEX.dateRegistered);

    if (dateEffectiveMatch && dateEffectiveMatch[1]) {
      caseData.date = dateEffectiveMatch[1].trim();
      console.log(`[Enhancer] Знайдено дату (набрання сили) з тексту: ${caseData.date}`);
    } else if (dateRegisteredMatch && dateRegisteredMatch[1]) {
      caseData.date = dateRegisteredMatch[1].trim();
      console.log(`[Enhancer] Знайдено дату (реєстрації) з тексту: ${caseData.date}`);
    }
  }

  return caseData;
}

/**
 * Завантажує одне судове рішення з ЄДРСР, застосовуючи двохетапний збір метаданих.
 */
export async function fetchCase(url, cookie = '', signal = null, options = {}) {
  // 1. Check cache first
  const cachedCase = await dbService.getCachedCaseByUrl(url);
  if (cachedCase) {
    // Return a copy to prevent mutation of the cached object
    // NO DELAY here because we didn't hit the network
    return { ...cachedCase, fromCache: true };
  }

  // Строгая проверка URL до сетевых запросов
  if (!isValidEDRSRUrl(url)) {
    return {
      url,
      id: url.match(/\/Review\/(\d+)/)?.[1] || url,
      body: 'Пропущено: недопустимый URL (ожидается reyestr.court.gov.ua/Review/<id>)',
      error: 'invalid_url',
      errorType: 'invalid_url',
      skipped: true,
    };
  }

  const caseId = url.match(/\/Review\/(\d+)/)?.[1] || url;
  const timeoutMs = parsePositiveInt(options.timeoutMs, DEFAULT_CASE_TIMEOUT_MS);
  const gotTimeoutMs = parsePositiveInt(
    process.env.GOT_REQUEST_TIMEOUT_MS,
    Math.min(timeoutMs, 45000)
  );
  const effectiveGotTimeout = Math.max(1000, Math.min(gotTimeoutMs, timeoutMs));

  let abortedByTimeout = false;
  let abortedByParentSignal = false;

  // Abort controller for centralized timeout management
  const controller = new AbortController();
  const { signal: abortSignal } = controller;

  // Combine user-provided signal if it exists
  const onParentAbort = () => {
    abortedByParentSignal = true;
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      onParentAbort();
    } else {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    console.log(`📥 Завантажую: ${url}`);
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Cookie: cookie || '',
    };

    // Use the abort controller's signal
    const response = await got(url, {
      headers,
      signal: abortSignal,
      retry: {
        limit: 2, // Simplified retry logic
        methods: ['GET'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524],
        calculateDelay: ({ attemptCount }) => attemptCount * 1000, // 1s, 2s
      },
      timeout: {
        request: effectiveGotTimeout,
        response: effectiveGotTimeout,
        read: effectiveGotTimeout,
      },
      responseType: 'buffer',
      // Avoid auto-parsing non-2xx into throw; we handle errors via catch
      throwHttpErrors: true,
    });

    // Content-Type sanity check
    const contentType = (response.headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('text/html')) {
      const errMsg = `Non-HTML content-type: ${contentType}`;
      console.warn(`🚫 [SKIP] ${url} -> ${errMsg}`);
      const skipped = {
        url,
        id: url.match(/\/Review\/(\d+)/)?.[1] || url,
        body: `Пропущено: ${errMsg}`,
        error: errMsg,
        errorType: 'non_html',
        skipped: true,
      };
      await dbService.saveCaseToCache(skipped);
      return skipped;
    }

    // Analyze raw HTML for hazards before parsing
    const decodedHtml = decodeHtmlBody(response.body, contentType);

    const hazard = analyzeRawHtmlForHazards(decodedHtml || '');
    if (hazard.skip) {
      console.warn(`🚫 [SKIP] ${url} -> ${hazard.reason}`);
      const skipped = {
        url,
        id: url.match(/\/Review\/(\d+)/)?.[1] || url,
        body: `Пропущено: ${hazard.reason}`,
        error: hazard.reason,
        errorType: hazard.reason.includes('large') ? 'too_large' : 'bad_content',
        skipped: true,
      };
      // Cache this decision to avoid repeated heavy attempts
      await dbService.saveCaseToCache(skipped);
      return skipped;
    }

    // Load HTML into cheerio only after passing guards
    let $ = cheerio.load(decodedHtml, { decodeEntities: false });

    // Remove obvious non-content nodes before extracting text
    stripNonContentElements($);

    // Clear response body from memory immediately after loading
    response.body = null;

    // Етап 1: Основний збір метаданих за стандартними селекторами
    let caseData = {
      url,
      id: url.match(/\/Review\/(\d+)/)?.[1] || url,
      date: $('.RegDate').first().text().trim() || 'Дата не знайдена',
      court: $('.CourtName').first().text().trim() || 'Суд не вказано',
      caseNumber: $('.CaseNumber').first().text().trim() || 'Не вказано',
      judge: $('.ChairmenName').first().text().trim() || 'Не вказано',
    };

    // Етап 2: Інтелектуальний збір для заповнення прогалин
    let fullPageText = $('body').text();
    caseData = enhanceMetadataFromText(caseData, fullPageText);

    // Етап 3: Вилучення та фінальна очистка основного тіла документу
    console.log(`🔍 [${caseData.id}] Починаємо парсинг контенту...`);
    caseData.body = extractMainContent($);
    // Explicitly release Cheerio reference after extraction
    $ = null;

    // Keep full case text - no size limitations (already gated by MAX_HTML_BYTES)

    // УМНАЯ ПРОВЕРКА: определяем тип контента на основе множественных критериев
    const bodyLength = caseData.body.length;
    const hasCourtKeywords =
      caseData.body.includes('УХВАЛА') ||
      caseData.body.includes('РІШЕННЯ') ||
      caseData.body.includes('ПОСТАНОВА') ||
      caseData.body.includes('ВИЗНАЧЕННЯ');

    const hasCourtProcedure =
      caseData.body.includes('ВСТАНОВИВ') ||
      caseData.body.includes('ВИРІШИВ') ||
      caseData.body.includes('ПОСТАНОВИВ') ||
      caseData.body.includes('УХВАЛИВ') ||
      caseData.body.includes('МОТИВУВАЛЬНА ЧАСТИНА') ||
      caseData.body.includes('РЕЗОЛЮТИВНА ЧАСТИНА');

    const hasJudgeInfo =
      caseData.body.includes('слідчий суддя') ||
      caseData.body.includes('Слідчий суддя') ||
      caseData.body.includes('суддя') ||
      caseData.body.includes('Суддя');

    const hasLegalContent =
      caseData.body.includes('кримінальному провадженні') ||
      caseData.body.includes('клопотання') ||
      caseData.body.includes('заяву') ||
      caseData.body.includes('справі');

    // Решение считается полным если:
    // 1. Большой объем текста (>1000 символов) И
    // 2. Есть судебные ключевые слова И
    // 3. (Есть процедурные слова ИЛИ есть информация о судье ИЛИ есть правовой контент)
    const hasFullDecision =
      bodyLength > 1000 &&
      hasCourtKeywords &&
      (hasCourtProcedure || hasJudgeInfo || hasLegalContent);

    if (!hasFullDecision && bodyLength < 500) {
      console.warn(
        `⚠️ [${caseData.id}] ОБНАРУЖЕНЫ ТОЛЬКО МЕТАДАННЫЕ! Полный текст решения недоступен (${bodyLength} символов).`
      );

      // Дополнительная попытка поиска через весь текст страницы
      const emergencyContent = fullPageText.match(
        /(?:УХВАЛА|РІШЕННЯ|ПОСТАНОВА)[\s\S]*?(?:оскарженню не підлягає|суддя:|СУДДЯ|підлягає|$)/gi
      );
      if (emergencyContent && emergencyContent[0] && emergencyContent[0].length > 1000) {
        console.log(
          `🚨 [${caseData.id}] Найден полный текст через аварийный поиск (${emergencyContent[0].length} символов)`
        );
        caseData.body = emergencyContent[0].trim();
      } else {
        // Если полный текст недоступен, формируем информативное сообщение
        console.log(`📋 [${caseData.id}] Формирую отчет на основе доступных метаданных`);

        caseData.body = `📋 Справа №${caseData.caseNumber}
📅 Дата: ${caseData.date}
🏛️ Суд: ${caseData.court || 'Не вказано'}
🔗 URL: ${caseData.url}

⚠️ СТАТУС: ОБМЕЖЕНИЙ ДОСТУП
Повний текст судового рішення недоступний для публічного перегляду.

ДОСТУПНА ІНФОРМАЦІЯ:
${caseData.body}

🔍 РЕКОМЕНДАЦІЇ:
1. Дело може бути закритим або містити конфіденційну інформацію
2. Спробуйте отримати доступ через офіційні канали
3. Перевірте статус справи в ЄДРСР з авторизацією

⚖️ Для повного аналізу потрібен доступ до повного тексту рішення.`;
      }
    } else {
      console.log(
        `✅ [${caseData.id}] Повний текст судового рішення успішно отримано (${caseData.body.length} символів)`
      );
      console.log(
        `📊 [${caseData.id}] Критерії: keywords=${hasCourtKeywords}, procedure=${hasCourtProcedure}, judge=${hasJudgeInfo}, legal=${hasLegalContent}`
      );
    }

    // Етап 4: Вилучення правових метаданих
    caseData = extractLegalMetadata(caseData, fullPageText);
    // Release large page text buffer
    fullPageText = null;

    console.log(`✅ Завантажено та оброблено: ${caseData.id} (${caseData.body.length} символів)`);

    // 2. Save to cache after successful processing
    await dbService.saveCaseToCache(caseData);

    // Apply delay ONLY when we actually fetched from the network
    await delay(requestDelay);
    return caseData;
  } catch (error) {
    if (abortedByParentSignal && !abortedByTimeout) {
      throw new Error('Операцію скасовано користувачем');
    }

    let errorType = 'unknown';
    let message = error?.message || 'Невідома помилка';
    if (abortedByTimeout) {
      errorType = 'timeout';
      message = `Перевищено ліміт часу ${timeoutMs}мс під час завантаження`;
    } else if (error.name === 'AbortError' || message.includes('timeout')) {
      errorType = 'timeout';
    } else if (error.name === 'RequestError') {
      errorType = 'network';
    }

    console.error(`❌ Помилка завантаження ${url} (тип: ${errorType}):`, message);

    if (errorType === 'timeout' || errorType === 'network') {
      await dbService.saveCaseToCache({
        url,
        id: caseId,
        body: `Помилка завантаження (кешовано): ${message}`,
        error: message,
        errorType,
        cachedAt: Date.now(),
        isTemporary: true,
      });
    }

    return {
      url,
      id: caseId,
      body: `Помилка завантаження: ${message}`,
      error: message,
      errorType,
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onParentAbort);
    }
  }
}

// --- Решта функцій файлу без змін ---

export async function downloadAll(urls, cookie = '', onProgress = () => {}, abortSignal = null) {
  console.log(`🚀 Початок завантаження ${urls.length} судових рішень...`);
  if (!urls || urls.length === 0) throw new Error('Список URL порожній');
  // Строгая валидация домена/пути, вместо includes(...)
  const validUrls = urls.filter((url) => isValidEDRSRUrl(url));
  if (validUrls.length === 0) throw new Error('Не знайдено валідних URL ЄДРСР');

  const results = [];
  let processedCount = 0;
  let skippedCount = 0;
  const caseTimeoutMs = parsePositiveInt(
    process.env.CASE_TIMEOUT_MS ||
      process.env.FETCH_CASE_TIMEOUT_MS ||
      process.env.OVERALL_REQUEST_TIMEOUT_MS,
    DEFAULT_CASE_TIMEOUT_MS
  );

  for (const url of validUrls) {
    // Check if operation was cancelled
    if (abortSignal && abortSignal.aborted) {
      console.log(`⚠️ Операцію скасовано користувачем на ${processedCount}/${validUrls.length}`);
      throw new Error('Операцію скасовано користувачем');
    }

    try {
      console.log(`📥 [${processedCount + 1}/${validUrls.length}] Обробляю: ${url}`);

      const result = await fetchCase(url, cookie, abortSignal, { timeoutMs: caseTimeoutMs });

      if (result.error) {
        // Check if the error is due to a timeout, cancellation, or network issue
        const isSkippableError =
          result.errorType === 'timeout' ||
          result.errorType === 'network' ||
          result.errorType === 'non_html' ||
          result.errorType === 'too_large' ||
          result.errorType === 'bad_content' ||
          result.error.includes('отменена') ||
          result.error.includes('скасовано') ||
          result.error.includes('abort');

        if (isSkippableError) {
          console.warn(`⚠️ Пропускаю проблемне посилання: ${url} (${result.error})`);
          skippedCount++;
          results.push({ ...result, skipped: true });
        } else {
          results.push(result);
        }
      } else {
        results.push(result);
      }

      processedCount++;
      await onProgress(processedCount);

      // Профілактичний GC кожні 10 справ для запобігання OOM
      if (processedCount % 10 === 0) {
        const memUsage = process.memoryUsage();
        const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const memWarningMB = parseInt(process.env.MEMORY_WARNING_MB, 10) || 200;
        const memLimitMB = parseInt(process.env.MEMORY_LIMIT_MB, 10) || 400;

        console.log(
          `📊 [MEMORY] Heap: ${memUsedMB}MB / RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`
        );

        // Профілактичний GC при досягненні warning порогу
        if (memUsedMB > memWarningMB && global.gc) {
          console.log(`🗑️ [MEMORY] Профілактичний GC при ${memUsedMB}MB > ${memWarningMB}MB`);
          global.gc();
          const memAfterGC = process.memoryUsage();
          console.log(`🗑️ [MEMORY] Після GC: ${Math.round(memAfterGC.heapUsed / 1024 / 1024)}MB`);
        }

        // Затримка при критичному рівні памʼяті
        if (memUsedMB > memLimitMB) {
          console.warn(`⚠️ [MEMORY] Критичний рівень памʼяті (${memUsedMB}MB), додаю затримку...`);
          await delay(2000);
        }
      }
    } catch (error) {
      // This catch block will now mostly handle unrecoverable errors or cancellation
      console.error(`❌ CRITICAL Error during processing ${url}:`, error.message);

      const isCancelledError =
        error.message.includes('отменена') ||
        error.message.includes('скасовано') ||
        error.message.includes('abort');
      if (isCancelledError) {
        throw error; // Propagate cancellation to stop the entire process
      }

      results.push({
        url,
        error: error.message,
        id: url.match(/\/Review\/(\d+)/)?.[1] || url,
        skipped: true,
        errorType: 'critical',
      });
      processedCount++;
      await onProgress(processedCount);
    }
  }

  const successful = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error && !r.skipped).length;

  console.log(
    `✅ Завершено обработку: успешно=${successful}, пропущено=${skippedCount}, ошибок=${failed} из ${validUrls.length}`
  );

  return results;
}

// isValidEDRSRUrl moved to utils.js

export function getDownloadStats(results) {
  const total = results.length;
  const successful = results.filter((r) => !r.error).length;
  return {
    total,
    successful,
    failed: total - successful,
    successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : 0,
  };
}

/**
 * Функции для извлечения правовых метаданных из судебных решений
 */

/**
 * Извлекает статьи законов из текста решения
 * @param {string} text - текст решения
 * @returns {Array<string>} - массив найденных статей
 */
function extractLawArticles(text) {
  const articles = [];

  // Использование предкомпилированных регексов для производительности
  const articleTypes = [
    { regex: COMPILED_REGEX.ukArticles(), suffix: 'УК України' },
    { regex: COMPILED_REGEX.gkArticles(), suffix: 'ЦК України' },
    { regex: COMPILED_REGEX.kasArticles(), suffix: 'КАС України' },
    { regex: COMPILED_REGEX.gpkArticles(), suffix: 'ЦПК України' },
    { regex: COMPILED_REGEX.kpkArticles(), suffix: 'КПК України' },
  ];

  for (const { regex, suffix } of articleTypes) {
    const matches = text.match(regex);
    if (matches) {
      matches.forEach((match) => {
        const articleNum = match.match(/(\d+(?:\.\d+)?)/);
        if (articleNum) {
          articles.push(`ст. ${articleNum[1]} ${suffix}`);
        }
      });
    }
  }

  return [...new Set(articles)]; // убираем дубликаты
}

/**
 * Извлекает сумму иска/ущерба из текста решения
 * @param {string} text - текст решения
 * @returns {Object|null} - объект с суммой и валютой или null
 */
function extractClaimAmount(text) {
  // Поиск сумм в гривнах
  const uahMatches = text.match(COMPILED_REGEX.uahAmounts());

  if (uahMatches && uahMatches.length > 0) {
    // Берем самую большую сумму (обычно это основная сумма иска)
    const amounts = uahMatches
      .map((match) => {
        const numStr = match
          .replace(/[^\d.,]/g, '')
          .replace(/\s/g, '')
          .replace(',', '.');
        return parseFloat(numStr);
      })
      .filter((num) => !isNaN(num));

    if (amounts.length > 0) {
      const maxAmount = Math.max(...amounts);
      return {
        amount: maxAmount,
        currency: 'UAH',
        formatted: `${maxAmount.toLocaleString('uk-UA')} грн`,
      };
    }
  }

  // Поиск сумм в долларах
  const usdMatches = text.match(COMPILED_REGEX.usdAmounts());

  if (usdMatches && usdMatches.length > 0) {
    const amounts = usdMatches
      .map((match) => {
        const numStr = match
          .replace(/[^\d.,]/g, '')
          .replace(/\s/g, '')
          .replace(',', '.');
        return parseFloat(numStr);
      })
      .filter((num) => !isNaN(num));

    if (amounts.length > 0) {
      const maxAmount = Math.max(...amounts);
      return {
        amount: maxAmount,
        currency: 'USD',
        formatted: `${maxAmount.toLocaleString('en-US')} USD`,
      };
    }
  }

  return null;
}

/**
 * Определяет тип дела на основе содержания
 * @param {string} text - текст решения
 * @returns {string} - тип дела
 */
function determineCaseType(text) {
  // Использование предкомпилированных регексов для быстрого определения типа дела
  if (COMPILED_REGEX.criminal.test(text)) {
    return 'Кримінальна справа';
  }

  if (COMPILED_REGEX.administrative.test(text)) {
    return 'Адміністративна справа';
  }

  if (COMPILED_REGEX.labor.test(text)) {
    return 'Трудовий спір';
  }

  if (COMPILED_REGEX.family.test(text)) {
    return 'Сімейна справа';
  }

  if (COMPILED_REGEX.commercial.test(text)) {
    return 'Господарська справа';
  }

  if (COMPILED_REGEX.property.test(text)) {
    return 'Спір про нерухомість';
  }

  // По умолчанию
  return 'Цивільна справа';
}

/**
 * Извлекает участников дела
 * @param {string} text - текст решения
 * @returns {Object} - объект с участниками
 */
function extractParties(text) {
  const parties = {
    plaintiffs: [],
    defendants: [],
    thirdParties: [],
  };

  // Поиск позивачів с предкомпилированным регексом
  const plaintiffMatches = text.match(COMPILED_REGEX.plaintiffs());
  if (plaintiffMatches) {
    plaintiffMatches.forEach((match) => {
      const name = match.replace(/позивач[іи]?\s*[:-]?\s*/gi, '').trim();
      if (name.length > 3 && name.length < 100) {
        parties.plaintiffs.push(name);
      }
    });
  }

  // Поиск відповідачів с предкомпилированным регексом
  const defendantMatches = text.match(COMPILED_REGEX.defendants());
  if (defendantMatches) {
    defendantMatches.forEach((match) => {
      const name = match.replace(/відповідач[іи]?\s*[:-]?\s*/gi, '').trim();
      if (name.length > 3 && name.length < 100) {
        parties.defendants.push(name);
      }
    });
  }

  // Убираем дубликаты
  parties.plaintiffs = [...new Set(parties.plaintiffs)];
  parties.defendants = [...new Set(parties.defendants)];

  return parties;
}

/**
 * Извлекает все правовые метаданные из дела
 * @param {Object} caseData - базовые данные дела
 * @param {string} fullPageText - полный текст страницы
 * @returns {Object} - дело с дополненными метаданными
 */
function extractLegalMetadata(caseData, fullPageText) {
  try {
    const lawArticles = extractLawArticles(fullPageText);
    const claimAmount = extractClaimAmount(fullPageText);
    const caseType = determineCaseType(fullPageText);
    const parties = extractParties(fullPageText);

    return {
      ...caseData,
      metadata: {
        lawArticles,
        claimAmount,
        caseType,
        parties,
        extractedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('❌ Ошибка извлечения метаданных:', error);
    return caseData;
  }
}
