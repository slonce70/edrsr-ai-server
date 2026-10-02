#!/usr/bin/env bash
# Installed on the VPS as /usr/local/sbin/edrsr-deploy and used as the forced command of the CI deploy key
# (docs/DEPLOYMENT.md, "Deploy from GitHub"). The workflow passes the commit SHA as the SSH command and pipes
# the built portal (tar.gz of web/dist) to stdin. Touches only EDRSR files and the edrsr-ai unit, never Caddy/Obriy.
set -euo pipefail

APP=/opt/edrsr-ai
WEB=/var/www/edrsr-ai-app
NODE_BIN=/opt/node22/bin
HEALTH=http://127.0.0.1:4010/api/health/light

sha="${SSH_ORIGINAL_COMMAND:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "expected a 40-char commit sha, got '${sha}'" >&2; exit 2; }

exec 9>/run/edrsr-deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

tmp=$(mktemp -d /var/www/.edrsr-web.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
tar -xz --no-same-owner --no-same-permissions -C "$tmp"
[[ -f "$tmp/index.html" ]] || { echo "portal archive has no index.html" >&2; exit 2; }
chown -R root:root "$tmp"
chmod -R u=rwX,go=rX "$tmp"

as_edrsr() { runuser -u edrsr -- "$@"; }

# Healthy = the backend itself and its database answer. /api/health/light also reports the court registry
# (upstream) and returns 503 when that is unreachable: an outage there must not fail or roll back a deploy.
wait_healthy() {
  local body
  for _ in $(seq 1 90); do
    body=$(curl -s --max-time 3 "$HEALTH" 2>/dev/null || true)
    [[ "$body" == *'"server":{"status":"ok"}'* && "$body" == *'"db":{"status":"ok"'* ]] && return 0
    sleep 1
  done
  return 1
}

# npm ci only when a dependency manifest changed: it is the one heavy step on this shared 2 GB host.
install_deps() {
  systemd-run --slice=edrsr.slice --uid=edrsr --gid=edrsr --wait --pipe --quiet \
    -p MemoryMax=600M -p WorkingDirectory="$APP/server" \
    -E HOME="$APP" -E PATH="$NODE_BIN:/usr/bin:/bin" "$NODE_BIN/npm" ci --omit=dev
}

prev=$(as_edrsr git -C "$APP" rev-parse HEAD)
as_edrsr git -C "$APP" fetch --quiet origin main
as_edrsr git -C "$APP" reset --quiet --hard "$sha"

deps_changed=0
if ! as_edrsr git -C "$APP" diff --quiet "$prev" "$sha" -- package.json package-lock.json server/package.json server/package-lock.json; then
  deps_changed=1
fi

rollback() {
  echo "deploy of $sha failed, rolling back to $prev" >&2
  as_edrsr git -C "$APP" reset --quiet --hard "$prev"
  [[ "$deps_changed" == 1 ]] && install_deps
  systemctl restart edrsr-ai
  wait_healthy || echo "rollback is not healthy either, check: journalctl -u edrsr-ai" >&2
  exit 1
}

if [[ "$deps_changed" == 1 ]]; then
  echo "dependencies changed: npm ci"
  install_deps || rollback
fi

systemctl restart edrsr-ai
wait_healthy || rollback

# the backend is healthy: switch the portal
rm -rf "$WEB.old"
[[ -d "$WEB" ]] && mv "$WEB" "$WEB.old"
mv "$tmp" "$WEB"
rm -rf "$WEB.old"

echo "deployed $sha ($(curl -s --max-time 3 "$HEALTH" | head -c 120))"
