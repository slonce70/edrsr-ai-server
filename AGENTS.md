# Repository Guidelines

## Project Structure & Module Organization
- `server/`: Node.js (ESM) Express backend, scraping, AI, DB, WebSocket. Public admin UI in `server/public/admin/`.
- `extension/`: Chrome extension (Manifest V3) sources; built output in `extension-build/`.
- `docs/`: Project documentation (API, env, admin, ADRs).
- `scripts/`: Build and admin utilities (e.g., `scripts/build-extension.js`).
- Root config: `eslint.config.js`, `.prettierrc.json`, `package.json` (monorepo root).

## Build, Test, and Development Commands
- `npm run dev`: Start backend in dev (`server/index.js`) on `:4000`.
- `npm run start:gc`: Start backend with GC + memory caps for prod-like runs.
- `npm run build:extension`: Build Chrome extension to `extension-build/` and zip.
- `npm run lint` / `npm run lint:fix`: ESLint check/fix across repo.
- `npm run format` / `npm run format:check`: Prettier write/check.
- `npm run quality:check` / `quality:fix`: Lint + format checks/fixes.
- Health checks: `curl http://localhost:4000/api/health/{light|full}`.
- Memory test: `npm run test:memory` (simulated workload, fails on high usage).

## Coding Style & Naming Conventions
- Language: JavaScript (ES modules) with `type: module`.
- Formatting (Prettier): 2 spaces, semicolons, single quotes, width 100.
- Linting (ESLint): no `var`, prefer `const`, unused vars must be `_`-prefixed. Console allowed in `server/`, limited in `extension/`.
- Files: `.js` modules; prefer kebab-case for multiword filenames (e.g., `start-with-gc.js`).
- Identifiers: lowerCamelCase for variables/functions; UPPER_SNAKE_CASE for env.

## Testing Guidelines
- Framework: none configured. Use integration checks:
  - Health endpoints and admin UI (`/admin`).
  - Memory stability: `npm run test:memory`.
- Add new tests colocated near code or under `server/tests/` if introduced; keep commands runnable via `npm test` when added.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat: …`, `fix: …`, `docs: …`).
- Branches: `feature/<topic>`, `fix/<topic>`, `docs/<topic>`.
- PRs: clear description, linked issues, reproduction/validation steps, and for UI changes attach screenshots (extension/admin). Run `npm run quality:check` before submitting.

## Security & Configuration Tips
- Never commit secrets. Copy `server/env.example` to `server/.env` and fill `GEMINI_API_KEY`, `SUPABASE_*`, `DATABASE_URL`.
- Extension auth: update `extension/config.js` (Supabase settings). Build patches URLs automatically.
- Rate limits and RLS: see `docs/ENVIRONMENT_VARIABLES.md` and `npm run apply:rls`.

