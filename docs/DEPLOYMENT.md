# Deployment (single VPS shared with another project)

Production host: NKtelecom VPS `195.133.38.174` (Rotterdam, Ubuntu 24.04, 1 vCPU, 2 GB RAM + 1.7 GB swap, 20 GB disk), `ssh root@195.133.38.174` by key only.
It also runs another production project (Obriy: Java service on `127.0.0.1:8787`, collector, Caddy on 80/443, fail2ban, ufw 22/80/443).
EDRSR-AI is isolated from it and must never starve it. Deployed and verified on 2026-10-01.

| What | Where |
| --- | --- |
| Code | `/opt/edrsr-ai` (git clone of `slonce70/edrsr-ai-server`, owner `edrsr`) |
| Runtime | private Node 22 in `/opt/node22` (nothing system-wide) |
| Database | local PostgreSQL 16, database/role `edrsr_ai`, `127.0.0.1:5432` |
| Backend | systemd `edrsr-ai`, `127.0.0.1:4010` |
| Portal | static files in `/var/www/edrsr-ai-app` |
| Env | `/etc/edrsr-ai/server.env` (`root:edrsr`, 0640), DB URL part in `/etc/edrsr-ai/db.env` |
| Reverse proxy | host Caddy, config `/etc/caddy/conf.d/edrsr-ai.caddy` |
| Backups | `/etc/cron.daily/edrsr-ai-backup` -> `/var/backups/edrsr-ai/` (14 daily dumps) |

## Isolation (why Obriy is safe)

- `edrsr.slice` (`/etc/systemd/system/edrsr.slice`): `CPUWeight=20`, `IOWeight=20` (the default for other services is 100), `MemoryHigh=650M`, `MemoryMax=800M`.
  Both `edrsr-ai` and PostgreSQL (`postgresql@16-main.service.d/edrsr-slice.conf`) run inside it, with `OOMScoreAdjust` raised so EDRSR is killed first under memory pressure.
  Heavy one-off commands (npm install, tests) are run as `systemd-run --slice=edrsr.slice ...` for the same reason.
- Memory cap of the app itself: Node heap 480 MB (`--max-old-space-size`), unit `MemoryHigh=520M`, `MemoryMax=600M`, `Nice=10`.
- Idle footprint is about 90 MB RSS (Node + Postgres). The portal is built on a laptop, never on the server.
- Caddy is shared. EDRSR only adds `import /etc/caddy/conf.d/*.caddy` at the end of `/etc/caddy/Caddyfile` plus its own file. The other project's repo re-copies its own `server/deploy/Caddyfile`
  to the host on manual updates, so the same `import` line must exist in that file too, otherwise EDRSR's sites disappear at its next update.
