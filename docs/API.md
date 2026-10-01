# API Reference

Base URLs: production `https://edrsr-ai-server.fun/api`, development `http://localhost:4000/api`.

Authenticated endpoints need `Authorization: Bearer <Supabase access token>`; a missing or invalid token returns `401 {"error": "..."}`.
Routes are defined in `server/routes/`; if this document and the code disagree, the code wins and this file should be fixed.

## Conventions

- **Workspace scope.** Endpoints marked *(ws)* accept `workspaceId` as a query parameter, or the `x-workspace-id` header, or a path parameter.
  Without it, the caller's own workspace is used. A workspace the caller does not belong to returns `403`.
- **Roles.** Workspace roles are `owner`, `admin`, `member`. Write endpoints marked *(owner/admin)* return `403` for `member`.
- **Errors.** Most handlers return `{ "error": "message" }` (message text may be Russian or Ukrainian). Unhandled errors go through
  `server/middleware/errorHandler.js` and return `{ "success": false, "error": "...", "errorId": "ERR-..." }`.
  Sign-in errors also carry `error_code`. Common codes: `400` bad input, `401` no/invalid token, `403` no access or origin rejected,
  `404` not found, `422` limit exceeded, `429` rate limited.
- **Success.** Many (not all) responses carry `"success": true`. Do not rely on it for `GET /status/:id`, `GET /chat/:jobId` and health checks.
- **Limits** (env, see `server/env.example`): `MAX_LINKS_PER_REQUEST` 300, `MAX_URL_LENGTH` 2048, `MAX_PROMPT_LENGTH` 4000,
  `MAX_CHAT_MESSAGE_LENGTH` 4000, `MAX_COOKIE_LENGTH` 4096, `MAX_PROMPTS_IMPORT` 200. JSON body limit is 10 MB.
- **Public paths.** `/api` runs auth for everything except paths starting with `/health/light`, `/auth/signin`, `/share`, `/prompts/definitions`.
  (The `/share` prefix also matches `/share-links`, which is protected again inside `portal.js`.)

## Public endpoints

| Method and path | Notes |
| --- | --- |
| `GET /api/health/light` | Cached for `HEALTH_LIGHT_TTL_MS`. `200 {status:"ok"}` or `503 {status:"degraded"}`. |
| `GET /api/prompts/definitions` | Built-in prompt templates. Supports `ETag` / `If-None-Match`. Rate limited. |
| `GET /api/share/:token` | Public report for a share link. `404` unknown token, `410` revoked or expired. |
| `POST /api/auth/signin` | Server-side Supabase password sign-in (used by the admin UI). Body `{email, password}` -> `{access_token, user:{id,email}}`. Rate limited, failed attempts tracked. |
| `GET /auth/callback` | HTML page (not under `/api`) that completes Supabase email-confirmation and password-reset redirects for the extension. |
| `GET /` | JSON landing/health response. `GET /admin*` serves the admin UI. |

Health sample:

```json
{
  "status": "ok",
  "version": "2.0.8",
  "checks": {
    "server": { "status": "ok" },
    "db": { "status": "ok", "latencyMs": 7 },
    "upstream": { "status": "ok", "statusCode": 200, "latencyMs": 120 }
  },
  "cachedAt": "2026-01-01T12:00:00.000Z",
  "ttlMs": 15000
}
```

`version` comes from the root `package.json` (override with `APP_VERSION`). `upstream` is a request to `HEALTH_LIGHT_UPSTREAM_URL` (reyestr.court.gov.ua).

## User

- `GET /api/me` -> `{success, user:{id,email}}`.

## Jobs

- `POST /api/collect` *(ws)* - create and queue an analysis. Body:
  `{ links:[{url}], cookie?, prompt?, prompt_label?, auto_title_enabled?, workspaceId?, matterId?, clientId }`.
  `clientId` is the id the server sent over the WebSocket (`clientId` event); it ties live updates to the connection.
- `GET /api/jobs` *(ws)* - list jobs. Query: `limit` (number or `all`, capped by `JOBS_MAX_LIMIT`, default 100), `page`, `status`, `search`,
  `sort` (whitelisted values), `matterId`. Returns `{success, jobs, pagination:{page,limit,total}}`; with only `limit=all` it returns `{success, jobs}`.
- `GET /api/jobs/search?q=<text>` *(ws)* - full-text search over report bodies (minimum 2 characters).
- `GET /api/overview` *(ws)* - dashboard aggregate: status counts, this week/today, per-matter counts, recent jobs.
- `GET /api/status/:id` *(ws)* - lightweight status. `include=analysis` and `include=links` add larger payloads; `light=true` is used by the extension.
  Returns `quality` for completed jobs and `error_message` for failed ones.
