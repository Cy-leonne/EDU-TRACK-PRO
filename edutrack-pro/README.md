# EduTrack Pro

A school records platform for **Kenyan junior schools (Grades 7–9)** — competency-based assessment
recording, learning resources and hand-ins, and a constraint-based timetable engine, with role-based
access for **administrators, teachers and guardians**.

Built as a real, runnable application: NestJS API + PostgreSQL, a Next.js web workspace, and an Expo
React Native app for Android and iOS. Everything in this repository was generated as working source —
no mockups, no dead buttons, no schema-only scaffolding.

> **Curriculum note.** "CBE" describes the competency-based curriculum context the product serves.
> EduTrack Pro records a *school's own* assessment practice: categories and achievement bands are
> school-configured, and nothing here encodes or claims official national grading, KNEC classification
> or national thresholds.

---

## 1. Quick start

```bash
# 1. dependencies (Node 20+, PostgreSQL 16/17)
npm install

# 2. environment — copy the template and fill in your own values
cp .env.example .env
#   minimum: DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
#   generate secrets with: openssl rand -base64 48

# 3. database
createdb edutrack_pro                 # or: docker compose up -d db
npx prisma migrate deploy             # applies prisma/migrations/*
SEED_ADMIN_PASSWORD='<strong-pass>' \
SEED_TEACHER_PASSWORD='<strong-pass>' \
SEED_PARENT_PASSWORD='<strong-pass>' npm run db:seed

# 4. run
npm run dev                           # API :4000  +  web :3000  (hot reload)
```

Prefer one command? `./scripts/bootstrap-dev.sh` performs steps 1–4 (databases, generated secrets,
migrations, seed, build) and prints the sign-in details.

| Service | URL |
| --- | --- |
| Web workspace | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| Swagger / OpenAPI | http://localhost:4000/api/v1/docs |
| Health | http://localhost:4000/health · `/api/v1/health/ready` |

### Demo sign-ins (development seed only)

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@nhjs.demo` | `Admin-EduTrack-2026!demo` |
| Teacher | `teacher@nhjs.demo` | `Teacher-EduTrack-2026!demo` |
| Guardian | `parent@nhjs.demo` | `Parent-EduTrack-2026!demo` (3 linked learners) |

Demo school: **Nakuru Hills Junior School (Demo)**, code `NHJS-001`, timezone `Africa/Nairobi`.
These accounts exist only in the local development seed (`npm run db:seed`, which refuses to run when
`NODE_ENV=production`). Nothing in the shipped web app references them — the sign-in page has no demo
panel and no quick-fill buttons. **Replace them before any real use**: see
[IMPLEMENTATION_AND_DEPLOYMENT.md](docs/IMPLEMENTATION_AND_DEPLOYMENT.md) for the first-admin
bootstrap flow and for leaving `INITIAL_ADMIN_SETUP_TOKEN` empty.

## 2. What it does

**Administrator** — school profile (identity, colours, timezone, working days, bell times, breaks,
lunch), academic years and terms, teachers (availability, workload caps, preferred free days), learners
(assessment number, CSV import with dry-run), guardians (create, link, verify), classes and enrolment,
learning areas with strands/sub-strands, teacher assignments and coverage, school reports, CSV exports,
audit trail.

**Teacher** — today's lessons and workload, assessment creation (marks, rubric or both; strands and
sub-strands), evidence upload (PDF/JPG/PNG, signature-validated), a results grid with drafts,
ready-for-review and publication, narrative feedback, correction with reason and change history,
learning resources and assignments, hand-in review.

**Guardian** — only their own verified linked children: published results and progress per learning area,
the published class timetable, learning resources and assignments for the child's class, hand-in from the
camera or a file, notifications with per-type preferences.

**Timetable engine** — generate a full timetable from real school data under hard constraints (no
teacher/class/room clashes, availability, workload caps, break/lunch, correct year/term), review it in a
colour-coded week grid (class / teacher / whole-school / room views), adjust by drag-and-drop or a
keyboard form, revalidate against a conflict panel with suggested resolutions, then publish as a version
(admin only). Infeasible requests come back with diagnostics instead of a broken timetable, and published
versions are immutable.

## 3. Repository map

```
apps/api          NestJS REST API (module list in docs/ARCHITECTURE.md)
apps/web          Next.js 14 workspace UI (admin / teacher / guardian)
apps/mobile       Expo React Native app (Android + iOS)
packages/         shared-config, shared-types, validation — used by all three clients and the tests
prisma/           schema (48 models), migrations, deterministic seed
docs/             architecture, database, API, workflows, security, deployment, testing, mobile
tests/            black-box smoke suite for a running API
scripts/          bootstrap-dev.sh, create-admin.ts, dev-db-up.sh, init-test-db.sql
```

## 4. Commands

```bash
# development
npm run dev                 # API + web
npm run dev:api             # API only
npm run dev:web             # web only

