#!/usr/bin/env node

import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const targetArg = process.argv[2] || 'server/scripts/test-race-condition-fix.js';
const repoRoot = path.resolve(__dirname, '../..');
const targetPath = path.resolve(repoRoot, targetArg);

function skip(message, kind = 'env-blocked') {
  console.log(`SKIPPED ${kind}: ${message}`);
  process.exit(0);
}

function checkTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      cleanup();
      resolve(true);
    });
    socket.once('timeout', () => {
      cleanup();
      reject(new Error(`timeout connecting to ${host}:${port}`));
    });
    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  skip('DATABASE_URL is not set');
}

if (process.env.EDRSR_DB_INTEGRATION_ALLOW_LIVE !== 'true') {
  skip(
    'set EDRSR_DB_INTEGRATION_ALLOW_LIVE=true to run this script against the configured database',
    'live-db-guard'
  );
}

let url;
try {
  url = new URL(databaseUrl);
} catch {
  skip('DATABASE_URL is invalid');
}

const socketHost = url.searchParams.get('host');
if (socketHost && socketHost.startsWith('/')) {
  skip(`unix socket DATABASE_URL is not supported by TCP precheck (${socketHost})`);
}

if (!url.hostname) {
  skip('DATABASE_URL does not expose a TCP host');
}

const host = url.hostname;
const port = Number.parseInt(url.port || '5432', 10);

try {
  await checkTcp(host, port);
} catch (error) {
  skip(error.message);
}

const child = spawn(process.execPath, ['--env-file=server/.env', targetPath], {
  cwd: repoRoot,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