- `GET /api/jobs/:jobId/analysis` - stored analysis text and metadata.
- `GET /api/jobs/:jobId/links-content` - extracted case content for the job's links.
- `GET /api/jobs/last` - latest relevant job of the caller.
- `POST /api/retry/:jobId` - create a retry job. Body `{clientId}` (required). Rate limited.
- `PATCH /api/jobs/:id/title` - body `{title}`.
- `DELETE /api/jobs/:id` - delete a job; terminates its active worker if any.
- `GET /api/processed-urls` - EDRSR URLs the caller has already analysed (extension highlighting).
- `POST /api/urls/processed-check` - body `{urls:[...]}`; returns which of them were processed.

Job statuses: `queued`, `processing`, `completed`, `failed` (plus `retrying`/`cancelled` variants set by the queue; see `server/services/jobWriteService.js`).

## Prompts

- `GET /api/prompts`, `POST /api/prompts`, `PATCH /api/prompts/:id`, `DELETE /api/prompts/:id`, `POST /api/prompts/import` - the caller's own prompts. List supports `ETag`.
- Workspace-shared prompts: `GET /api/prompts/shared` *(ws)*; `POST /api/prompts/shared`, `PATCH /api/prompts/shared/:id`, `DELETE /api/prompts/shared/:id`,
  `POST /api/prompts/shared/from-user` *(owner/admin for writes)*.

## Chat

- `GET /api/chat/:jobId` - raw chat history array.
- `POST /api/chat/:jobId` - body `{message}`; answers with Gemini and also pushes a `CHAT_UPDATE` over the WebSocket.

## Workspaces, matters, share links

- Workspaces: `GET /api/workspaces`, `POST /api/workspaces`, `GET /api/workspaces/:workspaceId/members`,
  `POST|PATCH|DELETE /api/workspaces/:workspaceId/members[/:memberId]` *(owner/admin)*.
- Matters (cases): `GET /api/matters` *(ws)*, `GET /api/matters/:matterId`; `POST /api/matters`, `PATCH|DELETE /api/matters/:matterId`,
  `POST /api/matters/:matterId/jobs`, `DELETE /api/matters/:matterId/jobs/:jobId` *(owner/admin)*.
- Share links: `GET /api/share-links` *(ws)*; `POST /api/share-links` *(owner/admin)* with `{jobId, expiresInDays?}`
  (default 14, max 30 days) -> `{success, share, token}`; `POST /api/share-links/:id/revoke` *(owner/admin)*.
  The portal URL is built from `PUBLIC_SHARE_BASE_URL` or `APP_BASE_URL`; the list endpoint never returns the full URL again.

## Operations (admin only, mounted under `/api`)

`GET /api/workers/active`, `POST /api/workers/:jobId/terminate`, `POST /api/workers/terminate-all`, `GET /api/system/stats`,
`GET /api/system/chat-sessions`, `POST /api/queue/clear`, `GET /api/health/full`, `POST /api/internal/process-queue`.

## Admin API (admin only, mounted at `/api/admin`)

Used by the static admin UI at `/admin`. Requires an authenticated user with the admin role (`SUPER_ADMIN_EMAILS` / `SUPER_ADMIN_USER_IDS` are always admins).

- Dashboard and system: `GET /dashboard`, `GET /system/stats`, `POST /system/cleanup`, `GET /audit-log`, `GET /security/stats`,
  `GET /gemini/stats`, `POST /gemini/reset-stats`.
- Users: `GET /users`, `POST /users/:userId/make-admin`, `DELETE /users/:userId/admin-role`, `DELETE /users/:userId`.
- Jobs: `GET /jobs`, `GET /jobs/errors`, `GET /jobs/:jobId/report`, `GET /jobs/:jobId/details`, `PUT /jobs/:jobId/title`, `DELETE /jobs/:jobId`,
  `POST /jobs/:jobId/requeue`, `POST /jobs/:jobId/retry`, `POST /jobs/retry-failed`, `POST /jobs/recover-stuck`.

Note: `GET /admin/...` (without `/api`) is the static admin HTML, not the API.

## WebSocket

Connect to the API origin: `wss://edrsr-ai-server.fun` (extension) or `wss://<portal host>/ws` (portal, proxied); dev `ws://localhost:4000`.
The server accepts any path. In production the handshake `Origin` must be allowed (see `docs/DEPLOYMENT.md`) and must be present.

Client -> server (max payload 16 KB, `WS_MAX_PAYLOAD_BYTES`):

```json
{ "type": "auth", "token": "<supabase access token>" }
{ "type": "subscribe", "jobId": "...", "workspaceId": "optional" }
{ "type": "heartbeat" }
```

- Send `auth` first. `subscribe` before successful auth is ignored. Unauthenticated sockets are closed with code `4001` after `WS_AUTH_TIMEOUT_MS` (10 s).
- Server pings every 30 s; send a heartbeat at least that often.

Server -> client:

- `{type:"clientId", clientId}` right after connect; pass it as `clientId` to `POST /collect` and `POST /retry`.
- `{type:"JOB_UPDATE", payload:{...}}` job progress and status. Chat updates arrive as `JOB_UPDATE` whose payload has `type:"CHAT_UPDATE"`.
