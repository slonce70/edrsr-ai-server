# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation Lookup

When working with this project's dependencies, use **MCP context7** to fetch up-to-date documentation:

1. First resolve the library ID: `mcp__context7__resolve-library-id`
2. Then fetch docs: `mcp__context7__get-library-docs`

Key libraries to look up:
- `@google/generative-ai` - Gemini AI SDK
- `@supabase/supabase-js` - Supabase client
- `express` - Web framework
- `cheerio` - HTML parsing
- `got` - HTTP client
- `ws` - WebSocket library
- `pg` - PostgreSQL client

## Project Overview

EDRSR-AI is a system for collecting and analyzing Ukrainian court decisions from ЄДРСР (Unified State Register of Court Decisions) using Gemini AI. It consists of a Node.js/Express backend server and a Chrome extension (Manifest V3).

## Commands

### Development
```bash
npm run dev                    # Start server in development mode (port 4000)
npm run start:gc               # Production mode with manual GC and heap cap (~480MB)
npm run build:extension        # Build extension to extension-build/ + ZIP
```

### Code Quality
```bash
npm run lint                   # ESLint check
npm run lint:fix               # ESLint fix
npm run format                 # Prettier format
npm run quality:check          # Both lint and format check
```

### Admin Scripts
```bash
npm run admin:create           # Create admin user
npm run admin:grant            # Grant admin rights to existing user
npm run apply:rls              # Apply Supabase RLS policies
```

### Health Check
```bash
curl http://localhost:4000/api/health/light   # Quick health check
curl http://localhost:4000/api/health/full    # Full health check (requires admin auth)
```

## Architecture

### Monorepo Structure
- **`server/`** - Express backend with WebSocket support
- **`extension/`** - Chrome extension (Vanilla JS, Manifest V3)
- **`scripts/`** - Build and deployment scripts

### Server Components (`server/`)

| File | Purpose |
|------|---------|
| `index.js` | Entry point, initializes database and starts server |
| `server.js` | Express app setup, middleware, route mounting |
| `worker.js` | Worker thread for processing analysis jobs |
| `gemini.js` | Gemini AI integration (analysis, chat) |
| `scraper.js` | EDRSR page scraping with retry logic |
| `batchProcessor.js` | Batch processing of court decision links |
| `queue.js` | In-memory job queue |
| `websocket.js` | WebSocket for real-time progress updates |

### Server Directories
- **`routes/`** - API routes (`index.js` main API, `admin.js` admin endpoints, `auth.js` authentication)
- **`services/`** - `dbService.js` (database operations), `maintenance.js` (cache cleanup)
- **`middleware/`** - Auth, rate limiting, validation, security headers, error handling
- **`database/`** - PostgreSQL connection (`connection.js`)
- **`sql/`** - SQL scripts for RLS policies and admin setup
- **`public/admin/`** - Admin panel static files

### Extension Components (`extension/`)

| File | Purpose |
|------|---------|
| `bg.js` | Service worker (background script) |
| `popup.js` | Extension popup UI logic |
| `content.js` | Content script for EDRSR page interaction |
| `auth.js` | Supabase authentication |
| `config.js` | Extension configuration (Supabase URLs, API endpoint) |
| `results.js` | Results page for viewing analysis |

### Key Data Flows

1. **Job Processing Flow**:
   - Extension collects links from EDRSR page → POST `/api/collect`
   - Job created in PostgreSQL, added to queue
   - Worker thread spawned: scrapes pages → batch analysis with Gemini → stores results
   - WebSocket sends real-time progress updates to extension

2. **Authentication Flow**:
   - Extension uses Supabase Auth (email/password)
   - JWT token passed in Authorization header
   - Server validates via Supabase client, attaches user to request

3. **Chat Flow**:
   - Chat sessions stored in-memory with LRU eviction
   - History persisted to database per job
   - Uses Gemini's `startChat()` for multi-turn conversations

## Environment Variables

Key variables in `server/.env`:
- `GEMINI_API_KEY` - Required for AI analysis
- `DATABASE_URL` - PostgreSQL connection string
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` - For authentication
- `BATCH_SIZE` - Links per processing batch (default: 5)
- `PORT` - Server port (default: 4000)

## Database

PostgreSQL with tables:
- `jobs` - Analysis jobs with status, results, user ownership
- `job_links` - Individual links per job with scraped content
- `chat_history` - Chat messages per job
- `global_case_cache` - Cached scraped court decisions

RLS (Row Level Security) can be enabled via `npm run apply:rls` for strict per-user data isolation.

## Worker Thread Architecture

Jobs run in separate worker threads (`worker.js`) to avoid blocking the main event loop. The main thread:
- Manages worker lifecycle with health checks every 2 minutes
- Auto-terminates workers exceeding 25 minutes
- Handles job locking/leasing to prevent duplicate processing across restarts

## Extension Notes

- Uses long-lived port connection between popup and service worker
- Floating button injected on EDRSR pages for quick analysis trigger
- Modal dialog for selecting analysis prompts (built-in or custom)
- Results displayed via dedicated `results.html` page with export options (TXT/PDF)
