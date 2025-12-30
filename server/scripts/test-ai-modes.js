import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeCases } from '../gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveDecisionDate(caseItem) {
  return (
    caseItem.decisionDate ||
    caseItem.date ||
    caseItem.metadata?.decisionDate ||
    caseItem.metadata?.date ||
    null
  );
}

function buildCaseRegex(caseItem) {
  const caseNumber = caseItem.caseNumber || caseItem.id || '';
  const url = caseItem.url || '';
  const date = resolveDecisionDate(caseItem);
  const datePattern = date ? escapeRegex(date) : '[^)]+';

  return new RegExp(
    `\\[\\s*Справа\\s*№\\s*${escapeRegex(
      caseNumber
    )}\\s*\\]\\(\\s*${escapeRegex(url)}\\s*\\)\\s*\\(\\s*${datePattern}\\s*\\)`,
    'i'
  );
}

function validateAnalysis(analysisText, cases) {
  const issues = [];
  const linkPattern =
    /\[\s*Справа\s*№[^\]]+\]\(https?:\/\/reyestr\.court\.gov\.ua\/Review\/\d+\)\s*\([^)]+\)/gi;
  const linkMatches = analysisText.match(linkPattern) || [];

  cases.forEach((caseItem) => {
    const caseNumber = caseItem.caseNumber || caseItem.id || 'unknown';
    const url = caseItem.url || '';
    const date = resolveDecisionDate(caseItem);
    const regex = buildCaseRegex(caseItem);

    if (!regex.test(analysisText)) {
      issues.push(
        `Missing or malformed reference for case ${caseNumber} (${url}${date ? `, ${date}` : ''})`
      );
    }

    if (url && analysisText.includes(url) && !regex.test(analysisText)) {
      issues.push(`URL appears without correct Markdown reference for ${caseNumber}`);
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    linkCount: linkMatches.length,
  };
}

function printUsage() {
  console.log(
    `\nUsage: node server/scripts/test-ai-modes.js [options]\n\nOptions:\n  --mode <promptKey|custom|default>    Prompt mode (default: practice_overview)\n  --prompt "<text>"                   Custom prompt text (required if mode=custom)\n  --cases <path>                       JSON file with cases (default: fixtures/qa-cases.json)\n  --analysis-file <path>               Validate existing analysis text instead of calling AI\n  --analysis-out <path>                Save generated analysis to file\n  --verbose                            Print progress updates\n`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const mode = args.mode || 'practice_overview';
  const prompt = mode === 'custom' ? args.prompt : mode === 'default' ? null : mode;
  if (mode === 'custom' && !prompt) {
    console.error('ERROR: --prompt is required when --mode=custom');
    process.exitCode = 1;
    return;
  }

  const casesPath = args.cases
    ? path.resolve(process.cwd(), args.cases)
    : path.resolve(__dirname, 'fixtures', 'qa-cases.json');

  const rawCases = await fs.readFile(casesPath, 'utf8');
  const cases = JSON.parse(rawCases);
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`Cases file is empty or invalid: ${casesPath}`);
  }

  let analysisText = '';
  if (args['analysis-file']) {
    const analysisPath = path.resolve(process.cwd(), args['analysis-file']);
    analysisText = await fs.readFile(analysisPath, 'utf8');
  } else {
    if (args.verbose) {
      console.log(`Running analysis for mode=${mode} cases=${cases.length}...`);
    }
    analysisText = await analyzeCases(cases, prompt, (msg) => {
      if (args.verbose) console.log(`[status] ${msg}`);
    });
    if (args['analysis-out']) {
      const outPath = path.resolve(process.cwd(), args['analysis-out']);
      await fs.writeFile(outPath, analysisText, 'utf8');
    }
  }

  const result = validateAnalysis(analysisText, cases);

  console.log(`\nQA Summary:`);
  console.log(`- Cases: ${cases.length}`);
  console.log(`- Detected Markdown links: ${result.linkCount}`);
  console.log(`- Status: ${result.ok ? 'OK' : 'FAILED'}`);

  if (!result.ok) {
    result.issues.forEach((issue) => console.log(`  - ${issue}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('QA script failed:', err);
  process.exitCode = 1;
});
