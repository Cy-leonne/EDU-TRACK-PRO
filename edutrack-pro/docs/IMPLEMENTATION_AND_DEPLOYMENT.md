# EduTrack Pro — implementation & deployment commands

A short, command-first companion to the longer docs. Use it to bring the system up, run the
verification gates, and deploy it. Everything below is copy-pasteable; deeper explanation lives in
[ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [SECURITY.md](SECURITY.md),
[DEPLOYMENT.md](DEPLOYMENT.md) and [TESTING.md](TESTING.md).

---

## 1. Implementation at a glance

| Piece | Technology | Location | Runs as |
| --- | --- | --- | --- |
| API | NestJS 10 + Prisma + PostgreSQL | `apps/api`, `prisma/` | `node apps/api/dist/main.js` → `:4000` |
| Web workspace | Next.js 14 (App Router) | `apps/web` | `next start` → `:3000` |
| Mobile | Expo React Native | `apps/mobile` (own dependency tree) | Expo Go / native builds |
| Shared code | Zod schemas + types + config | `packages/{validation,shared-types,shared-config}` | compiled into both clients |
| Tests | Jest (unit/integration/e2e), Playwright (browser), smoke | `apps/api/test`, `apps/web/e2e`, `tests/smoke` | CI / local |

**Roles — exactly three:** `ADMIN`, `TEACHER`, `PARENT`. Learners are records, never logins.
Authorisation is enforced by the API (guards + permissions + tenant scoping); the UI only mirrors it.

**Auth model:** JWT access token (15 min) + rotating refresh token (30 days) issued by
`/api/v1/auth/*`, stored client-side and replayed to the API. Teachers and extra admins are
**invitation-only** (`AccountInvitation`, hashed token, 7-day TTL). Guardians self-register with a
school code and only see a learner after an admin verifies the parent–learner link. Password resets
are single-use, 1-hour, and revoke every refresh token.

**Data rules that the code depends on:** school onboarding is one transaction (school + calendar +
Grades 7–9 + default categories/bands); the bell schedule and weekly period requirements must exist
before timetable generation; published timetables and published assessments are immutable; assessment
bands and weights are school-configured — no national thresholds are encoded.

---

## 2. Prerequisites

* Node.js 20+ and npm 10+
* PostgreSQL 16 or 17 (local service or Docker)
* `openssl` (secret generation)
* Playwright browsers — only for the browser E2E suite

```bash
npm install                 # also runs `prisma generate`
```

---

## 3. Local setup

```bash
# 1) environment
cp .env.example .env
#    minimum: DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
openssl rand -base64 48     # run twice, one value per JWT secret

# 2) database (either docker or a local cluster)
docker compose up -d db                     # postgres:16-alpine on :5432
# or: createdb edutrack_pro

# 3) schema + data
npm run build:packages       # shared packages must be compiled first
npm run prisma:migrate       # prisma migrate deploy (non-destructive)
SEED_ADMIN_PASSWORD='<strong-pass>' \
SEED_TEACHER_PASSWORD='<strong-pass>' \
SEED_PARENT_PASSWORD='<strong-pass>' npm run db:seed

# 4) run both apps with hot reload
npm run dev                  # API :4000 + web :3000
```

One command instead: `./scripts/bootstrap-dev.sh` does steps 1–4 (creates the role/databases, writes
`.env` with generated secrets, installs, migrates, seeds, builds) and prints the sign-in details.

| Endpoint | URL |
| --- | --- |
| Web workspace | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| Swagger / OpenAPI | http://localhost:4000/api/v1/docs |
| Health / readiness | http://localhost:4000/health · http://localhost:4000/api/v1/health/ready |

Split commands when you need them: `npm run dev:api`, `npm run dev:web`.

---

## 4. Environment variables

Full list with placeholders: [`.env.example`](../.env.example). The API validates its configuration at
startup and **refuses to boot** with a clear message when something required is missing.

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` behind HTTPS — it also disables demo seeding |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | yes | ≥32 chars, different per environment |
| `CORS_ORIGINS` | yes | exact browser origins of the web app (comma separated) |
| `PUBLIC_WEB_URL` | prod | base URL used in invitation / reset links |
| `COOKIE_SECURE` | prod | `true` over HTTPS |
| `COOKIE_DOMAIN` | optional | set when web and API share a parent domain |
| `AUTH_RATE_LIMIT_*`, `GLOBAL_RATE_LIMIT_MAX` | yes | brute-force protection |
| `INITIAL_ADMIN_SETUP_TOKEN` | one-time | enables `POST /auth/setup/first-admin`; leave empty afterwards |
| `ALLOW_SCHOOL_SELF_REGISTRATION` | yes | `true` only if schools may self-onboard |
| `ALLOW_PARENT_SELF_REGISTRATION` | yes | guardian self-registration (link still needs verification) |
| `STORAGE_DRIVER` + `STORAGE_LOCAL_DIR` or `S3_*` | yes | `local` is development-only; production uses private object storage |
| `MAX_UPLOAD_MB`, `SIGNED_URL_TTL_SECONDS` | yes | upload limits and download-link lifetime |
| `EMAIL_PROVIDER` + SMTP/S3 credentials | as available | `console` logs a summary; features stay usable without a provider |
| `ALLOW_DEMO_SEED` | no | dev only; the seed refuses to run in production without it |

Never commit a real `.env`. `NEXT_PUBLIC_*` values are the only ones exposed to the browser — no
secrets go there.

---

## 5. Database steps

```bash
npm run prisma:migrate        # prisma migrate deploy  — safe, forward-only, no data deletion
npm run prisma:migrate:dev    # prisma migrate dev     — development only, creates migrations
npm run prisma:studio         # browse data
npm run db:seed               # demo school (dev; blocked when NODE_ENV=production)
npm run setup:admin           # provision a real administrator without demo data
npm run db:reset              # DESTRUCTIVE: wipes and reseeds — local development only
```

Create the first production administrator **without** demo data:

```bash
npm run setup:admin -- --email head@school.ac.ke --name "Jane Doe" --school "Mwangaza Junior School"
```

Test databases are separate (`edutrack_pro_test`, `edutrack_pro_shadow`, `edutrack_pro_uat`);
`TEST_DATABASE_URL` and the E2E harness refuse to run against anything not ending in `_test`.

---

## 6. Verification gates

```bash
npm run typecheck            # API + web + mobile, no emit
npm run lint                 # eslint (API, max-warnings=0) + next lint
npm run test                 # Jest: unit + integration + API e2e  (needs PostgreSQL)
npm run test:integration     # integration suites only
npm run test:e2e             # API end-to-end journeys only
node tests/smoke/smoke.mjs   # black-box checks against a running API
```

Browser E2E (Playwright; starts its own API + a production web build on `:4101`/`:4100`, uses the
`*_test` database, seeds its own fixtures):

```bash
npm run e2e:install          # one-off: Playwright chromium + system libraries
npm run test:e2e:web         # = npm --prefix apps/web run e2e
```

The Playwright web server runs `npm run e2e:serve` (`next build && next start`), so the suite always
tests a production build. `apps/web/e2e/global-setup.mjs` migrates and seeds the dedicated test
database and refuses to continue unless `E2E_DATABASE_URL` contains `_test`.

Production build check:

```bash
npm run build                # nest build + next build
```

---

## 7. Deployment

### 7.1 Single host / VM

```bash
# --- on the host, once -------------------------------------------------
git clone <repo> /srv/edutrack-pro && cd /srv/edutrack-pro
cp .env.example .env && $EDITOR .env        # fill every CHANGE_ME
npm ci
npm run build:packages

# --- database (non-destructive) ---------------------------------------
npm run prisma:migrate                      # prisma migrate deploy

# --- build -------------------------------------------------------------
npm run build                               # API dist + Next.js production build

# --- run (supervisor, systemd, pm2, ...) ------------------------------
NODE_ENV=production node apps/api/dist/main.js          # :4000
NODE_ENV=production npm run start:web                   # :3000  (next start)
```

### 7.2 First administrator

```bash
# Option A — one-time HTTP bootstrap (no shell access to the DB needed)
openssl rand -hex 32                        # paste into INITIAL_ADMIN_SETUP_TOKEN, restart API
curl -X POST https://api.example.ac.ke/api/v1/auth/setup/first-admin \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token>","email":"head@school.ac.ke","fullName":"Jane Doe","password":"<strong>","schoolName":"Mwangaza Junior School"}'
# then REMOVE INITIAL_ADMIN_SETUP_TOKEN and restart — the route is disabled

# Option B — CLI
npm run setup:admin -- --email head@school.ac.ke --name "Jane Doe" --school "Mwangaza Junior School"
```

Every other account is created from the admin UI (invitations for staff, verified links for
guardians). The route returns `401` for a wrong token and `409` once a school already exists.

### 7.3 Reverse proxy and TLS

Terminate HTTPS at the boundary and forward `X-Forwarded-*`:

* Serve the web app and API on **HTTPS** origins that match `CORS_ORIGINS` and `PUBLIC_WEB_URL`.
* `COOKIE_SECURE=true`; HSTS, `X-Content-Type-Options: nosniff`, a Content-Security-Policy and
  `Referrer-Policy` at the proxy.
* Set `EMBED_ALLOWED_ORIGINS` **empty** in production (framing refused) and keep `STORAGE_LOCAL_DIR`
  outside every web-served directory; prefer `STORAGE_DRIVER=s3` with a private bucket.
* Example nginx location names: `/` → `127.0.0.1:3000`, `/api/v1` → `127.0.0.1:4000`.

### 7.4 Docker Compose

```bash
cp .env.example .env      # fill in values first
docker compose up -d --build      # db, redis, mailhog, api, web
docker compose logs -f api
```

The compose file is a development/staging topology (it ships mailhog and a local Postgres). For
production, keep the same images but point `DATABASE_URL` at a managed database, drop the `mail`
service, and put the API/web containers behind the proxy described above.

### 7.5 Post-deploy verification

```bash
curl -fsS https://api.example.ac.ke/health
API_URL=https://api.example.ac.ke/api/v1 \
SMOKE_ADMIN_EMAIL=head@school.ac.ke SMOKE_ADMIN_PASSWORD='<pass>' \
  node tests/smoke/smoke.mjs
```

Then click through: sign in as admin → invite a teacher → accept the invitation as the teacher →
register a guardian → admin verifies the learner link → teacher records and publishes a result →
guardian sees only that child.

### 7.6 Backups, migrations and rollback

```bash
pg_dump -Fc "$DATABASE_URL" > edutrack-$(date +%F).dump      # before every deploy
pg_restore -d "$DATABASE_URL" --clean --if-exists edutrack-2026-10-16.dump
```

Migrations are forward-only and additive (`prisma migrate deploy` never deletes data). Deploy order:
**backup → migrate → build → restart API → restart web**. Roll back the application by redeploying
the previous build; if a migration must be reversed, restore the dump and redeploy the matching build.
Never run `prisma migrate reset`, `db:reset` or the demo seed against production.

### 7.7 Mobile

```bash
npm run mobile:install
npm run mobile:start          # Expo dev server
npm run mobile:android        # or: npm run mobile:ios
```

Point the app at your API with `EXPO_PUBLIC_API_URL` (see [MOBILE.md](MOBILE.md)) and ship through
EAS/Play/App Store with your own signing credentials.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| API exits with a configuration error | A required variable in §4 is missing or a secret is shorter than 32 chars |
| `Could not find a production build` | Run `npm run build` (or `npm run e2e:serve`, which builds first) |
| Web calls return 503 / `fetch failed` | `API_INTERNAL_URL` (or the dev proxy target) does not point at a running API |
| 401 on every call after a deploy | `JWT_*_SECRET` changed — every existing token is invalidated; users must sign in again |
| Guardian sees no results | The parent–learner link is unverified, or the result is not published |
| Timetable generation refuses to run | Bell schedule or weekly period requirements are missing — set both first |
| Rate-limited (`429`) while testing | Raise `AUTH_RATE_LIMIT_MAX` / `GLOBAL_RATE_LIMIT_MAX` locally |
| E2E harness aborts at startup | `E2E_DATABASE_URL` does not end in `_test` (deliberate safety guard) |

---

## 9. Deployment status

Verified in this repository (all local, against PostgreSQL 17):

| Gate | Command | Result |
| --- | --- | --- |
| API tests | `npm run test` | 15 suites / **173 tests passing** |
| Browser E2E | `npm run test:e2e:web` | **47 tests passing** (production build, dedicated `*_test` database) |
| Smoke | `node tests/smoke/smoke.mjs` | 30/30 |
| Screen contracts | `python3 scratch/verify_screens.py` | 41/41 |
| Production web build | `npm run build` (API + web) | exit 0 — 35 routes |
| Migrations | `npm run prisma:migrate` | non-destructive, forward-only |
| Dev seed | `npm run db:seed` | synthetic school only; refuses to run with `NODE_ENV=production` |

**Not yet done here, because the credentials or services were unavailable:**

* No deployment to a live host — no domain, host or TLS certificate was provided.
* Email delivery is configured but untested against a real provider (`EMAIL_PROVIDER=console` here);
  set `SMTP_*` (see [EMAIL_SETUP.md](EMAIL_SETUP.md)) or an API key provider.
* Object storage is in `local` driver mode; set `S3_*` (endpoint, bucket, keys, region) to switch.
* The `Dockerfile`s and `docker-compose.yml` are present but were **not built** in this environment;
  the images should be built once on the target machine with `docker compose build`.
* Mobile binaries are not published: Store/Play signing identities and EAS credentials are missing.

No claim is made that the product is deployed or live.
