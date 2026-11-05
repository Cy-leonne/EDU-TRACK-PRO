# Testing

## 1. What was run, and what it produced

All figures below are from this repository, on a machine with PostgreSQL 17 running locally.

| Suite | Command | Result |
| --- | --- | --- |
| API unit + integration + E2E | `npm run test` | **15 suites, 173 tests, all passing** |
| — unit (6 suites) | `npm run test -w @edutrack/api -- --testPathPatterns=unit` | 62 tests: validation, permissions, password hashing, scheduling, conflict detection, timetable generation/validation, calendar rules, file validation |
| — integration (8 suites) | `… --testPathPatterns=integration` | 101 tests: auth & school isolation (10), **auth registration & invitations (25)**, people & enrolment (11), assessments & results (13), files (10), submissions (13), notification preferences (9), exports (10) |
| — end-to-end journeys | `… --testPathPatterns=e2e` | `journeys.spec.ts` — **10/10 journeys** (see §3) |
| Browser E2E (Playwright) | `npm run test:e2e:web` | **47 tests passing** — a production `next build` served on :4100 against the API on :4101 and a dedicated `*_test` database (see §3a) |
| Black-box smoke suite | `node tests/smoke/smoke.mjs` | **30 checks passing** against the running API (three roles, tenant scoping, refusals) |
| Operator verification script | `python3 scratch/verify.py` | 36 checks passing (endpoint shapes for admin/teacher/parent + security denials) |
| Screen contract script | `python3 scratch/verify_screens.py` | **41/41 screen contracts** — each web screen's API calls answered with the expected shape |
| Web production build | `npm run -w @edutrack/web build` | succeeds — **35 routes** compiled (static or dynamic) |
| Web typecheck | `npm run -w @edutrack/web typecheck` | clean |
| API typecheck | `npm run -w @edutrack/api typecheck` | clean |
| Mobile typecheck | `npm run mobile:typecheck` | clean |
| Mobile bundles | `cd apps/mobile && npx expo export --platform android` / `--platform ios` | both succeed (Hermes bundles, ~1.8 MB, 569 modules) |
| Web routes | dev server + `curl` on every app route | every route returns HTTP 200 (sign-in, dashboards, people incl. invitations, academics, timetable, settings, teaching, family, account) |

Nothing in this document is aspirational: anything not run is listed in
[FEATURES_AND_LIMITATIONS.md](FEATURES_AND_LIMITATIONS.md) as unverified.

## 2. Test layout

```
apps/api/test/
├── unit/             pure functions and rules — no database, milliseconds
│   ├── validation.spec.ts          shared Zod schemas (marks, rubric, dates, phone, colours)
│   ├── permissions.spec.ts         the 3-role permission matrix (ADMIN 36 / TEACHER 18 / PARENT 9)
│   ├── publication-rules.spec.ts   what may be published, by whom, and when
│   ├── scheduling.spec.ts          constraint solving: hard vs soft constraints
│   ├── conflict-detection.spec.ts  double-booking, availability, break/lunch, workload
│   ├── calendar.spec.ts            term/year rules, locked years, school-day maths
│   ├── timetable-generator.spec.ts constraint solver outcomes
│   ├── timetable-validator.spec.ts conflict reporting rules
│   ├── password.service.spec.ts    argon2id hashing, verification, fail-closed parsing
│   └── file-validation.spec.ts     signature sniffing, allow-list, size, name sanitising
├── integration/      real HTTP through the Nest app + a real test database
│   ├── auth-and-isolation.spec.ts  login, refresh rotation, cross-school denial
│   ├── auth-registration.spec.ts   school onboarding, invitations, parent linking, resets, enumeration
│   ├── people-and-enrollment.spec.ts
│   ├── assessments-results.spec.ts drafts, publish, amend, guardian visibility
│   ├── files.spec.ts               upload, purpose rules, authorised download
│   ├── submissions.spec.ts         hand-in, review, notifications, audit
│   ├── notification-preferences.spec.ts
│   └── exports.spec.ts             CSV headers, no-envelope, injection neutralising
├── e2e/journeys.spec.ts            the ten product journeys, one school, sequential
└── support/                        test app factory, database reset, fixtures, HTTP helpers
tests/smoke/smoke.mjs               read-only black-box suite for any environment
```

