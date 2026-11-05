# Redesign, real authentication and production-readiness — final report

Scope of this phase: a navy design-system pass, real account lifecycle (registration, invitations,
activation, sessions, recovery), removal of every demo-credential surface, a performance/reliability
pass, and deployment readiness — applied to the existing EduTrack Pro application without rewriting it
or changing business rules (assessment calculations, CBE reporting, timetable constraints and
authorisation relationships are untouched).

Every figure below was produced by running the command in this workspace. Failures that were found are
reported with their cause; nothing is marked complete because a screen merely exists.

---

## 1. Visual changes

* **One navy token system.** `globals.css` defines `--navy-*`, `--royal`, `--bright`, `--teal`,
  `--amber`, `--coral`, `--mist`, border/ink/canvas ramps, radii, shadows, focus ring and motion
  durations; `tailwind.config.ts` re-points `slate`/`rose`/`amber`/`teal` onto those tokens and adds
  `navy`, `royal`, `bright`, `brand`, `accent`, `surface`, `ink`, `line` plus status tokens. Screens
  consume tokens and utility classes (`panel-navy`, `hero-gradient`, `stat-tile`, `surface*`,
  `table-shell`, `skeleton-shimmer`, `progress-fill`) instead of scattered hex values.
* **Deep-navy chrome, light blue-grey workspace.** Sidebar, top bar, hero panels and summary tiles are
  navy; the working canvas is a tinted blue-grey so no screen is plain-white-dominant. Gradients are
  limited to the sign-in/hero/summary surfaces.
* **Auth pages.** Navy gradient split layout, product branding, email identifier, password show/hide,
  "forgotten your password" link, inline field errors, loading states, role-appropriate registration
  links, and **no demo-account panel or quick-fill buttons anywhere**.
* **Three dashboards.** Admin (counts, assessment completion, timetable status, setup warnings,
  activity), teacher (today's lessons, workload, pending marking), guardian (learner switcher with a
  verified/awaiting-verification state, per-child hero, published results, progress bars, assignments,
  resources).
* **Management screens.** Consistent toolbar (search, filters, sort, pagination), table shell with
  skeleton/empty/error states, status badges that carry a dot **and** the label, action menus, and
  confirmation dialogs for destructive actions on learners, classes, teachers, invitations, resources
  and timetable versions.
* **New screen:** `/people/invitations` (admin) — invite a teacher, administrator or guardian, see
  pending invitations with expiry, copy the single-use link once, revoke with confirmation.
* **Type & motion.** Inter with a consistent scale (tabular numerals for marks); motion is limited to
  120–180 ms transitions, honours `prefers-reduced-motion`, and never delays navigation.
* **Accessibility.** Skip link and `#main-content` target, focus-visible ring on every control,
  labelled form controls (including the top-bar search and account menu), keyboard tabbing, status
  never conveyed by colour alone, and no horizontal document scroll at 390 px.

## 2. Which registration and authentication flows work

| Flow | Status | Evidence |
| --- | --- | --- |
| School self-onboarding (atomic: school + calendar + Grades 7–9 + default categories/bands) | Working | `POST /auth/register/school` returns 201; integration suite `auth-registration.spec.ts`; E2E school-isolation test |
| First-administrator provisioning | Working, protected | Token-gated `POST /auth/setup/first-admin`; 401 on a wrong token, 400 when no token is configured, 409 once a school exists unless self-registration is enabled; CLI `npm run setup:admin` |
| Unauthenticated administrator/teacher creation | Refused | Privacy spec asserts no rogue admin can be created; invitations are the only staff path |
| Teacher onboarding | Invitation → activation only | New admin screen + E2E test: invite from the office screen, read the one-time link, activate, sign in as TEACHER, invitation leaves the pending list |
| Parent self-registration | Working with verified linkage | School code registration, then `POST /auth/parent/link-request` (assessment number **plus** surname), admin verification; an unverified link exposes no record |
| Multiple children per guardian | Working | One verified and one unverified link for the same guardian in the fixtures; switcher shows both, records only for the verified child |
| Sign-in / sign-out / revocation | Working | Access + rotating refresh tokens, sign-out revokes server-side, "sign out everywhere" (`POST /auth/logout-all`) on the account screen |
| Expiry / tampered session | Working | A refused stored session redirects to `/login?reason=expired` with a clear message (E2E) |
| Password recovery | Working | Identical response for known and unknown addresses, single-use 1-hour token, revokes refresh tokens (E2E) |
| Password change / activation / deactivation | Working | `/auth/password/change`, `POST /auth/accounts/:userId/status`, admin-triggered reset links |
| Rate limiting / enumeration / brute force | Working | Auth and global limiters; sign-in never reveals whether an address exists; enumeration parity asserted twice in E2E |
| Backend-enforced role routing | Working | Permission guards on every route; a teacher/guardian calling `/audit-logs` or `/parents` is refused with a clear message and the screen states the refusal |

## 3. Demo credentials removed from production-facing assets

* The web application source contains **no** demo accounts, no demo panel and no quick-fill buttons;
  the production build was searched and contains no `@nhjs.demo` address or demo password.
