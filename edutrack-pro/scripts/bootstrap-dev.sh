#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# EduTrack Pro - one-shot local development bootstrap.
#
#   ./scripts/bootstrap-dev.sh
#
# Creates the databases and role, writes .env from .env.example (generating real
# secrets), installs dependencies, applies migrations, seeds demo data and builds
# everything. Safe to re-run: every step checks before it acts.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_NAME="${DB_NAME:-edutrack_pro}"
DB_USER="${DB_USER:-edutrack}"
DB_PASSWORD="${DB_PASSWORD:-edutrack_dev_password}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }

say "Checking prerequisites"
command -v node >/dev/null || { echo "Node.js 20+ is required."; exit 1; }
command -v npm  >/dev/null || { echo "npm is required."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || warn "Node $NODE_MAJOR detected; 20 or newer is recommended."
command -v psql >/dev/null || warn "psql not found — create the databases manually if the next step fails."

say "Ensuring PostgreSQL role and databases"
if command -v psql >/dev/null; then
  psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1 \
    || psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD' CREATEDB;" \
    || warn "Could not create the role automatically — create it by hand if migrations fail."
  for db in "$DB_NAME" "${DB_NAME}_shadow" "${DB_NAME}_test"; do
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" 2>/dev/null | grep -q 1 \
      || psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE $db OWNER $DB_USER;" \
      || warn "Could not create database $db automatically."
  done
else
  warn "Skipping database creation."
fi

say "Writing .env (existing file is left untouched)"
if [ -f .env ]; then
  warn ".env already exists — keeping it. Compare with .env.example if something is missing."
else
  cp .env.example .env
  gen() { node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"; }
  ACCESS="$(gen)"; REFRESH="$(gen)"
  # Portable in-place edit (macOS + GNU sed).
  sed_i() { if sed --version >/dev/null 2>&1; then sed -i "$1" .env; else sed -i '' "$1" .env; fi; }
  sed_i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$ACCESS|"
  sed_i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$REFRESH|"
  sed_i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?schema=public|"
  sed_i "s|^SHADOW_DATABASE_URL=.*|SHADOW_DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/${DB_NAME}_shadow?schema=public|"
  sed_i "s|^TEST_DATABASE_URL=.*|TEST_DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/${DB_NAME}_test?schema=public|"
  echo "Generated JWT secrets and database URLs in .env"
fi

say "Installing dependencies (workspaces + Prisma client)"
npm install --no-audit --no-fund

say "Building shared packages"
npm run build:packages

say "Applying database migrations"
npx prisma migrate deploy

say "Seeding demo data"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin-EduTrack-2026!demo}" \
SEED_TEACHER_PASSWORD="${SEED_TEACHER_PASSWORD:-Teacher-EduTrack-2026!demo}" \
SEED_PARENT_PASSWORD="${SEED_PARENT_PASSWORD:-Parent-EduTrack-2026!demo}" \
npm run db:seed || warn "Seeding failed — re-run 'npm run db:seed' to see the error in full."

say "Building the API"
npm run -w @edutrack/api build

cat <<'SUMMARY'

------------------------------------------------------------------
Bootstrap complete.

Start the stack:
  npm run dev                 # API on :4000 and web on :3000 (hot reload)

Or separately:
  npm run dev:api             # http://localhost:4000   Swagger: /api/docs
  npm run dev:web             # http://localhost:3000

Demo sign-ins (development only — change them before any real use):
  admin@nhjs.demo    Admin-EduTrack-2026!demo
  teacher@nhjs.demo  Teacher-EduTrack-2026!demo
  parent@nhjs.demo   Parent-EduTrack-2026!demo

Mobile app (optional):
  npm run mobile:install && npm run mobile:start

Checks:
  npm run test:all            # unit + integration + end-to-end (needs PostgreSQL)
  node tests/smoke/smoke.mjs  # black-box suite against a running API
------------------------------------------------------------------
SUMMARY
