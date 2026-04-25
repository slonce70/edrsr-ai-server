# Backend Architecture

## Overview

The backend is the shared runtime for all clients:

- Chrome extension
- React web portal
- static admin UI
- background worker and WebSocket delivery

The system is stateful. Postgres is the source of truth for jobs, links, results, chat, prompts, workspaces, matters, share links, and recovery state.

## Runtime Layers

### Routes layer

HTTP entrypoints live in `server/routes/`.

- `index.js` handles auth, collection, retry, job listing, title updates, deletion, worker lifecycle, and queue orchestration.
- `job-queries.js` handles status, analysis, links-content, processed URL checks, and last-job queries.
- `prompts.js` handles user prompts and public prompt definitions with ETag support.
- `chat.js` handles per-job chat history and answers.
- `portal.js` handles workspaces, members, matters, shared prompts, share links, and the public `/share/:token` view.
- `admin.js` handles operational dashboards, queue recovery, cleanup, user admin, and audit views.

### Service layer

Bounded-context services live in `server/services/`.

- `promptService.js`
  - source of truth for user prompts
  - source of truth for workspace prompts
  - source of truth for prompt definitions metadata and audit cleanup
- `collaborationService.js`
  - source of truth for workspaces
  - source of truth for workspace membership and roles
  - source of truth for matters and share links
- `jobQueryService.js`
  - source of truth for read/query access to jobs, links, results, processed URL checks, and last-job lookups
- `jobWriteService.js`
  - source of truth for job updates, title mutations, delete flows, and lifecycle writes
- `queueService.js`
  - source of truth for queue claim, requeue, retry, stuck-job recovery, worker locks, and heartbeat recovery
- `chatService.js`
  - source of truth for chat persistence
- `cacheService.js`
  - source of truth for parsed-case cache and cache cleanup

### Transitional facade

`server/services/dbService.js` is still present as a compatibility facade.

Current role:

- forwards legacy method calls to the newer bounded-context services
- keeps compatibility for callers that still rely on `createJob` and a few aggregated reads
- should not be treated as the long-term source of truth for new code

### Queue and worker layer

- `server/worker.js` performs download, extraction, AI analysis, and result persistence.
- `queueService` coordinates leases, retry, stuck-job recovery, and server-restart recovery.
- `server/websocket.js` broadcasts job and chat updates to connected clients.

## Canonical Client Contracts

### Workspace-aware endpoints

Portal endpoints keep stable REST paths and accept `workspaceId` as a query parameter.

Canonical behavior:

- if `workspaceId` is provided and access is missing, the route returns `403`
- if `workspaceId` is omitted, the backend resolves the user's default/active workspace where applicable
- public routes such as `/api/share/:token` do not require auth and do not use `workspaceId`

### Prompt caching

- `GET /api/prompts` supports `ETag` and `If-None-Match`
- `GET /api/prompts/definitions` is public, cacheable, and also supports `ETag`
- user and extension clients are expected to preserve and replay these validators

### Job status payloads

`GET /api/status/:id` returns a lightweight job object by default.

Optional expansions:

- `include=analysis` adds `analysis`
- `include=links` adds lightweight `links`

The route shape is intentionally additive so clients can request larger payloads only when needed.

### Share links

- `GET /api/share/:token` is public
- `404` means token not found
- `410` means link revoked or expired
- successful payloads return `share`, `job`, `analysis`, and lightweight `links`

## Client Consumers

- Extension uses the collection/job/status/prompt flows and maintains its own ETag-based prompt cache.
- Web portal uses `web/src/lib/api.ts` as the single wrapper and appends `workspaceId` in query params to keep route paths stable.
- Admin UI talks to `server/routes/admin.js` and is intentionally separate from the end-user portal contracts.

## Verification

Current regression protection for the refactor:

- `server/scripts/test-service-contracts.js`
- `server/scripts/test-route-service-wiring.js`
- `server/scripts/test-portal-contracts.js`
- `server/scripts/run-db-integration.js`
- project-wide quality, smoke, web build, and extension build checks
