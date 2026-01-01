#!/usr/bin/env node

// Start the server with garbage collection enabled
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting EDRSR-AI server with garbage collection enabled...');

const maxOldSpaceMb = Number.parseInt(process.env.MAX_OLD_SPACE_MB, 10);
const maxOldSpaceArg = Number.isFinite(maxOldSpaceMb) && maxOldSpaceMb > 0 ? maxOldSpaceMb : 480;

const serverProcess = spawn(
  'node',
  [
    '--expose-gc', // Enable manual garbage collection
    `--max-old-space-size=${maxOldSpaceArg}`, // Configurable heap limit
    join(__dirname, 'index.js'),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
  }
);

serverProcess.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
  process.exit(code);
});

serverProcess.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  serverProcess.kill('SIGTERM');
});
