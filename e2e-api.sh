#!/usr/bin/env bash
cd /home/user/edutrack-pro
export NODE_ENV=production PORT=4101 \
  DATABASE_URL='postgresql://edutrack:edutrack_dev_password@localhost:5432/edutrack_pro_test?schema=public' \
  JWT_ACCESS_SECRET='e2e-access-secret-value-not-used-anywhere-else-0001' \
  JWT_REFRESH_SECRET='e2e-refresh-secret-value-not-used-anywhere-else-0002' \
  COOKIE_SECURE=false CORS_ORIGINS='http://127.0.0.1:4100' PUBLIC_WEB_URL='http://127.0.0.1:4100' \
  STORAGE_DRIVER=local STORAGE_LOCAL_DIR=/home/user/edutrack-pro/storage-e2e EMAIL_PROVIDER=console \
  ALLOW_SCHOOL_SELF_REGISTRATION=true ALLOW_PARENT_SELF_REGISTRATION=true \
  AUTH_RATE_LIMIT_MAX=1000 AUTH_RATE_LIMIT_WINDOW_MS=60000 GLOBAL_RATE_LIMIT_MAX=100000 LOG_LEVEL=warn
exec node apps/api/dist/main.js
