# Repository Guidelines

## Project Structure & Module Organization
- Root: Node.js monorepo (ES modules) with `server/`, `extension/`, `scripts/`, and `docs/`.
- `server/`: Express backend (routes, middleware, services, queue, workers). Examples: `server/routes/*.js`, `server/middleware/*.js`, `server/services/dbService.js`, `server/sql/*.sql`.
- `extension/`: Chrome extension (MV3) assets and JS (`manifest.json`, `popup.html`, `content.js`, `config.js`).
- `scripts/`: Build/admin utilities (e.g., `build-extension.js`, `apply-rls.js`, `selfcheck.js`).
- `docs/`: Operational guides (API, env vars, admin setup, quick commands).

## Build, Test, and Development Commands
- `npm install && (cd server && npm install)`: Install dependencies (root + server).
- `npm run dev`: Start backend (development, no GC limits).
- `npm run start:gc`: Start backend with memory optimization for production.
- `npm run build:extension`: Build extension to `extension-build/` and ZIP.
- `npm run lint` | `npm run lint:fix`: Lint code | auto‑fix.
- `npm run format` | `npm run format:check`: Prettier format | verify.
- `npm run test:selfcheck`: Lightweight validation of core validators and URL checks.
- `npm run test:memory`: Synthetic memory load test (no network/DB).

## Coding Style & Naming Conventions
- Style: Prettier + ESLint. Key Prettier rules: 2‑space indent, single quotes, semicolons, width 100, trailing commas `es5`.
- Modules: ES modules (`type: module`). Prefer `camelCase` for server module filenames (e.g., `dbService.js`) and `kebab-case` for scripts/entrypoints (e.g., `start-optimized.js`).
- JS: `camelCase` variables/functions, `PascalCase` classes; avoid unused vars; `console` is allowed on server, limited in extension.

## Testing Guidelines
- Framework: None. Use `npm run test:selfcheck` for quick checks and `npm run test:memory` for stability.
- Coverage: Prefer adding targeted selfchecks for validators and utils in `scripts/selfcheck.js` before PRs.
- Manual checks: Hit `GET /api/health/light` and verify admin UI at `/admin` locally.

## Commit & Pull Request Guidelines
- Commits: Follow Conventional Commits seen in history: `feat:`, `fix:`, `docs:`, `config:`, optional scopes like `server(queue):`.
- PRs: Include clear description, rationale, before/after behavior, screenshots or logs when UI/ops change, and links to issues (e.g., `Closes #123`).
- Quality gate: Run `npm run quality:check` (lint + format check) and relevant tests; update `docs/` when APIs or env change.

## Security & Configuration Tips
- Do not commit secrets. Use `server/env.example` and see `docs/ENVIRONMENT_VARIABLES.md`.
- Optional RLS: `npm run apply:rls` applies per‑user isolation policies (PostgreSQL/Supabase).