# database
npm run prisma:migrate      # prisma migrate deploy
npm run prisma:migrate:dev  # create a migration in development
npm run db:seed             # deterministic demo data
npm run db:reset            # reset + reseed (destructive, development only)
npm run setup:admin         # create/replace an administrator from the CLI

# build & run for production
npm run build               # API (nest build) + web (next build)
npm run start:api
npm run start:web

# quality
npm run typecheck           # API + web + mobile
npm run lint
npm run test                # API unit + integration + E2E (needs PostgreSQL)
npm run test:all
node tests/smoke/smoke.mjs  # black-box checks against a running API

# browser suite (own API + a production web build on its own ports)
npm run e2e:install         # one-off: Playwright chromium + system libraries
npm run test:e2e:web        # 47 Playwright tests against the *_test database

# mobile
npm run mobile:install      # installs the app's own dependency tree
npm run mobile:start        # Expo dev server (Expo Go / emulator)
npm run mobile:android
npm run mobile:ios
npm run mobile:typecheck
```

## 5. Verification status

Verified in this repository (see [docs/TESTING.md](docs/TESTING.md) for the exact commands):

* **173 API tests passing** across 15 suites — unit (validation, permissions, password hashing,
  publication rules, scheduling constraints, conflict detection, timetable generation/validation,
  calendar rules, file validation), integration (auth and school isolation, **registration and
  invitations**, people and enrolment, assessments and results, files, submissions, notification
  preferences, exports) and **10/10 end-to-end journeys** (admin setup → teacher created → learners and
  class → learning area and assignment → bell schedule → timetable generate/validate/adjust/publish →
  teacher assessment with evidence and published results → guardian published-only views → cross-school
  denials → audit trail).
* **47 browser tests passing** (Playwright) against a production `next build`: sign-in/out with
  server-side revocation, role routing, tampered sessions, single-use password resets, teacher
  invitations from the office screen through activation, database-backed create/edit/publish journeys,
  guardians seeing only verified children, ID-tampering and guessed-file refusals, and responsive /
  accessibility checks at 390, 834 and 1440 px.
* **30/30 black-box smoke checks** against the running API; **41/41 web screen contracts**; every web
  route returns HTTP 200 in development and the production web build (`next build`) compiles 35 routes
  cleanly; API, web and mobile typechecks clean.
* **Mobile app bundles for both Android and iOS** (`expo export`), not just typechecks.

Honest gaps are listed in [docs/FEATURES_AND_LIMITATIONS.md](docs/FEATURES_AND_LIMITATIONS.md):
email delivery and S3 storage need your credentials, the deployment Dockerfiles were not built in this
environment, the mobile app has no automated UI tests yet and has not been run on physical hardware,
and there is no national-exam integration because none is claimed.

## 6. Documentation

Start at [docs/README.md](docs/README.md) — the short command-first guide is
[IMPLEMENTATION_AND_DEPLOYMENT](docs/IMPLEMENTATION_AND_DEPLOYMENT.md).
Highlights: [ARCHITECTURE](docs/ARCHITECTURE.md),
[DATABASE](docs/DATABASE.md), [API](docs/API.md), [ASSESSMENT_WORKFLOW](docs/ASSESSMENT_WORKFLOW.md),
[TIMETABLE_ENGINE](docs/TIMETABLE_ENGINE.md), [SECURITY](docs/SECURITY.md),
[DEPLOYMENT](docs/DEPLOYMENT.md), [EMAIL_SETUP](docs/EMAIL_SETUP.md), [MOBILE](docs/MOBILE.md),
[TESTING](docs/TESTING.md), [FEATURES_AND_LIMITATIONS](docs/FEATURES_AND_LIMITATIONS.md),
[REDESIGN_AND_AUTH_REPORT](docs/REDESIGN_AND_AUTH_REPORT.md).

## 7. Licence and data

No real learner data is included: the seed generates synthetic names, admission numbers and assessment
numbers. Uploaded files and secrets never enter version control (see `.gitignore` and
[docs/SECURITY.md](docs/SECURITY.md)).
