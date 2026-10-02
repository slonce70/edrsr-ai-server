# Architecture

EDRSR-AI is one Node.js backend shared by three clients: the Chrome extension, the React portal and the static admin UI.
The backend scrapes public court decisions from `reyestr.court.gov.ua`, analyses them with Gemini in background jobs and pushes progress over WebSocket.

```
Chrome extension ─┐                         ┌─> Supabase Auth (token check: auth.getUser)
React portal ─────┼─> Caddy ─> Node :PORT ──┼─> PostgreSQL (jobs, results, prompts, workspaces...)
Admin UI (/admin) ┘            │            ├─> reyestr.court.gov.ua (scraper)
                               └ worker thread ─> Gemini API (optionally via CLI proxy)
```

- **Postgres** is the source of truth (plain `pg` over `DATABASE_URL`; no Supabase-specific SQL at runtime).
  The schema is created and migrated at startup by `server/database/connection.js`.
- **Supabase** is used only for authentication. Every authenticated request verifies the bearer token with `auth.getUser` against the server's `SUPABASE_URL`, through `auth/verifyToken.js`: a successful check is reused for 2 minutes, and when Supabase is unreachable (network failure, never a rejection) a token validated in the last 30 minutes is still accepted until its own `exp`. Without this a short outage closed every WebSocket with `auth_required` and the extension kept showing "reconnecting".
  The server, the portal build and the extension must use the same Supabase project.

## HTTP mounts (`server/server.js`)

| Mount | Module | Notes |
| --- | --- | --- |
| `/api` | `routes/index.js`, then `routes/portal.js` | Two routers share the prefix; order matters. |
| `/api/admin` | `routes/admin.js` | Admin JSON API (router-wide `requireAdmin`). |
| `/auth` | `routes/auth.js` | Supabase redirect landing page (`/auth/callback`). |
| `/admin` | static `server/public/admin` | Admin UI (plain scripts, no bundler). |
| `/` | inline | JSON landing response; cheap liveness probe. |

`routes/index.js` also owns sign-in, `/me`, worker spawning, the chat-session LRU, the queue pump, worker cleanup/health checks and periodic job recovery.
Route files: `job-collection.js` (`POST /collect`), `job-queries.js`, `job-mutations.js`, `prompts.js`, `chat.js`, `portal.js` (workspaces, matters, shared prompts, share links), `operations.js` (admin ops and health).
Full endpoint list: [API.md](./API.md).

## Layers

- **Middleware** (`server/middleware/`): `auth.js` (`attachUser`, `requireAuthExcept`), `adminAuth.js`, `workspace.js`, `validators.js`, `rateLimit.js`, `security.js`, `errorHandler.js`.
- **Services** (`server/services/`): bounded contexts - `jobQueryService`, `jobWriteService`, `queueService`, `promptService`, `collaborationService`, `chatService`, `cacheService`,
  `workerLifecycleService`, `jobTitleService`, `evidenceService`, `maintenance`, `wsMessageValidator`, `wsSubscriptionService`.
  `dbService.js` is a legacy facade for old callers; new code uses the services.
- **Pipeline**: `scraper.js` (download and parse cases), `queue.js` (in-memory cookie cache, reservation), `worker.js` (worker thread), `batchProcessor.js` / `parallelBatchProcessor.js`
  (batching, retries), `gemini.js` + `config.js` (key rotation, cooldowns, optional CLI proxy via `cliProxyClient.js`), `prompts.js` / `prompt-definitions.js`, `qualityControl.js`, `quality/coverage.js`.
- **Auth helpers**: `auth/devAuth.js` (local-only token bypass, disabled when `NODE_ENV` is `production` or `staging`), `originPolicy.js` (only used by `scripts/selfcheck.js`; the live origin logic is in `server.js` and `websocket.js`).

## Job flow

