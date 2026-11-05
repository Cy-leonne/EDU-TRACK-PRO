# Architecture

## 1. Repository layout

```
edutrack-pro/
├── apps/
│   ├── api/            NestJS modular monolith, REST under /api/v1, Swagger at /api/v1/docs
│   ├── web/            Next.js 14 (App Router) + TypeScript + Tailwind — admin, teacher, parent UI
│   └── mobile/         Expo / React Native (Android + iOS) — teacher and guardian companion app
├── packages/
│   ├── shared-config/  roles, permissions, defaults (timezone, bell times), upload policy, design tokens
│   ├── shared-types/   every API DTO consumed by web, mobile and tests (single source of truth)
│   └── validation/     Zod schemas shared by the API pipes and both clients
├── prisma/             schema.prisma, two migrations, deterministic seed
├── scripts/            bootstrap-dev.sh, create-admin.ts, dev-db-up.sh, init-test-db.sql
├── tests/              black-box smoke suite that runs against a live API (see tests/README.md)
├── docs/               this documentation set
└── scratch/            operator verification scripts used during development (not shipped code)
```

`apps/api`, `apps/web` and `packages/*` are npm workspaces rooted at `edutrack-pro`. `apps/mobile`
deliberately keeps **its own** `node_modules`: React Native must be transformed by the babel config in
the app directory, so hoisting it above `apps/mobile` breaks bundling. Install it with
`npm run mobile:install` (see [MOBILE.md](MOBILE.md)).

## 2. API shape

* **Modular monolith.** `apps/api/src/modules/*` — `auth`, `school`, `people`, `classes`,
  `learning-areas`, `assignments`, `assessments` (which owns results, rubrics, feedback),
  `timetables`, `resources`, `submissions`, `files`, `dashboards`, `reports`, `audit`, `health`.
  Each module owns its controller, service and DTOs; modules call each other through services, never
  through HTTP.
* **Cross-cutting concerns** live in `apps/api/src/common`:

  | Folder | Responsibility |
  | --- | --- |
  | `config` | environment loading + validation (fails fast on missing secrets) |
  | `guards` | JWT auth guard, permissions guard (`@RequirePermissions`), tenancy resolution |
  | `decorators` | `@CurrentUser`, `@RequirePermissions`, `@RawResponse` |
  | `interceptors` | uniform `{ success, data }` envelope (skipped for `@RawResponse` CSV streams), request logging |
  | `errors` | problem-style exception filter: every error leaves as `{ statusCode, code, message, details? }` |
  | `pipes` | Zod validation pipe (schemas from `@edutrack/validation`) |
  | `tenancy` | the single place that resolves "may this user touch this school/class/learner?" |
  | `audit` | append-only audit writer |
  | `notifications` | in-app notification creation + optional email fan-out |
  | `storage` | local-disk (dev) / S3-compatible (prod) drivers behind one interface |
  | `csv` | hardened CSV parse/serialise helpers (formula-injection neutralised on export) |
  | `prisma` | `PrismaService` with connection lifecycle + transaction helper |

* **Request lifecycle:** request → helmet → CORS allow-list → rate limiter → JWT guard → tenant
  resolution → permission guard → Zod pipe → controller → service (transactional where it writes) →
  response interceptor (envelope) → audit + notification side-effects.

## 3. Web app

* Next.js **App Router** with two shells: `src/app/(app)/*` (signed-in workspace) and the public
  `/login` page. The API is reached through a rewrite in `next.config.mjs`, so the browser only ever
  talks to its own origin (`/api/v1/*`) — no CORS in the browser, no tokens in localStorage URLs.
* `src/lib/api.ts` is the single fetch layer: unwraps the envelope, refreshes once on 401 and replays,
  and exposes `download` / `objectUrl` / `upload` helpers for private files.
* Session state (`src/lib/session.tsx`) keeps the access token in memory and the refresh token in a
  cookie set by the API; the signed-in user is re-fetched on load rather than trusted from storage.
* The guardian's selected child is a UI concern (`family.tsx`), so every family screen follows the
  same child switcher; authorisation is still re-checked server-side on every request.
* Screens are role-aware: the same shell renders admin, teacher or parent navigation from
  `src/lib/nav.ts` using the permission list returned at sign-in.

## 4. Mobile app

Expo app with the same API client contract as web (envelope unwrapping, refresh-and-replay, private
upload helper), tokens in the platform keychain, and role-based screens: teacher (today's lessons,
workload, assessments) and guardian (children, published results, timetable, hand-in from camera or
file, notifications). Bundles for both Android and iOS are produced by `expo export`; EAS profiles are
in `eas.json`. See [MOBILE.md](MOBILE.md).

## 5. Key design decisions

1. **Learners never log in.** A learner is a record owned by a school; a guardian signs in and is
   linked to learners through a verified `ParentLearnerLink`. Anything a guardian can read is
   filtered by that link, and an unverified link exposes nothing.
2. **The API is the only authority.** The web and mobile clients hide actions they know will fail
   (`canEdit`, `canPublish`, permissions), but every rule is enforced server-side.
3. **School-configurable everywhere it matters.** Categories, achievement bands, bell times, working
   days, marks-vs-rubric, and the marking period all come from school records — not from constants.
4. **Records are append-only where trust matters.** Published results are corrected through an amend
   path that stores a reason and a change log; the audit log is written for every privileged action.
5. **Sharing one type and validation vocabulary** across API, web, mobile and tests removes the class
   of bug where a client guesses a field name (the shared packages are compiled and imported, not
   copy-pasted).
6. **Deterministic generation.** The timetable engine is a constraint solver, not a randomiser: the
   same inputs produce the same schedule, and an infeasible request returns diagnostics instead of a
   broken timetable.
