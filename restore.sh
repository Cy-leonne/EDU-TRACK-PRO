#!/usr/bin/env bash
# Rebuild the dev environment after a sandbox recycle (not part of the deliverable).
set -x
cd /home/user/edutrack-pro || exit 1

# --- swap (npm install got OOM-killed without it) ---
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 6G /swapfile || true
  sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
fi

# --- postgres ---
if ! command -v psql >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql postgresql-contrib
fi
sudo service postgresql start || sudo pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start || true
sleep 2
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='edutrack'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE edutrack LOGIN PASSWORD 'edutrack_dev_password' CREATEDB;"
for db in edutrack_pro edutrack_pro_shadow edutrack_pro_test edutrack_pro_uat; do
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || sudo -u postgres createdb -O edutrack "$db"
done

# --- node deps ---
npm install --no-audit --no-fund --prefer-offline
npm run build:packages
npx prisma migrate deploy
SEED_ADMIN_PASSWORD='Admin-EduTrack-2026!demo' SEED_TEACHER_PASSWORD='Teacher-EduTrack-2026!demo' SEED_PARENT_PASSWORD='Parent-EduTrack-2026!demo' npm run db:seed
npm run -w @edutrack/api build
npm --prefix apps/mobile install --no-audit --no-fund --prefer-offline
echo "RESTORE_COMPLETE"
