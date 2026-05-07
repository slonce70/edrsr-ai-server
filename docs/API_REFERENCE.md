# API Reference

Base URLs:

- Production API: `https://edrsr-ai-server.fun/api`
- Development API: `http://localhost:4000/api`

Most `/api` endpoints require a Supabase bearer token. Public exceptions are listed below.

## Public Endpoints

### `GET /api/health/light`

Lightweight public health check.

Response:

```json
{
  "status": "ok",
  "version": "2.0.5",
  "checks": {
    "server": { "status": "ok" },
    "db": { "status": "ok", "latencyMs": 7 },
    "upstream": { "status": "ok" }
  }
}
```

### `GET /api/prompts/definitions`

Public prompt-template definitions. Supports `ETag` and `If-None-Match`.

### `GET /api/share/:token`

Public share-link payload.

- `404` - token not found
- `410` - token revoked or expired

### `POST /api/auth/signin`

Server-side Supabase password signin.

Body:

```json
{ "email": "user@example.com", "password": "password" }
```

Response:

```json
{
  "access_token": "...",
  "user": { "id": "...", "email": "user@example.com" }
}
```

## Authenticated User Endpoints

### `GET /api/me`

Returns the current authenticated user.

### `POST /api/collect`

Creates a queued analysis job.

Body:

```json
{
  "links": [{ "url": "https://reyestr.court.gov.ua/Review/123456789" }],
  "cookie": "",
  "prompt": "optional custom prompt",
  "prompt_label": "optional label",
  "auto_title_enabled": true,
  "workspaceId": "optional workspace id",
  "matterId": "optional matter id",
  "clientId": "optional websocket client id"
}
```

### `GET /api/jobs`

Lists jobs visible to the current user or workspace.

Query params:

- `limit` - number or `all`
- `page` - page number
- `status` - optional status filter
- `search` - optional text search
- `workspaceId` - optional workspace scope

### `GET /api/status/:id`

Returns lightweight job status.

Query params:

- `include=analysis`
- `include=links`
- `workspaceId=<id>`

### `GET /api/jobs/:jobId/analysis`

Returns stored analysis for a job.

### `GET /api/jobs/:jobId/links-content`

Returns extracted link content for a job.

### `GET /api/jobs/last`

Returns the latest relevant job for the current user.

### `POST /api/retry/:jobId`

Creates a retry job from an existing job. Requires a valid `clientId`.

### `PATCH /api/jobs/:id/title`

Updates a job title.

Body:

```json
{ "title": "New title" }
```

### `DELETE /api/jobs/:id`

Deletes a job and terminates an active worker for it when present.

### `GET /api/processed-urls`

Returns processed EDRSR URLs for the current user. Kept for extension compatibility.

### `POST /api/urls/processed-check`

Checks processed membership for a list of URLs.

Body:

```json
{ "urls": ["https://reyestr.court.gov.ua/Review/123456789"] }
```

## Prompts

User prompts:

- `GET /api/prompts`
- `POST /api/prompts`
- `PATCH /api/prompts/:id`
- `DELETE /api/prompts/:id`
- `POST /api/prompts/import`

Prompt list responses use `ETag` and support `If-None-Match`.

Workspace prompts:

- `GET /api/prompts/shared`
- `POST /api/prompts/shared`
- `PATCH /api/prompts/shared/:id`
- `DELETE /api/prompts/shared/:id`
- `POST /api/prompts/shared/from-user`

## Chat

- `GET /api/chat/:jobId`
- `POST /api/chat/:jobId`

`POST` body:

```json
{ "message": "Question about this analysis" }
```

## Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId/members`
- `POST /api/workspaces/:workspaceId/members`
- `PATCH /api/workspaces/:workspaceId/members/:memberId`
- `DELETE /api/workspaces/:workspaceId/members/:memberId`

Workspace roles are `owner`, `admin`, and `member`.

## Matters

- `GET /api/matters`
- `POST /api/matters`
- `GET /api/matters/:matterId`
- `PATCH /api/matters/:matterId`
- `DELETE /api/matters/:matterId`
- `POST /api/matters/:matterId/jobs`
- `DELETE /api/matters/:matterId/jobs/:jobId`

## Share Links

- `GET /api/share-links`
- `POST /api/share-links`
- `POST /api/share-links/:id/revoke`

## Operations

Admin-only operational endpoints mounted under `/api`:

- `GET /api/workers/active`
- `POST /api/workers/:jobId/terminate`
- `POST /api/workers/terminate-all`
- `GET /api/system/stats`
- `GET /api/system/chat-sessions`
- `POST /api/queue/clear`
- `GET /api/health/full`
- `POST /api/internal/process-queue`

## Admin API

Admin UI endpoints are mounted at `/admin/api` and require an authenticated admin:

- `GET /admin/api/dashboard`
- `GET /admin/api/users`
- `POST /admin/api/users/:userId/make-admin`
- `DELETE /admin/api/users/:userId/admin-role`
- `DELETE /admin/api/users/:userId`
- `GET /admin/api/jobs`
- `GET /admin/api/jobs/:jobId/report`
- `GET /admin/api/jobs/:jobId/details`
- `PUT /admin/api/jobs/:jobId/title`
- `DELETE /admin/api/jobs/:jobId`
- `POST /admin/api/jobs/:jobId/requeue`
- `POST /admin/api/jobs/:jobId/retry`
- `POST /admin/api/jobs/retry-failed`
- `POST /admin/api/jobs/recover-stuck`
- `POST /admin/api/system/cleanup`
- `GET /admin/api/system/stats`
- `GET /admin/api/audit-log`
- `GET /admin/api/security/stats`
- `GET /admin/api/gemini/stats`
- `POST /admin/api/gemini/reset-stats`

## WebSocket

Connect to:

- Production: `wss://edrsr-ai-server.fun`
- Development: `ws://localhost:4000`

The client sends an auth message after opening:

```json
{ "type": "auth", "token": "<supabase access token>" }
```

Common client messages:

```json
{ "type": "subscribe", "jobId": "...", "workspaceId": "optional" }
{ "type": "heartbeat" }
```

Common server events:

- `clientId`
- `JOB_UPDATE`
- `CHAT_UPDATE`
- `error`

Production must allow the Chrome extension origin through `CHROME_EXTENSION_IDS` and HTTP/WS origin config.

## Error Shape

Common error payload:

```json
{ "success": false, "error": "message", "errorId": "ERR-..." }
```

Validation/auth errors may omit `success` for compatibility with older extension flows.
