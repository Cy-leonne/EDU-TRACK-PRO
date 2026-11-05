# EduTrack Pro API image.
# Build context is the REPOSITORY ROOT (see docker-compose.yml), because the API
# consumes the @edutrack/* workspace packages.
#
#   docker build -f apps/api/Dockerfile -t edutrack-pro-api .
#
# NOTE: this image was written for deployment but is not built in the development
# sandbox (no Docker daemon there). Treat it as a starting point: verify the build
# in your own CI before relying on it.

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY prisma ./prisma
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @edutrack/shared-config --workspace @edutrack/shared-types --workspace @edutrack/validation --workspace @edutrack/api --include-workspace-root
RUN npm run build:packages && npm run -w @edutrack/api build

# ---------- runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S edutrack && adduser -S edutrack -G edutrack
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/storage && chown -R edutrack:edutrack /app/storage
USER edutrack
EXPOSE 4000
# Migrations are run explicitly (docker compose run --rm api node_modules/.bin/prisma migrate deploy)
# so that a bad migration never blocks a container from starting.
CMD ["node", "apps/api/dist/main.js"]
