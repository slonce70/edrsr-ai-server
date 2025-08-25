# Repository Guidelines

## Project Structure & Module Organization
- `server/`: Express backend (routes, middleware, database, SQL, scripts). Entrypoint: `server/index.js`.
- `extension/`: Chrome extension (manifest, content/background scripts, UI HTML/JS).
- `extension-build/`: Production build output (gitignored); zip artifact is created at repo root.
- `scripts/`: Build/ops helpers (`build-extension.js`, `apply-rls.js`).
- `docs/`: User-facing docs and references.

## Build, Test, and Development Commands
- `npm run dev`: Start backend locally (uses `server/.env`, port `4000` by default).
- `npm run build:extension`: Patch URLs, copy to `extension-build/`, and create versioned zip.
- `npm run lint` / `npm run lint:fix`: Lint JavaScript via ESLint 9.
- `npm run format` / `npm run format:check`: Format/check with Prettier.
- `npm run test:memory`: Run server memory/load test.
- `npm run admin:create` / `npm run admin:grant`: Bootstrap/assign admin roles.

## Coding Style & Naming Conventions
- Language: JavaScript ESM (`"type": "module"`); use `import`/`export`.
- Formatting: Prettier (2-space indent, semicolons). Run `npm run quality:fix` before PRs.
- Linting: ESLint (flat config `eslint.config.js`). Fix warnings where feasible.
- Naming: `camelCase` for vars/functions, `UPPER_SNAKE_CASE` for constants. Filenames lowercased with hyphens or camelCase (e.g., `routes/index.js`, `qualityControl.js`).

## Testing Guidelines
- Current state: no formal unit tests. Validate via:
  - Health checks: `GET /api/health/light` and `/api/health/full`.
  - Load: `npm run test:memory`.
  - Extension: load `extension/` as unpacked in Chrome and verify flows.
- Future tests: add under `server/__tests__/` (Jest recommended). Target critical paths and DB access.

## Commit & Pull Request Guidelines
- Commits: `type(scope): message` (e.g., `server(admin): …`, `docs: …`, `extension: …`, `chore: …`). Use imperative mood.
- PRs: include summary, linked issues, validation steps, env changes, and screenshots for UI/extension changes.
- Pre-flight: run `npm run quality:check` and keep `server/env.example` updated when env keys change.

## Security & Configuration
- Copy `server/env.example` to `server/.env`; set `DATABASE_URL` and optional `PORT`/`RENDER_EXTERNAL_URL`.
- Do not commit secrets; `.env*`, build output, and zips are gitignored.
- Extension build respects `EXT_DEV_API_URL/EXT_DEV_WS_URL` and `EXT_PROD_API_URL/EXT_PROD_WS_URL` during `build:extension`.