- Reload Caddy only with `systemctl reload caddy`: the unit loads `/etc/caddy/obriy.env` (the other project's read key is substituted into its config), and a bare `caddy reload` would run without it.
  Validate first: `( set -a; . /etc/caddy/obriy.env; set +a; caddy validate --config /etc/caddy/Caddyfile )`. A backup of the original Caddyfile is `/etc/caddy/Caddyfile.bak-20261001`.
- Never touch `nebosvid.com` blocks, `/opt/obriy`, `obriy*` units or `/etc/needrestart/conf.d/obriy.conf` (keeps unattended upgrades from restarting that service).

## Fixed inputs

| What | Value | Why it is fixed |
| --- | --- | --- |
| API / WebSocket / auth callback | `edrsr-ai-server.fun` (+ `www.`) | Hardcoded in the published Chrome Web Store extension (`extension/config.js`, `host_permissions`). A new domain needs a new extension release. |
| Portal | `app.edrsr-ai-server.fun` | Share links, Supabase redirects, CORS/WS allow-list. |
| Extension ID | `dknfodmbknjengdbmdecidpapbiabgdb` | Must be in `CHROME_EXTENSION_IDS`. |
| Supabase (auth only) | project in `extension/config.js` | Server, portal build and extension must share one project, otherwise every token is rejected. No dashboard access is needed: the server only uses its URL and public anon key. |

DNS is managed at **nic.ua** (personal account -> Domains -> `edrsr-ai-server.fun` -> Name servers -> DNS records; name servers `ns10-12.uadns.com`). `A` records `@`, `www`, `app` -> `195.133.38.174` (TTL 3600, the panel's minimum).
`mail`, `ftp` and `MX` still point at the old, dead host (unused). Auto-renewal of the domain is **off**; it expires on 2027-01-02.

## Rebuilding the host from scratch

```bash
# packages (low priority), user, directories
nice -n 15 ionice -c3 apt-get install -y --no-install-recommends git postgresql
useradd --system --no-create-home --home-dir /opt/edrsr-ai --shell /usr/sbin/nologin edrsr
install -d -o edrsr -g edrsr /opt/edrsr-ai ; install -d -o root -g edrsr -m 750 /etc/edrsr-ai
# PostgreSQL: small footprint, inside edrsr.slice
printf 'shared_buffers = 64MB\nmax_connections = 20\nwork_mem = 4MB\nmaintenance_work_mem = 32MB\neffective_cache_size = 256MB\n' > /etc/postgresql/16/main/conf.d/edrsr.conf
# role + database (generate the password on the host and write it only to /etc/edrsr-ai/db.env as DATABASE_URL=postgresql://edrsr_ai:<pw>@127.0.0.1:5432/edrsr_ai)
sudo -u postgres psql -v pw="$PW" <<'SQL'
CREATE ROLE edrsr_ai LOGIN PASSWORD :'pw';
CREATE DATABASE edrsr_ai OWNER edrsr_ai;
SQL
# Node 22: official tarball, checksum verified, unpacked to /opt/node22
# code
runuser -u edrsr -- git clone https://github.com/slonce70/edrsr-ai-server.git /opt/edrsr-ai
systemd-run --slice=edrsr.slice --uid=edrsr --gid=edrsr --wait --pipe -p MemoryMax=600M -p WorkingDirectory=/opt/edrsr-ai/server \
  -E HOME=/opt/edrsr-ai -E PATH=/opt/node22/bin:/usr/bin:/bin /opt/node22/bin/npm ci --omit=dev
# CI deploy: script + restricted key (see "Deploy from GitHub")
install -m 755 /opt/edrsr-ai/deploy/edrsr-deploy.sh /usr/local/sbin/edrsr-deploy
```

The schema is created automatically on first start. Do not apply `server/sql/*rls*.sql` (they need Supabase's `auth` schema) and keep the data in local Postgres: tables without RLS would be readable through Supabase's public REST API.

## Environment

`/etc/edrsr-ai/server.env` (plain `KEY=VALUE`, no `export`; names and defaults: `server/env.example`). Production values that matter:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=4010
TRUST_PROXY_HOPS=1
DATABASE_URL=postgresql://edrsr_ai:<password>@127.0.0.1:5432/edrsr_ai
PGSSL=false
PGSSLMODE=disable
PG_POOL_MAX=5
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
GEMINI_API_KEYS=<key1>,<key2>,...
MODEL_NAME=gemini-3.8-flash
FALLBACK_MODEL_NAME=gemini-3.6-flash
TEMPERATURE=1.0
MAX_CONCURRENT_BATCHES=2
ENABLE_CLI_PROXY=false
CHROME_EXTENSION_IDS=dknfodmbknjengdbmdecidpapbiabgdb
CORS_ALLOWED_ORIGINS=https://edrsr-ai-server.fun,https://www.edrsr-ai-server.fun,https://app.edrsr-ai-server.fun
WS_ALLOWED_ORIGINS=https://edrsr-ai-server.fun,https://www.edrsr-ai-server.fun,https://app.edrsr-ai-server.fun,https://reyestr.court.gov.ua
APP_BASE_URL=https://app.edrsr-ai-server.fun
```

Rules that cause outages when missed:
- `NODE_ENV=production` disables the dev-token bypass and enables the origin allow-list. Never copy a dev `.env` here.
- Without `CHROME_EXTENSION_IDS` every extension request gets 403 and the extension signs users out.
- `TRUST_PROXY_HOPS=1` behind Caddy, otherwise all users share one rate-limit bucket.
- The server exits at startup without `DATABASE_URL` or a valid `GEMINI_API_KEY(S)`. `SUPABASE_SERVICE_ROLE_KEY` is optional (admin user lookup/delete only) and is currently not set.
- Memory thresholds `MEMORY_*_MB` keep their defaults (200/400/420/500), sized for the 480 MB heap.

### Gemini models (checked 2026-10-01 against the keys in use, all free tier)

- Newest stable Flash: `gemini-3.8-flash` (also available: 3.7, 3.6, 3.5, 3-flash-preview, 2.5-flash; `gemini-2.5-pro` is not available to these keys; Google now limits 2.5 to existing users).
- With a realistic 25k-token prompt, 3.8, 3.7 and 3.5 frequently answered `503 high demand`, while `3.6-flash`, `3-flash-preview` and `2.5-flash` succeeded 3 of 3.
  Hence primary 3.8 and fallback 3.6 (full-size model, separate quota). On any 429/503 the server retries the same key with the fallback model, then rotates keys. 503 never cools or blacklists a key (3 in a row open a 90 s breaker that skips that model); three 429s in a row soft-ban a key; only 401/403 or an explicit "API key not valid" blacklist it, a plain 400 is a request error. A batch is split only when its output was truncated or blocked (or the request was too large); 429/503 retry the same batch once. Lite models are deliberately not used.
- Google recommends `temperature=1.0` for all Gemini 3 models (lower values can loop). Thinking is on by default and its tokens count against `MAX_TOKENS`.
- To change models edit the env file and `systemctl restart edrsr-ai`.

## systemd

`/etc/systemd/system/edrsr-ai.service`:

```ini
[Unit]
Description=EDRSR-AI server
After=network-online.target postgresql@16-main.service
Wants=network-online.target

[Service]
Slice=edrsr.slice
User=edrsr
Group=edrsr
WorkingDirectory=/opt/edrsr-ai/server
EnvironmentFile=/etc/edrsr-ai/server.env
Environment=UV_THREADPOOL_SIZE=4
ExecStart=/opt/node22/bin/node --expose-gc --max-old-space-size=480 index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
Nice=10
OOMScoreAdjust=500
MemoryHigh=520M
MemoryMax=600M
LimitNOFILE=65535
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

The app writes nothing to disk (logs go to journald: `journalctl -u edrsr-ai -f`). There is no graceful shutdown: a restart drops WebSocket connections and restarts the in-flight job from scratch,
so check for running jobs first (`GET /api/workers/active`, admin token).

## Caddy

`/etc/caddy/conf.d/edrsr-ai.caddy` (loaded by the `import` line described above; certificates are issued and renewed automatically by Caddy via Let's Encrypt, no certbot):

```
edrsr-ai-server.fun, www.edrsr-ai-server.fun {
	request_body {
		max_size 10MB
	}
	reverse_proxy 127.0.0.1:4010
}

app.edrsr-ai-server.fun {
	encode zstd gzip
	request_body {
		max_size 10MB
	}
	handle /api/* {
		reverse_proxy 127.0.0.1:4010
	}
	handle /ws {
		reverse_proxy 127.0.0.1:4010
	}
	handle /assets/* {
		root * /var/www/edrsr-ai-app
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}
	handle {
		root * /var/www/edrsr-ai-app
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
```

Caddy proxies WebSocket upgrades itself and sets `X-Forwarded-For/Proto`, which is what `TRUST_PROXY_HOPS=1` expects.

## Supabase

No change is needed while the domains stay the same: the redirect URLs of the existing project already point at them. If the project or a domain ever changes, set in Authentication -> URL configuration:
Site URL `https://app.edrsr-ai-server.fun`; Redirect URLs `https://app.edrsr-ai-server.fun`, `https://app.edrsr-ai-server.fun/**`, `https://app.edrsr-ai-server.fun/reset`, `https://edrsr-ai-server.fun/auth/callback`;
email sign-up enabled (the portal's sign-up and magic link use `signInWithOtp`).

## First admin

The `user_roles` row needs the user's Supabase UUID. The server records every signed-in user in `app_users`, so after the person has signed in once (portal or extension):

```bash
sudo -u postgres psql edrsr_ai -c "select user_id, email from app_users order by last_seen_at desc limit 10;"
sudo -u postgres psql edrsr_ai -c "insert into user_roles (user_id, role, granted_by) values ('<uuid>','admin','<uuid>') on conflict do nothing;"
```

## Smoke test

Use `--resolve` while DNS caches are stale (`curl --resolve edrsr-ai-server.fun:443:195.133.38.174 ...`).

```bash
D=edrsr-ai-server.fun; EXT=chrome-extension://dknfodmbknjengdbmdecidpapbiabgdb
curl -fsS https://$D/                                                            # JSON with version
curl -i  https://$D/api/health/light                                             # 200 needs DB and reyestr reachable, else 503
curl -i -H "Origin: $EXT" https://$D/api/prompts/definitions                     # 200 + access-control-allow-origin
curl -i -H 'Origin: https://evil.example' https://$D/api/prompts/definitions     # 403
curl -i https://$D/api/me                                                        # 401
curl -i -N --http1.1 -H "Origin: $EXT" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://$D/   # 101; bad or missing Origin -> 401
curl -I https://app.$D/analyses                                                  # 200 (SPA fallback); /assets/missing.js -> 404
```

Then in a browser: sign in to the portal, create an analysis, watch live progress; sign in from the extension and run one analysis.
`/api/health/light` pings reyestr, so use `/` as the liveness probe. A bare `curl` to `reyestr.court.gov.ua` gets an empty reply (no browser User-Agent); that is not a block, the scraper sends browser headers.

## Backups

`/etc/cron.daily/edrsr-ai-backup` writes `pg_dump -Fc edrsr_ai` to `/var/backups/edrsr-ai/` daily and keeps 14. They live on the same disk: copy them off the host from time to time
(`scp root@195.133.38.174:/var/backups/edrsr-ai/*.dump .`). Restore: `pg_restore -d edrsr_ai --clean --if-exists <file>` as the `postgres` user, with the service stopped.

## Updating

### Deploy from GitHub

Every push to `main` that touches `server/`, `web/`, the root `package*.json`, `deploy/` or the workflow runs `.github/workflows/deploy.yml` (or run it by hand: Actions, "Deploy", main only).
It runs the checks, builds the portal on the runner (never on the 2 GB host), and pipes `web/dist` plus the commit SHA to the host over SSH.
The deploy key can do exactly one thing: its `authorized_keys` entry is `restrict,command="/usr/local/sbin/edrsr-deploy" ssh-ed25519 ...`, so any SSH command is replaced by `deploy/edrsr-deploy.sh`.
The script, serialized with a lock, as root:

1. `git fetch` + `reset --hard <sha>` in `/opt/edrsr-ai` as `edrsr`;
2. `npm ci --omit=dev` inside `edrsr.slice`, only if a `package*.json` changed;
3. `systemctl restart edrsr-ai` and waits up to 90 s for `/api/health/light`; if unhealthy it resets to the previous commit, reinstalls if needed, restarts and exits non-zero (the portal is untouched);
4. swaps `/var/www/edrsr-ai-app` for the new portal. It never touches Caddy, Obriy or other units.

Repo secrets: `VPS_HOST` (195.133.38.174), `VPS_USER` (root), `VPS_SSH_KEY` (the restricted deploy key), `VPS_KNOWN_HOSTS` (the host's ed25519 line, pinned, no trust-on-first-use).
Rotate the key: `ssh-keygen -t ed25519 -N '' -f key`, replace the last line of `/root/.ssh/authorized_keys` (keep the `restrict,command=` prefix), `gh secret set VPS_SSH_KEY < key`.
After editing `deploy/edrsr-deploy.sh`, install it on the host by hand once (`scp` to `/usr/local/sbin/edrsr-deploy`, mode 755); the workflow does not replace its own entry point.
The deploy restarts the backend: jobs running at that moment are interrupted, so push when no big analysis is running.
The old read-only GitHub deploy key `edrsr@trendcrusher.nktele.com` (repo settings) belonged to the previous host and can be deleted.

### By hand (on the host, as root)

```bash
runuser -u edrsr -- git -C /opt/edrsr-ai pull --ff-only
systemd-run --slice=edrsr.slice --uid=edrsr --gid=edrsr --wait --pipe -p MemoryMax=600M -p WorkingDirectory=/opt/edrsr-ai/server \
  -E HOME=/opt/edrsr-ai -E PATH=/opt/node22/bin:/usr/bin:/bin /opt/node22/bin/npm ci --omit=dev
systemctl restart edrsr-ai
```

Portal (on a laptop, never on the host): build with the production `VITE_*` values (README) and `VITE_DEV_AUTH_ENABLED=false`, then
`rsync -az --delete web/dist/ root@195.133.38.174:/var/www/edrsr-ai-app/`.

## Chrome extension

The published extension needs no change as long as the three domains above work: it talks to `https://edrsr-ai-server.fun/api`, `wss://edrsr-ai-server.fun` and Supabase directly.
Rebuild and re-publish only for extension changes: see [README](../README.md#chrome-extension-release) and [STORE_LISTING](./STORE_LISTING.md).
