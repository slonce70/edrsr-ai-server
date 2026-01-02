# Repository Guidance (Root)

## Project Snapshot
- Repo type: small monorepo (backend + Chrome extension + web portal).
- Backend: Node.js (ESM) + Express + WebSocket (`ws`) + workers; Postgres (`pg`); Supabase auth.
- Extension: Chrome MV3, vanilla JS/HTML, ES modules.
- Web: React + TypeScript + Vite; Supabase auth; backend API + WebSocket.
- More detailed, scoped guidance lives in subfolder AGENTS files (nearest-wins).

## Root Setup Commands
- Install deps: `npm install`
- Install backend deps: `npm --prefix server install`
- Install web deps: `npm --prefix web install`
- Run dev backend: `npm run dev`
- Run dev web: `npm run web:dev`
- Prod-like start: `npm run start:gc`
- Build extension: `npm run build:extension`
- Build web: `npm run web:build`
- Quality checks: `npm run quality:check` (or `npm run quality:fix`)
- Ad-hoc validation: `npm run test:selfcheck`, `npm run test:memory`

## Universal Conventions
- ESM modules (`"type": "module"`): prefer `import`/`export`.
- Prettier is the source of truth: 2-space indent, single quotes, semicolons, ~100-char line width.
- ESLint + Prettier enforce baseline rules; keep `console` minimal in shared code.
- Naming: files are typically kebab-case; functions camelCase; classes PascalCase.
- Commits: Conventional Commits (e.g., `feat: ...`, `fix(admin): ...`).

## Security & Secrets
- Secrets live in `server/.env`; template: `server/env.example`.
- Never commit tokens/keys; `extension/config.js` should not contain private credentials.
- Web/Vite env: only expose `VITE_*` public values (never Supabase service role keys).

## JIT Index (what to open, not what to paste)

### Package Map
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
- Generated outputs (do not hand-edit): `extension-build/`, `edrsr-ai-extension-v*.zip`

### Quick Find Commands
- Find an API endpoint: `rg -n "router\\.(get|post|patch|put|delete)\\(" server/routes`
- Find a middleware: `rg -n "export (async )?function" server/middleware`
- Find a DB query: `rg -n "database\\.(get|run|all)\\(" server`
- Find WebSocket usage: `rg -n "initWebSocket|sendUpdateToJobOwner|WEBSOCKET" server extension`
- Find extension message flow: `rg -n "chrome\\.runtime\\.(connect|onMessage|sendMessage)" extension`
- Find web routes: `rg -n "<Route|path=\\\"" web/src/App.tsx`
- Find web API calls: `rg -n "apiRequest\\(" web/src`

## Definition of Done
- `npm run quality:check` passes
- If extension changed: `npm run build:extension` and test by loading `extension-build/` in Chrome
- If web changed: `npm run web:lint && npm run web:build`
- If scraping/parsing changed: run `node server/scripts/test-scraper-parsing.js`
