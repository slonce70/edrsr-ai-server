import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootPkg = readJson(path.join(__dirname, '..', 'package.json'));
const serverPkg = readJson(path.join(__dirname, 'package.json'));

export const APP_VERSION =
  process.env.APP_VERSION || rootPkg?.version || serverPkg?.version || '0.0.0';
export const APP_NAME = rootPkg?.name || serverPkg?.name || 'edrsr-ai';
