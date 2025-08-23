# Repository Guidelines

## Project Structure & Module Organization
- `server/`: Express + WebSocket (ESM). Keep routes in `server/routes/`, shared helpers in `server/utils.js`, and auth middleware in `server/middleware/`.
- `extension/`: Chrome MV3 source (UI, background, content scripts). Build artifacts are produced by `npm run build:extension`.
- `scripts/`: Build/release helpers.
- Root configs: `eslint.config.js`, `.prettierrc.json`. Server env lives in `server/.env` (never commit secrets).

## Build, Test, and Development Commands
```bash
npm run dev            # Start server on :4000 (Express/WebSocket)
npm run build:extension# Build the MV3 extension
npm run lint           # Lint with ESLint
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Prettier
npm run format:check   # Check formatting
npm run test:memory    # Memory test/smoke checks
```

## Coding Style & Naming Conventions
- Prettier: 2 spaces, single quotes, semicolons, line width 100.
- ESLint: follow project rules; keep imports ESM-only with explicit `.js` extensions.
- Naming: kebab-case for files/dirs; camelCase for variables/functions; PascalCase for classes.
- Structure routes by feature in `server/routes/*.js`; keep small, focused modules; dedupe shared logic in `server/utils.js`.

## Testing Guidelines
- Prefer colocated tests: `module.test.js` near the code or in `__tests__/` next to it.
- Keep tests deterministic; cover core routes, middleware, and utils. Run `npm run test:memory` before PRs.

## Commit & Pull Request Guidelines
- Commit messages: imperative mood with scope, e.g. `server: add supabase auth middleware`, `extension: login ui`.
- PRs must include: purpose, concise change summary, linked issues, verification steps/commands, and screenshots for UI changes.
- Pass lint/format checks before requesting review.

## Security & Configuration Tips
- Configure `server/.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `PORT=4000`.
- Client (extension) authenticates via Supabase email; send `Authorization: Bearer <jwt>` to the server.
- Server validates JWT via Supabase, assigns `req.user`, and all DB queries must filter by `user_id`. Enable RLS with per-user policies in Postgres.

