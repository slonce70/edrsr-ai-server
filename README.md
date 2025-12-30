# EDRSR-AI 🤖⚖️ 

**A professional system for collecting and analyzing court decisions from the EDRSR using Gemini AI.**

[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)]()
[![Version](https://img.shields.io/badge/Version-1.0.8-blue)]()
[![AI](https://img.shields.io/badge/AI-Gemini%203%20Pro%20%2B%202.5%20Flash-orange)]()
[![Database](https://img.shields.io/badge/Database-PostgreSQL-blue)]()

This is a comprehensive system for automatically collecting court decisions from the Unified State Register of Court Decisions (ЄДРСР) with intelligent analysis via Gemini AI. It includes a professional Chrome extension with a real-time interface and a powerful backend with asynchronous job processing.

## 🎯 **Project Status: PRODUCTION READY**

The system is fully ready for production use with major performance optimizations. Memory usage has been optimized from 500MB+ to stable 30MB, all critical bugs have been fixed, and the project features a professional UI/UX design, robust error handling, and real-time progress updates and chat with the AI.

## 🌟 **Key Features**

- **📥 Automated Collection**: Intelligent parsing of court decisions from any page of the ЄДРСР, now including the **decision date**.
- **⚡️ Intelligent Caching**: All scraped cases are stored in a persistent global cache with automatic cleanup. Subsequent analyses of the same case are performed instantly, without redundant network requests, dramatically saving time and resources.
- **🧠 Memory Optimization**: Advanced memory management with garbage collection, preventing memory leaks and ensuring stable operation even with large datasets (optimized from 500MB+ to stable 30MB usage).
- **🤖 Advanced AI Analysis**: A highly flexible system with multiple analysis modes:
  - **Context-Aware Summaries**: For custom queries, the AI first understands the end goal, then creates highly relevant, detailed summaries from each case.
  - **Detailed Annotation**: A special mode to generate deep, structured annotations for each individual case in a large batch.
  - **Enriched Reports**: Final reports now include the decision date next to each case link (e.g., `[Case №...](URL) (Date)`), providing critical context at a glance.
  - **Primary + Fallback Models**: CLI proxy can use Gemini 3 Pro as primary with configurable Gemini 2.5 fallback (Pro/Flash).
- **🔐 Supabase Auth**: Email/password login and registration in the extension; per‑user data isolation (optionally enforced with RLS).
- **💬 AI Chat**: Interactive Q&A on the analysis results.
- **📄 Flexible Report Export**: Choose between compact text files (TXT) or high-quality PDF images for report downloads.
- **⚡ Real-time Updates**: WebSockets for instant, real-time progress tracking with guaranteed sequential log ordering and memory usage monitoring.
- **🎯 Chrome Extension**: A modern interface with Manifest V3, a popup window, and a convenient on-page floating menu. Both analysis triggers are now unified and use the same reliable data collection logic.
- **📊 Robust Job System**: Asynchronous processing with a queue system and worker threads to handle large jobs without blocking, with automatic memory cleanup.

## 📁 **Project Architecture**

The project is a monorepo containing the `server` and `extension` directories.

- **`server/`**: The backend, built with Node.js and Express. It handles the scraping, AI analysis, and database interactions.
- **`extension/`**: The Chrome extension, built with Vanilla JS. It provides the user interface for interacting with the system.
- **`scripts/`**: Contains build scripts for the project.
- **`ROADMAP.md`**: The project's detailed development plan.

## ⚙️ **Installation and Setup**

### **1. System Requirements**
- **Node.js**: 16+
- **PostgreSQL**: 12+
- **Browser**: Chrome or Edge
- **API Key**: Gemini AI API key

### **2. Backend Setup**

```bash
# Install dependencies
npm install
cd server && npm install

# Setup PostgreSQL database
createdb edrsr_ai

# Create and configure .env file
cp server/.env.example server/.env
# Then edit server/.env with your configuration:
# - GEMINI_API_KEY
# - DATABASE_URL (Supabase Postgres or your Postgres)
# - SUPABASE_URL, SUPABASE_ANON_KEY (for token validation)
```

### **3. Supabase Authentication**
- In Supabase Console → Authentication → Providers: enable Email/Password.
- In Settings → API: copy Project URL (SUPABASE_URL) and anon key (SUPABASE_ANON_KEY) to `server/.env` and `extension/config.js`.
- In Settings → Auth → URL Configuration: add your redirect URL used by the extension (SUPABASE_REDIRECT_TO).
- Optional: apply RLS policies for strict per‑user isolation:
  - Run: `npm run apply:rls` (uses `server/sql/apply_rls.sql`).

### **Supabase Quick Start (Checklist)**
- Create project: supabase.com → New project → wait for provisioning.
- Enable Email/Password: Authentication → Providers → Email → Enable.
- Grab credentials: Settings → API → copy Project URL and anon public key.
- Configure env and extension:
  
  `server/.env` (example)
  
  ```env
  SUPABASE_URL=https://<your-project>.supabase.co
  SUPABASE_ANON_KEY=<anon_public_key>
  DATABASE_URL=postgresql://<supabase-conn-string>
  GEMINI_API_KEY=...
  ```
  
  `extension/config.js`
  
  - Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_REDIRECT_TO`.
  - Add `SUPABASE_REDIRECT_TO` into Supabase → Settings → Auth → Redirect URLs.
- Optional RLS (strict isolation): `npm run apply:rls`.
- Start backend: `npm install` → `npm run dev`.
- Load extension (Developer Mode) and open tab "🔐 Вхід": sign in or sign up.
- If email confirmation is enabled, confirm via email, then sign in.
- Verify: history and jobs are visible only for the signed‑in account.

### **4. Running the System**

```bash
# Development mode (no memory limits)
npm run dev

# Production mode with memory optimization (manual GC + heap cap)
npm run start:gc
```

**Memory Optimization**: The production mode (`start:gc`) enables manual garbage collection and sets a heap limit (~480MB) to ensure stable operation with large datasets.

Environment variables:

- `BATCH_SIZE` — number of links per batch (default: 5).
- `OVERALL_REQUEST_TIMEOUT_MS` — overall timeout per URL (default: 60000).
- `GOT_REQUEST_TIMEOUT_MS` — per‑attempt HTTP timeout (default: 45000).
- `MEMORY_LIMIT_MB` — soft limit for logging warnings (default: 500).

### **5. Building and Installing the Chrome Extension**

Build for production:

```bash
npm run build:extension
```

This creates a production-ready folder `extension-build/` and a distributable archive `edrsr-ai-extension-v<version>.zip` in the project root.

Update extension config for auth:

Edit `extension/config.js` and set:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `SUPABASE_REDIRECT_TO` (must be whitelisted in Supabase → Auth → Redirect URLs)

Install locally for testing:

1. Open `chrome://extensions/`.
2. Enable "Developer mode".
3. Click "Load unpacked".
4. Select the `extension-build/` directory.

For Chrome Web Store publishing, use the generated `.zip` archive.

## 🚀 **Usage**

1.  **Start the server**: `npm run dev` (development) or `npm run start:gc` (production)
2.  **Open EDRSR**: Navigate to [reyestr.court.gov.ua](https://reyestr.court.gov.ua)
3.  **Sign in**: Open the extension popup → tab "🔐 Вхід" to log in or sign up. If email confirmation is enabled, confirm and then sign in.
4.  **Analyze**: Click the "🤖 Analyze with AI" button on the page.
4.  **Track Progress**: See real-time updates in the extension popup with memory usage monitoring.
5.  **Get Results**: Receive a Markdown report with the analysis.
6.  **Download Reports**: Choose between TXT (compact) or PDF (visual) formats.
7.  **Per‑user history**: Job history and statuses are visible only for the signed‑in account.

## 🔧 **Performance & Optimization**

### **Memory Management**
- **Optimized Memory Usage**: Reduced peak usage via batch processing and manual GC
- **Automatic Cleanup**: Memory is cleared after each batch and after AI analysis
- **Cache Management**: Intelligent cache cleanup keeps only the 1000 most recent entries
- **Real-time Monitoring**: Memory usage is tracked and displayed during processing

### **Production Deployment**
- Use `npm run start:gc` for production with manual GC and heap cap
- Heap limit set to ~480MB (`--max-old-space-size=480`)
- Batches of 10 by default (`BATCH_SIZE`), with forced `global.gc()` between batches (when available)
- Structured memory metrics in logs: batch progress with heap and rss, warnings at `MEMORY_WARNING_MB`

## 📞 **Support & Feedback**

- **GitHub**: [Repository](https://github.com/slonce70/edrsr-ai-server) for the full source code.
- **Issues**: For bug reports and feature requests.
- **Documentation**: 
  - [QUICK_COMMANDS.md](./docs/QUICK_COMMANDS.md) - **🚀 Быстрые команды для ежедневного использования**
  - [API_REFERENCE.md](./docs/API_REFERENCE.md) - **🔌 Документация актуальных API эндпоинтов**
  - [ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md) - **🌍 Переменные окружения**
  - [ADMIN_SCRIPTS.md](./docs/ADMIN_SCRIPTS.md) - **🛠️ Админские скрипты**
  - [ADMIN_SETUP.md](./docs/ADMIN_SETUP.md) - **Настройка админки**
  - [MEMORY_OPTIMIZATION.md](./docs/MEMORY_OPTIMIZATION.md) - **🧠 Оптимизация памяти**
  - [SECURITY_AUDIT_REPORT.md](./docs/SECURITY_AUDIT_REPORT.md) - **🔐 Аудит безопасности**

## 📝 **License**

MIT License. See the `LICENSE` file for details.
