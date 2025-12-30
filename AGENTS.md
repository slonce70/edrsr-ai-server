# Repository Guidelines

## Project Structure & Module Organization
- `server/`: Node.js/Express backend (API, scraping, AI analysis, jobs, WebSocket). Key areas: `server/routes/`, `server/services/`, `server/database/`, `server/sql/`, `server/public/` (admin UI assets).
- `extension/`: Chrome extension (popup, content scripts, UI, auth config in `extension/config.js`).
- `scripts/`: repo-level utilities (build extension, apply RLS, self-checks).
- `docs/`: reference docs and ADRs.
- Generated outputs: `extension-build/` and `edrsr-ai-extension-v*.zip` (do not edit by hand).

## Build, Test, and Development Commands
- `npm install` and `npm --prefix server install`: install root + server deps.
- `npm run dev`: run backend in dev mode (uses `server/index.js`).
- `npm run start:gc`: production-like start with GC and heap cap.
- `npm run build:extension`: build the Chrome extension into `extension-build/`.
- `npm run lint` / `npm run format` / `npm run quality:check`: lint and format checks.
- `npm run test:memory` or `node server/scripts/test-scraper-parsing.js`: run ad-hoc validation scripts.

## Coding Style & Naming Conventions
- ESM modules (`"type": "module"`). Prefer `import`/`export`.
- Prettier is the source of truth: 2-space indent, single quotes, semicolons, 100-char line width.
- ESLint + Prettier enforce baseline rules; keep `console` minimal in shared code.
- File names are typically kebab-case (`start-optimized.js`); functions camelCase; classes PascalCase.

## Testing Guidelines
- No formal test framework yet; tests are lightweight scripts under `server/scripts/` (e.g., `test-scraper-parsing.js`, `memory-load-test.js`).
- Name new checks with `test-*.js` and keep them runnable via `node`.
- For changes that affect scraping or parsing, add a focused script and document how to run it.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits (e.g., `feat: ...`, `fix(admin): ...`, `perf(cli-proxy): ...`, `docs(env): ...`).
- PRs should include a short summary, testing notes (commands run), and screenshots for UI/extension changes.
- Link related issues and call out any config or migration steps.

## Configuration & Security Tips
- Use `server/.env` (see `server/env.example`) for secrets and environment config.
- Keep API keys out of git; avoid committing `extension/config.js` with real credentials.
- If enabling strict data isolation, apply RLS via `npm run apply:rls` (uses `server/sql/`).
