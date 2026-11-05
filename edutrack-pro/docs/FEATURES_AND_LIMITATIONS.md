# Completed features and limitations

This is the honest inventory. "Working" means executed and verified in this repository;
"configuration only" means the code is written and wired, but it needs credentials or infrastructure
that do not ship here; "not built" means exactly that.

## 1. Working and verified

**Platform**
- npm-workspaces monorepo (`apps/api`, `apps/web`, `apps/mobile`, `packages/*`), TypeScript everywhere.
- PostgreSQL + Prisma with **48 models, 19 enums, 95 indexes/uniques**, two migrations, deterministic seed.
- REST API under `/api/v1` (123 documented paths / 157 operations) with a uniform `{ success, data }` envelope, uniform errors, Zod
  validation from shared schemas, Swagger/OpenAPI at `/api/v1/docs`, health endpoints.
- Docker Compose for PostgreSQL (plus optional Redis and MailHog) and Dockerfiles for API and web.
- Shared packages (`shared-config`, `shared-types`, `validation`) consumed by API, web, mobile and tests.

**Authentication and authorisation**
- Exactly three roles (Admin 36 permissions, Teacher 18, Parent 9); learners are records with no login.
- Argon2id hashing, short-lived access tokens, hashed + rotated refresh tokens, `HttpOnly` cookies for
  web, keychain storage on mobile, auth rate limiting, password reset, `mustChangePassword` flow.
- Tenant isolation on every school-owned object, with cross-school denial verified by tests.
- Verified guardian links with per-link `canViewResults` / `canViewResources`; unverified links expose
  nothing; assessment numbers are never an authentication factor.
- Audit log for privileged actions; published results carry a correction trail with reasons.

**School administration (web)**
- School profile (name, identity, colours, timezone, working days, school hours, bell times, breaks,
  lunch), academic years and terms with current/locked/results-publication flags.
- Teachers (including availability, workload caps, preferred free days), learners (including assessment
  number, CSV import with dry-run), guardians (create, link, verify, revoke capabilities).
- Classes, enrolment, learning areas with strands and sub-strands, teacher assignments, coverage view.
- Dashboards for each role, school reports, four CSV exports (learners, teachers, results, timetable).

**Assessment and learning**
- School-defined categories and achievement bands (explicitly not national classifications; every result
  is labelled `SCHOOL_DEFINED_ACHIEVEMENT_BAND`).
- Assessments with marks, rubric or both; strands/sub-strands; rubrics with criteria and levels.
- Draft → ready-for-review → published → corrected lifecycle; publication gated by term rules;
  corrections require a reason and write an immutable change log; guardians are notified.
- Narrative feedback, learner result history, progress per learning area, assessment dashboard.
- Learning resources and assignments tied to class + learning area; guardian hand-in with file upload,
  review workflow (accept/return with reason), completion summary per assignment.

**Files**
- Signature + MIME validation (not extension), allow-list, size ceiling, server-generated private keys,
  local-disk and S3-compatible drivers, time-limited authorised download links, no public URLs.

**Timetable engine**
- Configuration panel data (days, periods, breaks, lunch, weekly requirements, availability, workload
  caps, rooms), deterministic constraint-aware generation, preflight checks.
- Hard constraints (no teacher/class/room double-booking, no break/lunch/outside-day lessons,
  availability, valid teacher–area–class relation, workload caps, correct year/term, learner overlap).
- Soft preferences (subject spread, consecutive-lesson control, teacher gaps, teacher preferences) with
  reported trade-offs; infeasible requests return `FAILED` with actionable diagnostics — nothing invalid
  is ever published.
- Admin workspace: week grid colour-coded by learning area, class/teacher/school/room views, conflict
  panel with severity and suggested resolution, drag-and-drop **and** a keyboard/form alternative,
  immediate revalidation.
- Versioning draft → validated → published → superseded with timestamps and audit history; admin-only
  publishing; teacher and guardian read-only views; published versions immutable.

**Interfaces**
- Web: 26 routes verified HTTP 200, responsive mobile-first guardian/teacher flows and desktop-optimised
  admin/teacher workspaces, drag-and-drop upload with previews and progress, CSV import with row errors.
- Mobile: Expo/React Native app for Android and iOS, both bundles verified to build; teacher and guardian
  screens; camera/file hand-in with client-side policy checks; role-based navigation.

**Verification**
- 148 automated API tests (unit, integration, E2E) passing; 30-check black-box smoke suite; 41/41 screen
  contracts; three typechecks clean. See [TESTING.md](TESTING.md).

## 2. Written and wired — needs configuration or infrastructure

| Feature | Code | What is missing |
| --- | --- | --- |
| Email notifications | provider abstraction, preferences, `emailStatus` tracking | SMTP credentials (`EMAIL_PROVIDER=smtp`); defaults to a console summary. Per-type muting works in-app today. |
| S3-compatible private storage | driver implemented, signed URLs, key layout | bucket + credentials (`STORAGE_DRIVER=s3`, `S3_*`); local disk is used in development. |
| Queued timetable generation | `QUEUE_ENABLED`, `REDIS_URL`, job model + status | a Redis instance; generation runs inline today, which is fine for a single school. |
| Production containers | `apps/api/Dockerfile`, `apps/web/Dockerfile`, compose profiles | Docker is unavailable in the development sandbox, so those images were **not** built here — verify in your CI. |
| Mobile store builds | `eas.json` profiles, app.json identifiers | Expo account, Apple/Google developer accounts; local bundles were verified instead. |

## 3. Not built (deliberately or pending)

- **No student, super-admin, accountant or librarian logins** — the first iteration has exactly three
  roles, as specified.
- **No automated mobile UI tests** (no `jest-expo`/RNTL suite yet); the API behaviour the app uses is
  covered by the API suites. The app has not been run on physical hardware from this environment.
- **No browser-automation (Playwright) suite for the web UI** — screen contracts and route checks were
  used instead.
- **No MFA** for administrators; no SSO.
- **No timetable auto-solver improvements** such as cross-term templates, class-splitting, or
  team-teaching beyond the current constraint set.
- **No official examination integration** — and none is claimed: no KNEC reporting, no national
  thresholds, no computed national grades.
- **No SMS channel** for guardians (in-app and optional email only).
- **No payment/billing, library, transport or hostel modules.**
- **No data-migration tooling** to import an existing school's records beyond the CSV importers for
  learners and teachers.
- **No automated backup routine** (documented `pg_dump` approach only).
- **No super-admin console to manage multiple schools from one account**; each school is isolated and
  administered by its own administrators.

## 4. Operational notes worth repeating

- The seed's demo passwords exist for development only; change or replace them before any real use, and
  leave `INITIAL_ADMIN_SETUP_TOKEN` empty so the first-admin endpoint stays disabled.
- `apps/mobile` keeps its own dependency tree (documented in MOBILE.md) — install it with
  `npm run mobile:install`.
- The download/CSV routes bypass the JSON envelope on purpose; any new streaming route must be marked
  `@RawResponse()`.