* The development seed remains, but is **development-only**: `npm run db:seed` now refuses to run when
  `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is set deliberately, and the seed generates
  random passwords when `SEED_*_PASSWORD` is not supplied instead of using known values.
* Demo logins still referenced in local tooling only (documented dev seed, `tests/smoke/smoke.mjs`
  defaults, `scratch/` drivers) — no served asset, page or bundle.
* Production installs create their first administrator through the token-gated endpoint or
  `npm run setup:admin`; there is no automatic demo provisioning.

## 4. Performance and reliability improvements

* `useApiQuery` memoises the query object, cancels obsolete requests and treats `AbortError` as a
  non-error; this removed the stuck skeletons and the 429 storms on the dashboards.
* One request per screen where the data is shared (guardian dashboard now separates the always-loaded
  learner list from the selected child's detail, so switching learners no longer refetches the list or
  breaks the panel when a link is unverified).
* Server-side pagination, filters and search (debounced 300 ms) on the management tables; explicit
  `pageSize` on reference data.
* Skeletons rather than spinners-on-blank; buttons disable and show pending state while a mutation is
  in flight, which prevents duplicate submissions.
* Backend: indexed tenant-scoped queries, `select`-limited includes, single transaction for school
  onboarding, upload validated before persistence, centralised error envelope with `requestId`,
  structured logs free of secrets and learner data, `/health` plus readiness.
* No Redis or extra service was introduced; the optional queue stays off.

## 5. Automated tests — passed / failed

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript (API, web, mobile, E2E specs) | `npm run typecheck` | clean |
| API unit + integration + E2E | `npm run test` | **15 suites / 173 tests passing, 0 failing** |
| Browser E2E (Playwright, production build) | `npm run test:e2e:web` | **47 tests passing, 0 failing** (last run 10) |
| Black-box smoke | `node tests/smoke/smoke.mjs` | **30/30** |
| Screen contracts | `python3 scratch/verify_screens.py` | **41/41** |
| Web production build | `next build` | exit 0, 35 routes |
| API production build | `nest build` | exit 0 |

Failures found and **fixed** during this phase (not merely reported):

1. Build-time rewrite broke every signed-in flow (Next `rewrites()` baked the API URL at build time) —
   replaced with a runtime proxy route; ~30 failing tests went green.
2. Leftover sessions in `localStorage` bounced `/login` straight to the previous user's home — the
   harness now clears storage and cookies; the layout also gained the `?reason=expired` state.
3. React error #31 crash in the results grid — the API returns an achievement-level **object** and the
   grid rendered it as a leaf (`{row.achievementLevel}` → `{row.achievementLevel?.label}`).
4. Guardian dashboard broke completely when a child's link was unverified — the API (correctly) refuses
   the detail call, so the page now keeps the switcher and shows the verification notice instead of an
   error screen, and never shows one child's records while another is selected.
5. Phone-width horizontal overflow (654 px document in a 390 px viewport) on the timetable workspace —
   implicit grid tracks are now pinned to `minmax(0, 1fr)`.
6. Spec-level assumption drift (endpoint shapes, status codes, empty-state copy, the doubled
   `/timetables/timetables/:id/history` route, `PATCH` vs `POST` for marking a notification read) —
   corrected in the specs after verifying the live contract.

## 6. Database-backed workflows verified end to end

Create, edit and persist (UI → API → database → UI) for learners, classes, learning areas and staff
invitations; assessment results entered in the grid, saved, published, then read back by the verified
guardian (and refused to an unrelated guardian); bell schedule + weekly requirements → timetable
generation → validation → publication → version history; resource/submission upload with authorised
retrieval and anonymous refusal; profile update and notification read persisted; parent-link
verification queue; audit entries for sensitive actions. All of it is asserted against the API after
the UI action, never against a UI message alone.

## 7. Production build

`npm run build` succeeds: `nest build` (API) and `next build` (web) both exit 0; the web build compiles
**35 routes** and the production bundle contains no demo credentials. The Playwright suite runs against
that production build (not `next dev`), so the tested artefact is the deployed artefact.

## 8. Deployment steps still blocked on unavailable credentials or services

* **No live deployment.** No host, domain or TLS certificate was provided, so nothing was deployed and
  no claim is made that the product is running anywhere but this workspace.
* **Email delivery.** `EMAIL_PROVIDER=console` here; a real provider needs `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASSWORD` (or an API-key provider) and a verified `EMAIL_FROM`.
* **Object storage.** Running the `local` driver; production needs `S3_ENDPOINT`, `S3_REGION`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and a private bucket policy.
* **Docker images.** `Dockerfile`s and `docker-compose.yml` exist but were not built in this sandbox;
  build them once on the target with `docker compose build`.
* **Mobile release.** Android/iOS bundles build, but store signing identities and EAS credentials are
  missing, so no binary was published.
* **Secrets.** `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` must be generated per environment
  (`openssl rand -base64 48`); `INITIAL_ADMIN_SETUP_TOKEN` must be removed after the first admin exists.

Command-by-command instructions for all of the above are in
[IMPLEMENTATION_AND_DEPLOYMENT.md](IMPLEMENTATION_AND_DEPLOYMENT.md).