Integration and E2E tests run against a **dedicated database** (`TEST_DATABASE_URL`); `test/support/harness.ts`
resets it before the journey suite so results are reproducible. Never point `TEST_DATABASE_URL` at
production.

## 3. End-to-end journeys (all passing)

1. **Admin sets up the school** — profile, timezone `Africa/Nairobi`, working days, bell times with a
   break and lunch, academic year and current term.
2. **Admin creates a teacher** — temporary password returned once, `mustChangePassword` on first sign-in.
3. **Admin registers learners and a class** — CSV dry-run then import, grade and class resolution, then a
   guardian account created and its learner link **verified**.
4. **Admin creates a learning area, teacher assignment and the weekly lesson requirement.**
5. **Admin configures the period grid** — no teaching in break/lunch slots.
6. **Admin generates → validates → adjusts → publishes a timetable**, then proves the published version
   is read-only (move returns 400) and that teachers/parents cannot publish.
7. **Teacher** sees their timetable, creates an assessment, attaches a PDF and a PNG (and a fake PDF is
   rejected by signature sniffing), enters marks, publishes results, then amends one result with a reason.
8. **Guardian** sees only published results and the published timetable for their verified child; a draft
   assessment is invisible.
9. **Cross-school access is refused** — a second school's admin gets 403/404 on the first school's
   learners, results, files and timetables.
10. **Audit and log hygiene** — publication, amendment and timetable actions appear in the audit log, and
    no response or log line leaks credentials or learner identifiers.

## 3a. Browser suite (Playwright)

```
apps/web/e2e/
├── playwright.config.ts   builds and serves the web app on :4100, API on :4101, 1 worker
├── global-setup.mjs       refuses any database whose URL does not end in _test, migrates, seeds
├── seed.mjs               creates one school per run through the real API (invitation → activation,
│                          self-registered guardian with one verified and one unverified link,
│                          learners, class, bell schedule, weekly requirements, published results)
├── helpers.ts             signIn (clears localStorage + cookies), apiClient, fixtures
├── auth.spec.ts           11  sign-in/out with server-side revocation, role routing, tampered session,
│                              reset link single-use, forgotten-password parity, registration validation
├── workflows.spec.ts       7  create/persist/edit learner, class, learning area; invitations screen →
│                              activation → sign-in; results entry → publish → guardian vs stranger;
│                              guardian switching with an unverified link; timetable generate → validate
│                              → publish → history; upload + anonymous download refusal; profile & notification
├── privacy.spec.ts         7  other family, teacher scope, guardian cannot modify, unauthenticated denial,
│                              id tampering, guessed file URLs, second-school isolation, no rogue admin
├── ui.spec.ts              8  sidebar, top-bar search, table search + destructive confirmation, modal
│                              validation, verification queue, learner switching, notifications, sign-out
└── responsive.spec.ts     14  390 / 834 / 1440 px overflow checks, accessible names, keyboard tabbing,
                               status-not-by-colour, reduced motion, contrast
```

```bash
npm run e2e:install      # one-off: chromium + its system libraries
npm run test:e2e:web     # = npm --prefix apps/web run e2e
```

The suite never touches development or production data: it starts its own API with `DATABASE_URL`
pointing at `edutrack_pro_test`, seeds through the API, and the web server is a production build
(`next build && next start`). Failures are fixed in the product code where the product was wrong; only
real assumption drift is corrected in a spec.

## 4. Writing more tests

* **Unit** — add a `*.spec.ts` under `test/unit`; import rules from `src` and shared schemas from
  `@edutrack/validation`. Keep them database-free.
* **Integration** — copy the pattern in `test/integration/files.spec.ts`: `createTestApp()` from
  `test/support/harness.ts`, `resetDatabase(prisma)`, then `http(app)` helpers (`get`, `post`, `patch`,
  `del`, `upload`). Remember CSV/raw routes come back as text.
* **E2E** — extend `journeys.spec.ts` only for a genuinely new journey; it is ordered and shares state.
* **Black-box** — add a check to `tests/smoke/smoke.mjs` when you want a quick "is this deployment
  healthy" signal; it must stay read-only.

## 5. Reporting rule

If a suite fails, the failure is reported with the command, the suite, the failing test names and the
underlying cause — never summarised as "tests pass". Several real bugs were found this way during
development (a lost upload purpose field, a notification type that accepted unknown values, JSON-wrapped
CSV exports, a results-export column that implied a national band) and each was fixed rather than
worked around.