1. A client calls `POST /api/collect` with links and its WebSocket `clientId`.
2. `job-collection.js` validates the EDRSR URLs, creates the job and links, queues it and triggers `processQueue`.
3. `queueService` claims a queued job (`FOR UPDATE SKIP LOCKED`, advisory lock, 30-minute lease with heartbeats) and `routes/index.js` spawns `worker.js` in a `worker_threads` Worker. One job runs at a time.
4. The worker downloads and parses the cases (cached in `parsed_cases`), calls Gemini in batches and persists results.
5. `jobWriteService` updates status; `websocket.js` sends `JOB_UPDATE` to subscribed, authorised clients.
6. On startup `recoverJobsAfterServerRestart` re-queues unfinished jobs, so a restart is safe but the in-flight job starts over (its cookie, kept only in memory, is lost).
   Do not run two backends against one database: each would re-queue the other's running jobs on boot.
7. Worker lifecycle: every terminal event (`jobSuccess`, `jobError`, `jobCancelled`, worker `error`/`exit`, force terminate) goes through `finishWorker` in `workerLifecycleService`.
   The first one deregisters the worker, writes the final status, terminates the thread and releases the single processing slot once; later events from the same worker (including the `exit(1)` caused by our own `terminate()`) are ignored, as are messages from a deregistered worker.
   A job may be claimed 5 times (`MAX_CLAIM_ATTEMPTS`, so a few deploy restarts are harmless); after that it is failed instead of looping. Temporary errors are auto-retried while `attempt < 3`. Admin retry/requeue resets the counter.

Worker maintenance is driven by `ENABLE_WORKER_CLEANUP`, `ENABLE_WORKER_AUTO_TERMINATE`, `WORKER_CLEANUP_INTERVAL_MS`, `WORKER_MAX_LIFETIME_MS`, `WORKER_HEALTHCHECK_INTERVAL_MS`,
`WORKER_HEALTHCHECK_AFTER_MS`, `ENABLE_PERIODIC_RECOVERY`, `RECOVERY_INTERVAL_MS`, `QUEUE_PUMP_INTERVAL_MS` (defaults in `server/env.example`).

## Client contracts

- Authenticated clients send `Authorization: Bearer <Supabase access token>`; workspace-aware requests add `workspaceId` (query, body or `x-workspace-id` header).
  A workspace the user does not belong to returns `403`.
- `GET /api/status/:id` is lightweight by default; `include=analysis` / `include=links` opt into larger payloads.
- Prompt list and definitions support `ETag` / `If-None-Match`.
- Public share payloads return `404` for unknown tokens and `410` for revoked or expired ones.

## Security shape

- **Origins.** CORS (`server.js`) and WebSocket handshake (`websocket.js`) both enforce an allow-list in production/staging:
  `CORS_ALLOWED_ORIGINS`, `WS_ALLOWED_ORIGINS`, and `CHROME_EXTENSION_IDS` for `chrome-extension://<id>` origins.
  If the lists are unset they fall back to the hardcoded `edrsr-ai-server.fun` / `www.` / `app.` origins. The extension's origin is **never** implicit: without its ID, every extension request gets `403`
  and the extension signs the user out.
- **Auth.** Public: `/api/health/light`, `/api/prompts/definitions`, `/api/auth/signin`, `/api/share/:token`. Everything else needs a valid token. Admin routes also check the `user_roles` table.
- **Dev auth.** `DEV_AUTH_ENABLED` lets a client forge `dev:` tokens. It is ignored when `NODE_ENV` is `production` or `staging`; never run a dev env file on a public host.
- **Rate limits** are per IP. Behind a reverse proxy set `TRUST_PROXY_HOPS=1`, otherwise all clients share the proxy's address.
- **Validation** limits live in `server/middleware/validators.js` and `MAX_*` env vars.

## Verification

```bash
npm run quality:local     # lint, format check, web build, extension build, audits, offline regression scripts
npm --prefix web test     # portal unit tests (not part of the gate)
```

Focused regression scripts are in `server/scripts/test-*.js`; the list run by the gate is in `scripts/run-local-quality.js`.
