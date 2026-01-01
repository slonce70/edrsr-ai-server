# EDRSR-AI VPS Migration Notes

This file tracks the VPS migration state and remaining steps. No secrets are stored here.

## VPS baseline
- OS: Ubuntu 20.04
- Node.js: 20.x
- PostgreSQL: 12.x (local)
- Service: `edrsr-ai.service` (systemd)
- Reverse proxy: Nginx (`/etc/nginx/sites-available/edrsr-ai`)
- Domain: `https://edrsr-ai-server.fun`
- SSL: Let’s Encrypt (HTTP → HTTPS)
- Firewall: UFW (22/80/443)
- Fail2ban: sshd + nginx-botsearch

## App paths
- Repo: `/opt/edrsr-ai`
- Server env: `/opt/edrsr-ai/server/.env`
- Service unit: `/etc/systemd/system/edrsr-ai.service`
- Nginx site: `/etc/nginx/sites-available/edrsr-ai`
- Backups: `/opt/edrsr-ai/backups/`

## Database
- DB name: `edrsr_ai`
- App user: `edrsr`
- Local connection: `postgresql://edrsr:<password>@127.0.0.1:5432/edrsr_ai`

## Backups
- Daily backup via cron:
  - `/etc/cron.d/edrsr-ai-backup`
  - `pg_dump | gzip` stored in `/opt/edrsr-ai/backups/edrsr_ai_YYYY-MM-DD.sql.gz`
  - Retention: 14 days

## Nginx (HTTPS)
- Proxy to `http://127.0.0.1:4000`
- WebSocket headers enabled
- HTTP → HTTPS redirect enabled

## Status
- DNS: ✅ A records configured
- SSL: ✅ certbot installed and active
- Supabase Redirects: ✅ added for `https://edrsr-ai-server.fun/auth/callback`
- Smoke tests: ✅ API/WS/admin OK
