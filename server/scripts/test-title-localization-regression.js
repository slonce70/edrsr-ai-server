#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const routesPath = join(__dirname, '..', 'services', 'jobTitleService.js');
const source = readFileSync(routesPath, 'utf8');

if (!source.includes('function generateInitialTitle'))
  throw new Error('Missing generateInitialTitle');
if (!source.includes('function refreshHeuristicTitle'))
  throw new Error('Missing refreshHeuristicTitle');
const titleHelpers = source;
const jobMutations = readFileSync(join(__dirname, '..', 'routes', 'job-mutations.js'), 'utf8');

const forbiddenFragments = [
  'Анализ:',
  "'Анализ'",
  '`Анализ',
  'Запрос:',
  ' дел',
  ' из ',
  'Повторный анализ',
  "toLocaleDateString('ru-RU')",
];

for (const fragment of forbiddenFragments) {
  if (`${titleHelpers}\n${jobMutations}`.includes(fragment)) {
    throw new Error(`Auto title helper still contains non-Ukrainian fragment: ${fragment}`);
  }
}

const requiredFragments = [
  'Аналіз:',
  "'Аналіз'",
  'Запит:',
  'Повторний аналіз',
  ' справ',
  ' з ${total}',
  "toLocaleDateString('uk-UA')",
];

for (const fragment of requiredFragments) {
  if (!`${titleHelpers}\n${jobMutations}`.includes(fragment)) {
    throw new Error(`Auto title helper is missing Ukrainian fragment: ${fragment}`);
  }
}

console.log('Title localization regression passed');
