# EDRSR-AI

EDRSR-AI collects public court-decision links from ЄДРСР, runs asynchronous Gemini analysis, and exposes the results through a Chrome extension, a React portal, and an admin UI.

Current package version: `2.0.6`

## Runtime Surfaces

- `server/` - Node.js/Express API, Postgres schema, queue, workers, WebSocket delivery, and static admin UI.
- `extension/` - Chrome MV3 extension for collection, prompts, status tracking, auth, and TXT/PDF export.
- `web/` - React + TypeScript portal for analyses, chat, prompts, workspaces, matters, and share links.
- `scripts/` - repo-level helpers for extension packaging, RLS application, self-checks, and local quality gates.

## Required Services

- Node.js 20+
- PostgreSQL 12+
- Supabase project for auth
- Gemini API key or keys
- Chrome or Edge for the extension

## Setup

```bash
npm install
npm --prefix server install
npm --prefix web install
cp server/env.example server/.env
```

Then configure at minimum:

- `DATABASE_URL`
- `GEMINI_API_KEY` or `GEMINI_API_KEYS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for admin operations
- production/staging CORS and WebSocket origins, including the Chrome Web Store extension ID

Full env reference: [docs/ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md).

## Local Commands

```bash
npm run dev                 # backend on :4000
npm run web:dev             # Vite portal
npm run build:extension     # unpacked dev extension-build/
npm run test:selfcheck      # no-network structural checks
npm run quality:local       # local umbrella quality gate
```

Production-style backend start:

```bash
npm run start:gc
```

## Chrome Extension Release

For Chrome Web Store publishing, bump the package/manifest version and run:

```bash
npm run build:extension:release
```

This creates `edrsr-ai-extension-v<version>.zip` in the repo root and patches the packaged extension to production URLs:

- API: `https://edrsr-ai-server.fun/api`
- WebSocket: `wss://edrsr-ai-server.fun`

Current Chrome Web Store extension ID:

```text
dknfodmbknjengdbmdecidpapbiabgdb
```

Production must allow `chrome-extension://dknfodmbknjengdbmdecidpapbiabgdb` via both HTTP CORS and WebSocket origin config. See [docs/ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md).

## Verification

Use the broad gate before publishing or deploying:

```bash
npm run quality:local
git diff --check
```

`quality:local` runs lint, formatting checks, web build, extension build, audits, and regression scripts including scraper, security, queue, websocket, Gemini retry, and route/service contract coverage.

## Production URLs

- API: `https://edrsr-ai-server.fun/api`
- Admin: `https://edrsr-ai-server.fun/admin`
- Portal: `https://app.edrsr-ai-server.fun`
- WebSocket: `wss://edrsr-ai-server.fun`

## Useful Documentation

- [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) - maintained API surface.
- [docs/BACKEND_ARCHITECTURE.md](./docs/BACKEND_ARCHITECTURE.md) - backend structure and service boundaries.
- [docs/ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md) - env reference and production defaults.
- [docs/STORE_LISTING.md](./docs/STORE_LISTING.md) - Chrome Web Store listing/checklist.
- [docs/PRIVACY_POLICY.md](./docs/PRIVACY_POLICY.md) - extension privacy policy text.

Folder-level `AGENTS.md` files are maintainer instructions for future code work.
