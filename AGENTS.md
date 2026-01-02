# Project Snapshot
- Repo type: small monorepo (backend + Chrome extension + web portal).
- Stack: Node.js (ESM) + Express + ws + Postgres; React + TypeScript + Vite; Chrome MV3 (vanilla JS).
- Supabase is used for auth; app data lives in local Postgres.
- Each major folder has its own AGENTS.md (nearest-wins).

## Root Setup Commands
- Install deps (root): `npm install`
- Backend deps: `npm --prefix server install`
- Web deps: `npm --prefix web install`
- Dev backend: `npm run dev`
- Dev web: `npm run web:dev`
- Prod-like backend: `npm run start:gc`
- Build web (includes tsc): `npm run web:build`
- Build extension: `npm run build:extension`
- Quality checks: `npm run quality:check`
- Ad-hoc checks: `npm run test:selfcheck`, `npm run test:memory`

## Universal Conventions
- ESM modules (`type: module`): use `import`/`export`.
- Prettier is the source of truth (2-space indent, single quotes, semicolons).
- ESLint + Prettier enforce baseline rules; keep `console` minimal in shared code.
- Naming: kebab-case files, camelCase functions, PascalCase classes.
- Commits: Conventional Commits (e.g., `feat: ...`, `fix(web): ...`).

## Security & Secrets
- Secrets live in `server/.env`; template is `server/env.example`.
- Never commit tokens/keys; `extension/config.js` must not include private creds.
- Vite env: only expose `VITE_*` public values (no service role keys).

## JIT Index (what to open, not what to paste)

### Package Structure
- Backend server: `server/` → `server/AGENTS.md`
  - API routes: `server/routes/` → `server/routes/AGENTS.md`
  - Middleware: `server/middleware/` → `server/middleware/AGENTS.md`
  - DB connection/schema: `server/database/` → `server/database/AGENTS.md`
  - Services (DB/business logic): `server/services/` → `server/services/AGENTS.md`
  - Dev/ops scripts: `server/scripts/` → `server/scripts/AGENTS.md`
  - SQL / RLS: `server/sql/` → `server/sql/AGENTS.md`
  - Admin UI (static): `server/public/admin/` → `server/public/admin/AGENTS.md`
- Chrome extension: `extension/` → `extension/AGENTS.md`
- Web portal: `web/` → `web/AGENTS.md`
- Repo scripts: `scripts/` → `scripts/AGENTS.md`
- Docs: `docs/` → `docs/AGENTS.md`
- Generated outputs (do not edit): `extension-build/`, `edrsr-ai-extension-v*.zip`

### Quick Find Commands
- Find an API endpoint: `rg -n "router\\.(get|post|patch|put|delete)\\(" server/routes`
- Find middleware: `rg -n "export (async )?function" server/middleware`
- Find DB queries: `rg -n "database\\.(get|run|all)\\(" server/services`
- Find WebSocket usage: `rg -n "initWebSocket|sendUpdateToJobOwner|WEBSOCKET" server web extension`
- Find extension message flow: `rg -n "chrome\\.runtime\\.(connect|onMessage|sendMessage)" extension`
- Find web routes: `rg -n "<Route|path=\\\"" web/src/App.tsx`
- Find web API calls: `rg -n "apiRequest\\(" web/src`

## Definition of Done
- `npm run quality:check` passes.
- If web changed: `npm run web:lint && npm run web:build`.
- If extension changed: `npm run build:extension` and test via `extension-build/`.
- If scraper/parsing changed: `node server/scripts/test-scraper-parsing.js`.
