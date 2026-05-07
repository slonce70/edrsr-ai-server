# Backend Architecture

The backend is the shared runtime for the Chrome extension, React portal, admin UI, background workers, and WebSocket delivery.

Postgres is the source of truth for jobs, links, results, chat, prompts, workspaces, matters, share links, parsed-case cache, and recovery state. Supabase is used for authentication.

## HTTP Mounts

`server/server.js` mounts:

- `/api` - user, extension, portal, operation, prompt, chat, and job APIs.
- `/auth` - Supabase callback/reset-password page.
- `/admin/api` - admin JSON API.
- `/admin` - static admin dashboard.
- `/` - static health/landing response.

## Route Modules

Core API route composition starts in `server/routes/index.js`.

- `job-collection.js` - `POST /api/collect`.
- `job-queries.js` - job list, status, analysis, links-content, processed URL checks, and last-job queries.
- `job-mutations.js` - retry, title update, and delete flows.
- `prompts.js` - public prompt definitions plus user prompt CRUD/import.
- `chat.js` - per-job chat history and answers.
- `portal.js` - workspaces, members, matters, shared prompts, share links, and public share payloads.
- `operations.js` - admin-only worker, health, queue, and system operations mounted under `/api`.
- `admin.js` - admin dashboard API mounted under `/admin/api`.
- `auth.js` - public Supabase callback UI mounted under `/auth`.

## Service Boundaries

Business logic and DB access live under `server/services/`.

- `promptService.js` - user prompts, workspace prompts, prompt definitions, and prompt audit cleanup.
- `collaborationService.js` - workspaces, members, matters, and share links.
- `jobQueryService.js` - job reads, links, results, processed URL checks, and workspace-aware reads.
- `jobWriteService.js` - job status/title/delete writes and lifecycle mutations.
- `queueService.js` - queue claiming, leases, retries, recovery, worker locks, and heartbeats.
- `chatService.js` - chat persistence.
- `cacheService.js` - parsed-case cache and cleanup.
- `workerLifecycleService.js` - active-worker inspection and termination policy.
- `wsMessageValidator.js` and `wsSubscriptionService.js` - WebSocket message hardening and subscription authorization.

`server/services/dbService.js` remains as a compatibility facade for older callers. New code should prefer the bounded-context services above.

## Queue and Worker Flow

1. A client calls `POST /api/collect`.
2. `job-collection.js` validates EDRSR links, creates the job, queues it, and triggers `processQueue`.
3. `queueService` claims a queued job and records a worker lock.
4. `server/worker.js` downloads/parses cases, calls Gemini through `batchProcessor.js`, and persists results.
5. `jobWriteService` updates status and lifecycle fields.
6. `server/websocket.js` broadcasts lightweight job updates to authorized subscribers.

Worker cleanup is controlled by env:

- `ENABLE_WORKER_CLEANUP`
- `ENABLE_WORKER_AUTO_TERMINATE`
- `WORKER_MAX_LIFETIME_MS`
- `WORKER_HEALTH_CHECK_INTERVAL_MS`
- `WORKER_HEALTH_CHECK_TIMEOUT_MS`

## Client Contracts

- Authenticated clients send `Authorization: Bearer <Supabase access token>`.
- Workspace-aware requests pass `workspaceId` as a query parameter or request body where supported.
- If `workspaceId` is provided and access is missing, routes return `403`.
- `GET /api/status/:id` is lightweight by default; `include=analysis` and `include=links` opt into larger payloads.
- Prompt list and prompt definitions support `ETag` and `If-None-Match`.
- Share-token payloads are public and return `404` for unknown tokens and `410` for revoked/expired tokens.

## Security Shape

- `server/originPolicy.js`, `server/server.js`, and `server/websocket.js` enforce production HTTP and WebSocket origin policy.
- Production Chrome extension traffic must be explicitly allowed through `CHROME_EXTENSION_IDS` and CORS/WS origin settings.
- `/api/health/light`, `/api/prompts/definitions`, `/api/auth/signin`, and `/api/share/:token` are public.
- Admin routes require Supabase auth plus admin role checks.
- Validators in `server/middleware/validators.js` own request-size and shape constraints.

## Verification

Primary local gate:

```bash
npm run quality:local
git diff --check
```

Focused regression scripts:

- `server/scripts/test-service-contracts.js`
- `server/scripts/test-route-service-wiring.js`
- `server/scripts/test-portal-contracts.js`
- `server/scripts/test-websocket-message-hardening.js`
- `server/scripts/test-websocket-subscription-auth.js`
- `server/scripts/test-gemini-retry-regression.js`
- `server/scripts/test-security-regressions.js`
