# EduTrack Pro web image (Next.js).
# Build context is the REPOSITORY ROOT: the web app imports the same shared
# packages as the API.
#
#   docker build -f apps/web/Dockerfile -t edutrack-pro-web .
#
# NOTE: written for deployment, not built in the development sandbox (no Docker
# daemon there). Verify in your own CI before relying on it.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --workspace @edutrack/shared-config --workspace @edutrack/shared-types --workspace @edutrack/validation --workspace @edutrack/web --include-workspace-root
RUN npm run build:packages && npm run -w @edutrack/web build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S edutrack && adduser -S edutrack -G edutrack
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/package.json ./package.json
USER edutrack
EXPOSE 3000
CMD ["npm", "run", "-w", "@edutrack/web", "start"]
