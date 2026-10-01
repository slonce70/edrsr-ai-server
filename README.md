# EDRSR-AI

EDRSR-AI collects public court-decision links from ЄДРСР (`reyestr.court.gov.ua`), runs asynchronous Gemini analysis and delivers the results through a Chrome extension, a React portal and an admin UI.

## Components

| Dir | What |
| --- | --- |
| `server/` | Node.js/Express API, queue and worker threads, WebSocket delivery, static admin UI (`/admin`). PostgreSQL for data, Supabase for auth. |
| `extension/` | Chrome MV3 extension: link collection, prompts, job tracking, auth, TXT/PDF export. Published in the Chrome Web Store. |
| `web/` | React + TypeScript + Vite portal: analyses, chat, prompts, workspaces, matters, share links. |
| `scripts/` | Extension packaging, RLS helper, self-checks, local quality gate. |

How the parts fit together: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Requirements

- Node.js 22 LTS (or 20.19+; Vite 7 requires it)
- PostgreSQL 12+
- A Supabase project (authentication only)
- One or more Gemini API keys
- Chrome or Edge for the extension

## Local setup

```bash
npm install
npm --prefix server install
npm --prefix web install
cp server/env.example server/.env     # then edit; every variable is documented in that file
```

Minimum to configure in `server/.env`: `DATABASE_URL`, `GEMINI_API_KEY` or `GEMINI_API_KEYS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (`SUPABASE_SERVICE_ROLE_KEY` for admin features).
The schema is created automatically on first start. To skip Supabase locally, set `DEV_AUTH_ENABLED=true` in `server/.env` and `VITE_DEV_AUTH_ENABLED=true` in `web/.env.local` (works only while `NODE_ENV` is not `production`).

```bash
npm run dev                  # backend on :4000 (reads server/.env)
npm run web:dev              # Vite portal, proxies /api and /ws to :4000
npm run build:extension      # unpacked dev build in extension-build/ (load it in chrome://extensions)
npm run test:selfcheck       # offline structural checks
npm run quality:local        # full local gate (see Verification)
```

Portal config is read at build time from `VITE_*` variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required for production builds; `VITE_API_BASE` (default `/api`) and `VITE_WS_PATH` (default `/ws`) are optional.
Without them, a local dev server falls back to the **production** Supabase project; create `web/.env.local` to point at your own. Full list: the appendix of [server/env.example](./server/env.example).

## Production

Single-VPS deployment (Caddy, systemd, PostgreSQL, TLS, GitHub deploy, Supabase redirect URLs, smoke tests): [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

Production endpoints:

- API: `https://edrsr-ai-server.fun/api` - health: `/api/health/light`
- Admin: `https://edrsr-ai-server.fun/admin`
- Portal: `https://app.edrsr-ai-server.fun`
- WebSocket: `wss://edrsr-ai-server.fun`

Start command on a server: `node --expose-gc --max-old-space-size=<MB> index.js` from `server/`. `npm run start:gc` (root) runs `server/start-with-gc.js` with the repo root as working directory, so it does not read `server/.env`: provide the environment from systemd or the shell.

## Chrome extension release

The published extension talks to fixed domains (see above) and to Supabase directly, so redeploying the backend on the same domains needs no new extension release.
Chrome Web Store extension ID: `dknfodmbknjengdbmdecidpapbiabgdb`. The server must list it in `CHROME_EXTENSION_IDS`, otherwise every extension request is rejected.

To publish a new version: bump `version` in `package.json` and `extension/manifest.json` (and `package-lock.json`), then

```bash
npm run build:extension:release      # writes edrsr-ai-extension-v<version>.zip to the repo root
```

The build copies `extension/` to `extension-build/`, rewrites `config.js` and `host_permissions` from `EXT_API_URL`, `EXT_WS_URL`, `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY`, `EXT_SUPABASE_REDIRECT_TO`
(falling back to the production values committed in `extension/config.js`; the script also loads `server/.env` if present, so unset stray `EXT_*` values), and zips it.
`host_permissions` are fixed at publish time: a new domain requires editing `extension/manifest.json` and a new Store version that users must re-consent to.
Listing text and checklist: [docs/STORE_LISTING.md](./docs/STORE_LISTING.md); privacy policy: [docs/PRIVACY_POLICY.md](./docs/PRIVACY_POLICY.md).

## Verification

```bash
npm run quality:local        # lint, format check, web build, extension build, dependency audits, offline regression scripts
npm --prefix web test        # portal unit tests (not part of the gate)
```

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - modules, job flow, security shape
- [docs/API.md](./docs/API.md) - HTTP and WebSocket API
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) - VPS deployment runbook
- [server/env.example](./server/env.example) - the single environment-variable reference
- [docs/STORE_LISTING.md](./docs/STORE_LISTING.md), [docs/PRIVACY_POLICY.md](./docs/PRIVACY_POLICY.md) - Chrome Web Store material

Maintainer conventions live in a local, git-ignored `AGENTS.md`.
