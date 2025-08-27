#!/usr/bin/env node

/**
 * Optimized startup script for EDRSR AI Server
 * Includes memory optimization and monitoring
 */

import { execSync, spawn } from 'child_process';
import { logger } from './utils.js';

// Memory optimization flags for Node.js (render.com compatible)
const NODE_OPTIONS = [
  '--max-old-space-size=2048',        // Limit heap to 2GB (render.com has plenty of memory)
  '--expose-gc',                      // Enable global.gc() for manual garbage collection
  '--trace-warnings',                 // Show deprecation warnings for debugging
  '--enable-source-maps'              // Better error stack traces
];

// Render.com forbidden flags (moved to spawn args if needed)
const RENDER_INCOMPATIBLE_FLAGS = [
  '--optimize-for-size',              // Not allowed in NODE_OPTIONS on render.com
  '--experimental-worker'             // Not allowed in NODE_OPTIONS on render.com
];

// Environment variables for memory optimization
const ENV_VARS = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'production',
  UV_THREADPOOL_SIZE: '16',           // Increase thread pool for I/O operations
  NODE_OPTIONS: NODE_OPTIONS.join(' ')
};

function checkSystemMemory() {
  try {
    // Check available system memory
    const memInfo = execSync('free -m', { encoding: 'utf8' });
    const lines = memInfo.split('\n');
    const memLine = lines.find(line => line.startsWith('Mem:'));
    
    if (memLine) {
      const parts = memLine.split(/\s+/);
      const totalMem = parseInt(parts[1]);
      const availableMem = parseInt(parts[6] || parts[3]); // available or free
      
      logger.info(`💾 System Memory: ${totalMem}MB total, ${availableMem}MB available`);
      
      if (availableMem < 512) {
        logger.warn('⚠️  Low system memory detected. Consider reducing --max-old-space-size');
      }
      
      if (totalMem < 1024) {
        ENV_VARS.NODE_OPTIONS = ENV_VARS.NODE_OPTIONS.replace('--max-old-space-size=2048', '--max-old-space-size=512');
        logger.info('🔧 Reduced heap size for low-memory system');
      } else if (totalMem > 16384) {
        // Render.com or high-memory systems - increase heap size
        ENV_VARS.NODE_OPTIONS = ENV_VARS.NODE_OPTIONS.replace('--max-old-space-size=2048', '--max-old-space-size=3072');
        logger.info('🚀 Increased heap size for high-memory system (3GB)');
      }
    }
  } catch (error) {
    logger.warn('Could not check system memory:', error.message);
  }
}

function startServer() {
  logger.info('🚀 Starting EDRSR AI Server with memory optimizations...');
  logger.info(`🧠 Node.js flags: ${ENV_VARS.NODE_OPTIONS}`);
  
  checkSystemMemory();
  
  // Additional args for spawn (not in NODE_OPTIONS due to render.com restrictions)
  const spawnArgs = ['index.js'];
  
  // Detect if running on render.com
  const isRenderCom = process.env.RENDER || process.env.RENDER_SERVICE_NAME;
  if (isRenderCom) {
    logger.info('🌐 Detected Render.com environment - using compatible flags');
  }
  
  // Start the server with optimized settings
  const server = spawn('node', spawnArgs, {
    env: ENV_VARS,
    stdio: 'inherit',
    cwd: process.cwd()
  });
  
  server.on('error', (error) => {
    logger.error('❌ Failed to start server:', error.message);
    process.exit(1);
  });
  
  server.on('exit', (code, signal) => {
    if (signal) {
      logger.info(`🛑 Server terminated by signal ${signal}`);
    } else if (code === 0) {
      logger.info('✅ Server exited successfully');
    } else {
      logger.error(`❌ Server exited with code ${code}`);
      
      // Auto-restart on certain error codes
      if (code === 1 || code === 137) { // 137 = SIGKILL (OOM)
        logger.info('🔄 Attempting restart in 5 seconds...');
        setTimeout(() => {
          startServer();
        }, 5000);
      } else if (code === 9) { // Invalid command line arguments
        logger.error('❌ Invalid Node.js command line arguments detected.');
        logger.error('This usually happens when using incompatible flags with the hosting platform.');
        logger.info('💡 Try using npm run start:basic for fallback startup');
      }
    }
  });
  
  // Graceful shutdown handlers
  process.on('SIGINT', () => {
    logger.info('🛑 Received SIGINT, shutting down gracefully...');
    server.kill('SIGTERM');
  });
  
  process.on('SIGTERM', () => {
    logger.info('🛑 Received SIGTERM, shutting down gracefully...');
    server.kill('SIGTERM');
  });
  
  return server;
}

// Memory monitoring (optional)
function startMemoryMonitoring() {
  const MONITOR_INTERVAL = 30000; // 30 seconds
  
  setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    
    if (heapUsedMB > 800) {
      logger.warn(`📊 High memory usage: Heap ${heapUsedMB}/${heapTotalMB}MB, RSS ${rssMB}MB`);
    } else {
      logger.debug(`📊 Memory usage: Heap ${heapUsedMB}/${heapTotalMB}MB, RSS ${rssMB}MB`);
    }
  }, MONITOR_INTERVAL);
}

// Main execution
if (process.env.ENABLE_MEMORY_MONITORING === 'true') {
  startMemoryMonitoring();
}

startServer();
