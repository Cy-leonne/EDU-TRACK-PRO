# Security

## 1. Passwords and sessions

| Control | Implementation |
| --- | --- |
| Hashing | Argon2id (memory-hard parameters) with bcrypt retained only to verify pre-existing hashes |
| Temporary passwords | generated per-user on creation/import/reset, returned once, flagged `mustChangePassword`, never stored in plain text |
| Access tokens | short-lived JWTs (`ACCESS_TOKEN_TTL`, default 15m) signed with `JWT_ACCESS_SECRET` |
| Refresh tokens | random opaque tokens stored **hashed**, rotated on every refresh, bound to a client type and revoked on logout, password change/reset, or replay detection |
| Cookies (web) | refresh cookie is `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`; access token stays in memory |
| Mobile | refresh token in the platform keychain (SecureStore), never in AsyncStorage |
| Rate limiting | 10 auth attempts / 15 min / IP by default (`AUTH_RATE_LIMIT_*`), 600 req / window globally |
| Password policy | minimum length + complexity enforced by `passwordSchema` shared with both clients |
| Password reset | single-use token, short expiry, hashed at rest; resetting revokes all existing sessions; `forgot-password` always answers 200 so it cannot be used to enumerate accounts |
| Initial admin | `POST /auth/setup/first-admin` works only while `INITIAL_ADMIN_SETUP_TOKEN` is set — **leave it blank after bootstrap** (default) so the endpoint is disabled |

**Assessment numbers are never an authentication factor.** A guardian authenticates with a password and
is linked to learners by a school user; the assessment number is a school record only. This was an
explicit product requirement and is enforced by the absence of any such auth path.

## 2. Authorisation

* **Three roles only**: `ADMIN` (36 permissions), `TEACHER` (18), `PARENT` (9). Permissions are declared
  in `packages/shared-config` and enforced by a guard on every non-public route
  (`@RequirePermissions('…')`); the client receives the same permission list so it can hide actions it
  would be refused.
* **Tenant isolation** — `src/common/tenancy` resolves and checks ownership for the school, class,
  learner, assessment, resource, file and timetable objects. Every query is scoped by `schoolId`.
* **No IDOR** — object access always goes through the tenancy check; guessed identifiers from another
  school return 403. The integration suite (`auth-and-isolation.spec.ts`) and E2E journey 9 cover
  cross-school denial on results, files, timetables and learners.
* **Guardian rules** — unverified links expose nothing; `canViewResults` / `canViewResources` are
  per-link flags; revoking a link is the withdrawal path. A guardian never sees drafts.
* **Published artefacts are immutable** — published results change only through the amend path (with a
  reason and a change log); published timetables are read-only; only admins can publish a timetable.

## 3. Files

* Uploads are validated by **content**, not extension: file signature + MIME sniffing (`file-type`),
  an allow-list of types (PDF, JPEG, PNG, WebP, Office/CSV/TXT where appropriate), and a size ceiling
  (`MAX_UPLOAD_MB`, default 15 MB). A renamed file is rejected — asserted in E2E journey 7.
* Storage keys are server-generated (`{schoolId}/{purpose}/{yyyy}/{mm}/{uuid}.{ext}`) so a client can
  never choose a path.
* Files are **private**: no public URLs, no predictable paths. Download requires
  `GET /files/:id/authorize` and returns a short-lived (`SIGNED_URL_TTL_SECONDS`, default 300s),
  single-purpose link; the authorisation check re-evaluates the caller's relationship to the file
  (uploader, class teacher, assignment creator, guardian of the learner…).
* Storage driver is pluggable: local disk for development, S3-compatible object storage for
  production. The S3 driver signs requests and never exposes bucket credentials to clients.

## 4. Data handling and logging

* Request logging omits passwords, tokens, cookies, national ID/TSC numbers, and assessment numbers;
  the E2E suite asserts that a login response body and the logs contain no secret material.
* Error responses never include stack traces in production; internal identifiers are logged server-side
  only.
* CSV exports neutralise spreadsheet formula injection (`=`, `+`, `-`, `@`, tab prefixes) and are
  row-capped.
* Audit log records actor, action, entity, timestamp and before/after summaries for privileged actions.
* The seed contains only synthetic data; no real learner data is present in the repository.

## 5. Transport and deployment hardening

* Helmet security headers; CORS restricted to `CORS_ORIGINS`; framing refused unless
  `EMBED_ALLOWED_ORIGINS` explicitly allows it (empty by default).
* Run behind TLS (reverse proxy or load balancer) and set `COOKIE_SECURE=true`; the refresh cookie then
  requires HTTPS and the API refuses insecure cookie transport.
* Secrets live in environment variables only (`.env` is git-ignored; `.env.example` documents every
  key). Startup validation fails fast when a required secret is missing or still set to `CHANGE_ME`.
* Database credentials should be least-privilege (no superuser) and network-restricted to the app.

## 6. Known gaps / next steps

1. **Email delivery is not configured out of the box** (`EMAIL_PROVIDER=console`). In-app notifications
   work; email requires a provider — see [EMAIL_SETUP.md](EMAIL_SETUP.md).
2. **Production object storage is not provisioned** — the S3 driver is implemented and configured by
   environment variables, but no bucket/credentials ship with this repository.
3. **No 2FA/MFA** for administrator accounts yet; recommended before wide deployment.
4. **No Redis-backed queue** in the default configuration: long timetable generations run inline
   (`QUEUE_ENABLED=false`); enable Redis for large schools, or generation may hold a request open.
5. **No automated backup/restore script** — use `pg_dump` on a schedule (see DEPLOYMENT.md).
6. **Dependency scanning and a WAF/CDN** are deployment responsibilities, not implemented here.
7. **Multi-tenant admin of tenants** (a super-admin role) is deliberately out of scope: the first
   iteration has exactly three roles.
