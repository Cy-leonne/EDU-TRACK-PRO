# Deployment

## 1. Requirements

| Component | Version used / tested |
| --- | --- |
| Node.js | 20.x (`engines.node >= 20`) |
| npm | 10.x (workspaces) |
| PostgreSQL | 16 (17 also works; tested on 17.11) |
| Optional | Docker + Docker Compose, Redis (only for queued generation), S3-compatible bucket, SMTP provider |

## 2. Install, migrate, seed, run (single host)

```bash
git clone <your-repo> edutrack-pro && cd edutrack-pro
cp .env.example .env                  # then edit: secrets, DATABASE_URL, storage, email
npm install                           # installs workspaces, regenerates the Prisma client
npm run build:packages                # compile shared-config / shared-types / validation

# database (see §3 if you prefer Docker for Postgres)
createdb edutrack_pro                # or: createdb -O edutrack edutrack_pro
npx prisma migrate deploy             # applies prisma/migrations/*
SEED_ADMIN_PASSWORD='<strong-pass>' \
SEED_TEACHER_PASSWORD='<strong-pass>' \
SEED_PARENT_PASSWORD='<strong-pass>' npm run db:seed

npm run build                         # API (nest build) + web (next build)
npm run start:api                     # http://0.0.0.0:4000  (Swagger: /api/v1/docs)
npm run start:web                     # http://0.0.0.0:3000
```

Development with hot reload: `npm run dev` (API + web in parallel), or `npm run dev:api` / `npm run dev:web`.

**Do not keep the seeded demo accounts in production.** Either seed with your own passwords and change
them at first sign-in, or create the first administrator explicitly:

```bash
# 1. generate a one-time token and put it in .env as INITIAL_ADMIN_SETUP_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# 2. restart the API and call the bootstrap endpoint once
curl -X POST http://localhost:4000/api/v1/auth/setup/first-admin \
  -H 'Content-Type: application/json' \
  -d '{"setupToken":"<token>","email":"head@school.ac.ke","fullName":"Head Teacher","password":"<strong-pass>","schoolName":"My Junior School"}'
# 3. remove INITIAL_ADMIN_SETUP_TOKEN from .env and restart — the endpoint is then disabled
```

`npm run setup:admin` is an equivalent CLI path (`scripts/create-admin.ts`) for local use.

## 3. Docker Compose

```bash
docker compose up -d db                 # PostgreSQL 16 on :5432 (+ test database via init script)
docker compose --profile email up -d mail    # MailHog UI on :8025 (dev only)
docker compose --profile queue up -d redis   # only when QUEUE_ENABLED=true
```

The `full` profile builds the API and web images from `apps/api/Dockerfile` and `apps/web/Dockerfile`
(they expect the repository root as build context). Those Dockerfiles are provided for deployment but
were **not built inside this project's development sandbox** (no Docker daemon available there), so
treat the first CI build as the verification step. Migrations are intentionally not run from the image
entrypoint:

```bash
docker compose run --rm api node_modules/.bin/prisma migrate deploy
```

## 4. Environment variables

Every variable is documented in `.env.example`. The ones that must be changed for production:

| Variable | Why |
| --- | --- |
| `NODE_ENV=production` | enables production error handling and cookie rules |
| `DATABASE_URL` | point at your PostgreSQL instance; use a least-privilege role |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48`, different per environment |
| `CORS_ORIGINS` | your web origin(s) only |
| `EMBED_ALLOWED_ORIGINS` | **leave empty** in production (framing refused) |
| `COOKIE_SECURE=true` | required once served over HTTPS |
| `COOKIE_DOMAIN` | your domain, so the refresh cookie is scoped correctly |
| `API_PUBLIC_URL` | your public API URL (links, emails, Swagger) |
| `STORAGE_DRIVER=s3` + `S3_*` | private object storage; `local` is for single-host/dev only |
| `EMAIL_PROVIDER=smtp` + `SMTP_*` | real email delivery (see EMAIL_SETUP.md) |
| `INITIAL_ADMIN_SETUP_TOKEN` | **must be empty** after bootstrap |
| `TEST_DATABASE_URL` | must point at a database that can be dropped/recreated |

Startup validates configuration and fails fast on missing/placeholder secrets.

## 5. Serving the web app

* The browser talks only to the web origin; Next rewrites `/api/v1/*` to the API. Set
  `NEXT_PUBLIC_API_URL` (or `API_INTERNAL_URL`) for the server-side rewrite target.
* Put TLS in front of both (nginx, Caddy, cloud LB). Example nginx sketch:

```nginx
server {
  listen 443 ssl http2;
  server_name school.example.ac.ke;
  ssl_certificate     /etc/letsencrypt/live/school.example.ac.ke/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/school.example.ac.ke/privkey.pem;
  client_max_body_size 20m;          # slightly above MAX_UPLOAD_MB

  location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; }
  location /     { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
}
```

## 6. Operations

* **Backups** — `pg_dump -Fc edutrack_pro > edutrack-$(date +%F).dump` on a schedule, plus an offsite
  copy; restore with `pg_restore -d edutrack_pro`. Uploaded files live in the storage directory or the
  S3 bucket and need their own backup/versioning policy.
* **Logs** — the API logs request lines without secrets or child identifiers; ship stdout to your
  log platform. Audit trails are in the database (`AuditLog`), not only in logs.
* **Health** — `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (checks the database).
  Use them for your load balancer and container orchestrator.
* **Scaling** — the API is stateless apart from the database and storage, so it scales horizontally.
  Timetable generation is CPU-bound: with `QUEUE_ENABLED=true` and `REDIS_URL` set, generation can be
  moved onto a queue worker instead of holding a request open.
* **Migrations on deploy** — run `prisma migrate deploy` as a release step, before the new containers
  take traffic. Never `migrate reset` in production.
* **Timezone** — the server should run with `TZ=Africa/Nairobi` (or a school-appropriate zone); the
  school's own timezone is also stored on `School` and used for date-only fields and bell times.

## 7. Deploying the mobile app

See [MOBILE.md](MOBILE.md). In short: `npm run mobile:install`, point `app.json → expo.extra.apiUrl`
at your public API, then `npx eas build -p android --profile preview` / `-p ios`. Both platforms bundle
in this repository (`npx expo export --platform android|ios`).
