# Plan

Deliver the MVP web portal on the existing VPS under `app.edrsr-ai-server.fun`, using the
current backend and WebSocket flow, with minimal API changes and a Vite+React SPA served
via Nginx from `/var/www/edrsr-ai-app`. The approach is to add the web app skeleton,
wire auth + jobs flow, and expand deploy to build and sync the portal.

## Scope
- In: DNS + TLS for `app.*`, Nginx static+proxy, `web/` SPA, minimal API tweaks
  (optional clientId, `/api/me`, jobs pagination), deploy workflow update, smoke checks.
- Out: Matters/org/sharing/monitoring/evidence/analytics (next phases).

## Action items
[x] Add `app.edrsr-ai-server.fun` DNS A record -> VPS IP and wait for propagation.
[x] Add Nginx vhost for `app.*` with SPA fallback + `/api` + `/ws` proxy, then reload.
[x] Extend TLS cert to include `app.*` (certbot) and verify HTTPS + HSTS.
[x] Create `web/` (Vite+React+TS) with routing, auth guard, and API client (base `/api`).
[x] Add WS primary + polling fallback for job progress, align with existing collect flow.
[x] Implement MVP pages: Analyses list, Job page, Prompts, Create analysis (URLs/CSV).
[x] Backend tweaks: allow `clientId` optional in `/api/collect`, add `GET /api/me`,
    add jobs pagination/filtering for portal list.
[x] Update deploy workflow to build `web/` and rsync to `/var/www/edrsr-ai-app`.
[x] Run lint + smoke checks; update this plan with completed items.

## Open questions
- None for Phase 0; proceed with VPS + Nginx + `/var/www/edrsr-ai-app`.
