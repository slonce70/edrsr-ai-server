# Repository Guidelines

## Project Structure & Module Organization
- `server/` – Express backend; `routes/` define HTTP entry points, `services/` handle business logic, and `sql/` plus `database/` manage persistence.
- `extension/` – Chrome extension bundle (background scripts, popup UI, shared prompts). Keep generated artifacts outside this folder.
- `scripts/` – Operational tooling for extension builds, Supabase RLS updates, and repository self-checks.
- `docs/` – Legal workflow notes and operational playbooks; update whenever APIs or agent behaviors change.
- Static admin pages live in `server/public/`; treat all `node_modules/` directories as generated output.

## Build, Test, and Development Commands
- `npm run dev` – start the backend in watch mode via `server/index.js`.
- `npm run build:extension` – bundle the extension into `extension-build/`.
- `npm run lint` | `npm run lint:fix` – run ESLint across server, extension, and scripts (autofix when needed).
- `npm run format:check` | `npm run format` – Prettier compliance gate and formatter.
- `npm run test:selfcheck` – lightweight diagnostics covering lint, config sanity, and required files.

## Coding Style & Naming Conventions
ESM JavaScript is standard. Prettier enforces 2-space indentation, single quotes, trailing commas, and semicolons (`.prettierrc.json`). Mirror existing naming: camelCase for reusable modules (`parallelBatchProcessor.js`), kebab-case for runtime entry points (`start-optimized.js`). Respect ESLint rules—prefix intentionally unused variables with `_`, avoid `var`, and keep console logging rare in extension code.

## Testing Guidelines
The project lacks a dedicated unit framework today. Always run `npm run test:selfcheck` before committing and paste the outcome in your PR description. Manually exercise touched server routes and extension flows, logging high-risk scenarios in PR notes until automated coverage arrives.

## Commit & Pull Request Guidelines
Use imperative, scope-prefixed commit subjects (`server: harden pg connection`, `config(server): raise scraper limit`). Keep subjects under ~72 characters and add detail lines when multiple surfaces change. Pull requests should link issues, describe behavior changes, list validation commands, and include screenshots for UI adjustments.

## Security & Configuration Tips
Provision environment variables from `.env` modeled on `server/env.example`; never commit secrets. When adjusting Supabase policies or worker concurrency, run `npm run apply:rls` and document follow-up steps in `docs/` so operators can mirror the rollout.
