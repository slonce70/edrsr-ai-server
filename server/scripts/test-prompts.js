import assert from 'node:assert/strict';

import { PROMPT_TEMPLATES } from '../prompts.js';
import { buildStrictCaseLinkMap, createAnalysisPrompt } from '../utils.js';

function mustInclude(haystack, needle, label) {
  assert.ok(
    haystack.includes(needle),
    `${label}: expected to include ${JSON.stringify(needle)} but it did not.`
  );
}

const cases = [
  {
    caseNumber: '123/456/24',
    url: 'https://reyestr.court.gov.ua/Review/123456789',
    decisionDate: '01.01.2025',
    body: 'Текст справи 1...',
  },
  {
    caseNumber: '987/654/25',
    url: 'https://reyestr.court.gov.ua/Review/987654321',
    decisionDate: '02.12.2025',
    body: 'Текст справи 2...',
  },
];

const corpus = 'SAMPLE CORPUS';

// Strict map should contain case number + URL pairs.
const strictMap = buildStrictCaseLinkMap(cases);
mustInclude(strictMap, 'Справа №123/456/24', 'buildStrictCaseLinkMap');
mustInclude(strictMap, 'https://reyestr.court.gov.ua/Review/123456789', 'buildStrictCaseLinkMap');
mustInclude(strictMap, 'Справа №987/654/25', 'buildStrictCaseLinkMap');
mustInclude(strictMap, 'https://reyestr.court.gov.ua/Review/987654321', 'buildStrictCaseLinkMap');

// Final prompt should include strict map + fenced materials.
const finalPrompt = createAnalysisPrompt(cases, 'practice_overview', corpus);
mustInclude(finalPrompt, 'СТРОГИЙ СПИСОК ВІДПОВІДНОСТІ', 'createAnalysisPrompt(practice_overview)');
mustInclude(finalPrompt, strictMap, 'createAnalysisPrompt(practice_overview)');
mustInclude(finalPrompt, '<<<BEGIN MATERIALS>>>', 'createAnalysisPrompt(practice_overview)');
mustInclude(finalPrompt, corpus, 'createAnalysisPrompt(practice_overview)');
mustInclude(finalPrompt, '<<<END MATERIALS>>>', 'createAnalysisPrompt(practice_overview)');

// Custom prompt should be quoted and include conflict policy.
const customTask = 'CUSTOM TEST: порівняй судові позиції щодо строків позовної давності.';
const customPrompt = createAnalysisPrompt(cases, customTask, corpus);
mustInclude(customPrompt, `"""\n${customTask}\n"""`, 'createAnalysisPrompt(custom)');
mustInclude(customPrompt, 'ПОЛІТИКА КОНФЛІКТІВ', 'createAnalysisPrompt(custom)');

// Detailed annotation prompt should include strict map, fenced materials, and untrusted-data notice.
const annotationPrompt = createAnalysisPrompt(cases, 'detailed_annotation', corpus);
mustInclude(
  annotationPrompt,
  'СТРОГИЙ СПИСОК ВІДПОВІДНОСТІ',
  'createAnalysisPrompt(detailed_annotation)'
);
mustInclude(annotationPrompt, strictMap, 'createAnalysisPrompt(detailed_annotation)');
mustInclude(annotationPrompt, '<<<BEGIN MATERIALS>>>', 'createAnalysisPrompt(detailed_annotation)');
mustInclude(annotationPrompt, '<<<END MATERIALS>>>', 'createAnalysisPrompt(detailed_annotation)');
mustInclude(annotationPrompt, 'недовіреними даними', 'createAnalysisPrompt(detailed_annotation)');

// Templates should encode injection fencing and strict-map precedence.
mustInclude(
  PROMPT_TEMPLATES.batch_summary,
  'ЗАХИСТ ВІД PROMPT-INJECTION',
  'PROMPT_TEMPLATES.batch_summary'
);
mustInclude(
  PROMPT_TEMPLATES.batch_summary,
  'СТРОГИЙ СПИСОК ВІДПОВІДНОСТІ (номер ↔ URL)',
  'PROMPT_TEMPLATES.batch_summary'
);
mustInclude(
  PROMPT_TEMPLATES.base_prompt,
  'СТРОГИЙ СПИСОК ВІДПОВІДНОСТІ (номер ↔ URL)',
  'PROMPT_TEMPLATES.base_prompt'
);

console.log('OK: prompt assembly invariants passed.');
