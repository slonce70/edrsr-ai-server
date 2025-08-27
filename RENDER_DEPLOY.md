# 🚀 Render.com Deployment Guide

## ⚠️ Issue with `--optimize-for-size` flag

**Problem:** Render.com restricts certain Node.js flags in NODE_OPTIONS environment variable.

**Error message:** 
```
node: --optimize-for-size is not allowed in NODE_OPTIONS
Server exited with code 9
```

## ✅ Solution

The main `npm start` command is now optimized for Render.com compatibility:

```bash
npm start  # ✅ Works on Render.com
```

This runs:
```bash
node --max-old-space-size=2048 --expose-gc --trace-warnings --enable-source-maps index.js
```

## 📋 Available Commands

| Command | Description | Render.com Compatible |
|---------|-------------|----------------------|
| `npm start` | **Recommended for Render.com** | ✅ Yes |
| `npm run start:basic` | Minimal Node.js setup | ✅ Yes |
| `npm run start:optimized` | Advanced optimization script | ❌ No (uses NODE_OPTIONS) |
| `npm run start:monitor` | With memory monitoring | ❌ No (uses NODE_OPTIONS) |

## 🔧 Render.com Configuration

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

**Environment Variables:**
- No special NODE_OPTIONS needed
- All memory flags are handled in the start command

## 📊 Memory Settings

- **Heap Size:** 2GB (automatically adjusted based on available system memory)
- **Garbage Collection:** Enabled (`--expose-gc`)
- **Source Maps:** Enabled for better error tracking
- **Warnings:** Enabled for debugging

## 🐛 Troubleshooting

**If you still get exit code 9:**

1. Try the basic startup:
   ```bash
   npm run start:basic
   ```

2. Check Render.com logs for specific flag restrictions

3. Ensure no custom NODE_OPTIONS are set in Render.com environment variables

## 🏆 Benefits for Render.com

- ✅ Increased memory limit (2GB vs default 512MB)
- ✅ Manual garbage collection available
- ✅ Better error reporting with source maps
- ✅ Compatible with Render.com restrictions
- ✅ High memory utilization for large workloads

## 📝 Notes

- The `start-optimized.js` script is available for local development
- Render.com automatically handles process monitoring and restarts
- Memory optimization is built into the main startup command
