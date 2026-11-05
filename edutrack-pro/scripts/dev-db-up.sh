#!/usr/bin/env bash
# Starts a local PostgreSQL instance for development when Docker is unavailable.
# Usage: ./scripts/dev-db-up.sh
set -euo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/edutrack-pro-data}"
PGPORT="${PGPORT:-5432}"
DB_USER="${DB_USER:-edutrack}"
DB_PASSWORD="${DB_PASSWORD:-edutrack_dev_password}"

if ! command -v pg_ctlcluster >/dev/null 2>&1 && ! command -v initdb >/dev/null 2>&1; then
  echo "PostgreSQL is not installed. Install it (apt-get install postgresql) or use docker compose up -d db." >&2
  exit 1
fi

start_cluster() {
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    sudo service postgresql start || sudo pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start
    return
  fi
  sudo -u postgres initdb -D "$PGDATA" >/dev/null 2>&1 || true
  sudo -u postgres pg_ctl -D "$PGDATA" -o "-p $PGPORT -c listen_addresses=localhost" -l /tmp/edutrack-pg.log start
}

start_cluster

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB; END IF; END \$\$;"
for db in edutrack_pro edutrack_pro_shadow edutrack_pro_test; do
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
    || sudo -u postgres createdb -O "${DB_USER}" "${db}"
done
echo "PostgreSQL ready: edutrack_pro / edutrack_pro_shadow / edutrack_pro_test on port ${PGPORT}"
