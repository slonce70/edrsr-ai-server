#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="$ROOT_DIR/server/sql/apply_rls.sql"

if ! command -v psql >/dev/null 2>&1; then
  echo "[ERROR] psql не найден. Установите PostgreSQL client (psql) и повторите."
  echo "  macOS: brew install libpq && brew link --force libpq"
  echo "  Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y postgresql-client"
  exit 1
fi

# Подгрузим DATABASE_URL из server/.env, если не задан в окружении
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "$ROOT_DIR/server/.env" ]]; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ROOT_DIR/server/.env" | sed -E 's/^DATABASE_URL=//; s/^"|"$//g')
    export DATABASE_URL
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] DATABASE_URL не задан. Экспортируйте переменную или задайте в server/.env"
  exit 1
fi

# Для Supabase чаще требуется SSL. Если sslmode не указан явно — потребуем.
if [[ "$DATABASE_URL" == *"supabase"* && "$DATABASE_URL" != *"sslmode="* ]]; then
  export PGSSLMODE=require
fi

echo "[INFO] Применяю RLS‑политики из $SQL_FILE"
PSQL_OPTS=("$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE")
psql "${PSQL_OPTS[@]}"
echo "[OK] Политики RLS применены."

