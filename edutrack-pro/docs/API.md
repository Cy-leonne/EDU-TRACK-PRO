# API

Base path **`/api/v1`**. Interactive Swagger/OpenAPI UI at **`/api/v1/docs`** (JSON at `/api/v1/docs-json`).
`API_PUBLIC_URL` controls the server shown in Swagger; `EMBED_ALLOWED_ORIGINS` (empty in production)
controls whether the docs page may be framed.

## 1. Conventions

* **Success envelope** — JSON responses are `{ "success": true, "data": …, "meta"?: … }`.
  List endpoints often return a bare array inside `data`; paginated ones return `{ items, total, page, pageSize }`.
* **File downloads are the exception** — the four CSV exports are declared `@RawResponse()` and return
  `text/csv` with a UTF-8 BOM and CRLF line endings, so Excel opens them correctly on Windows. Do not
  wrap them in `JSON.parse`.
* **Errors** are uniform: `{ "success": false, "statusCode": 400, "code": "VALIDATION_FAILED", "message": "…", "details": [...] }`.
  Codes used by the API: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `BUSINESS_RULE_VIOLATION`, `RATE_LIMITED`, `FILE_TYPE_REJECTED`, `FILE_TOO_LARGE`,
  `STORAGE_ERROR`, `FEATURE_NOT_CONFIGURED`.
* **IDs** are cuids; **dates** are ISO-8601; **dates-only** fields (`assessmentDate`, `dueDate`) are
  `YYYY-MM-DD` in the school's timezone (`Africa/Nairobi` by default).
* **Pagination** — `?page=1&pageSize=25` (max 200). Blank-string query parameters are rejected with
  400 rather than treated as absent, which catches form bugs early.

## 2. Authentication

| Step | Endpoint | Notes |
| --- | --- | --- |
| Sign in | `POST /auth/login` | `{ email, password, clientType? }` → access + refresh tokens, user with `permissions` |
| Refresh | `POST /auth/refresh` | rotates the refresh token; replay of an old token revokes the session |
| Sign out | `POST /auth/logout` | revokes the presented refresh token |
| Who am I | `GET /auth/me` | user, membership, school profile, permissions |
| Change password | `POST /auth/change-password` | required after a temporary password is issued; clears `mustChangePassword` |
| Forgot password | `POST /auth/forgot-password` | always answers 200; issues a single-use, time-limited token |
| Reset password | `POST /auth/reset-password` | consumes the token, revokes existing sessions |
| First admin | `POST /auth/setup/first-admin` | only when `INITIAL_ADMIN_SETUP_TOKEN` is set; disabled otherwise |

* Access tokens are short-lived (`ACCESS_TOKEN_TTL`, default 15m) JWTs.
* Refresh tokens are stored **hashed** in `RefreshToken`, bound to a client type, rotated on every use.
* Browsers receive the refresh token in an `HttpOnly` `SameSite=Lax` cookie
  (`Secure` when `COOKIE_SECURE=true`); the mobile app stores it in the platform keychain.
* Auth endpoints are rate limited (`AUTH_RATE_LIMIT_MAX` attempts per `AUTH_RATE_LIMIT_WINDOW_MS` per
  IP); the global limiter is `GLOBAL_RATE_LIMIT_MAX` per window.

## 3. Endpoint groups

| Group | Examples | Who |
| --- | --- | --- |
| **School** | `GET/PATCH /school/profile`, `…/academic-years`, `…/terms`, `…/terms/:id/results-publication`, `…/categories`, `…/achievement-levels`, `/school/periods` (bell schedule) | admin writes; staff reads |
| **People** | `/teachers`, `/parents`, `/learners`, `/parent-links`, `/parent-links/:id/verify`, `/learners/:id/guardians`, `POST /learners/import`, `POST /teachers/import` | admin; teachers read learners in their classes |
| **Classes** | `/classes`, `/classes/:id/learners`, `/enrollments`, `/classes/validation/enrollments` | admin; teachers read |
| **Learning areas** | `/learning-areas`, `/strands`, `/sub-strands`, `/learning-areas/requirements`, `/teacher-assignments`, `/teacher-assignments/availability/:teacherId`, `/teacher-assignments/coverage` | admin |
| **Assessment** | `POST /assessments`, `GET|POST /results/grid/:assessmentId`, `POST /results/feedback`, `POST /assessments/:id/status`, `POST /assessments/:id/publish`, `PATCH /results/:id/amend`, `GET /results/:id/history`, `GET /results/learner/:learnerId[/progress]`, `/rubrics` | teachers own their assessments; admins can see all |
| **Learning resources / assignments** | `/resources`, `/resources/assignments`, `/submissions`, `/submissions/summary/:assignmentId` | teachers create; guardians see their linked learners' class only |
| **Files** | `POST /files/upload` (multipart), `GET /files/:id/authorize`, `GET /files/:id/download` | upload purpose is validated; downloads are time-limited and authorised per request |
| **Timetable** | `POST /timetables/generate`, `/periods` (+`/periods/default`), `POST /timetables/entries/move`, `POST /timetables/entries/:id/lock`, `POST /timetables/:versionId/validate` (note: validation is on the version path), `POST /timetables/publish`, `POST /timetables/versions/:versionId/unpublish`, `/duplicate`, `GET /timetables/versions/:versionId`, `/school-grid`, `/me`, `/learners/:learnerId`, `/preflight`, `/conflicts` | admin writes and publishes; teachers/guardians read |
| **Dashboards** | `/dashboards/admin`, `/dashboards/teacher`, `/dashboards/parent?learnerId=`, `/assessments/dashboard` | each role sees its own |
| **Reports** | `/reports/school`, `GET /reports/export/{learners,teachers,results,timetable}.csv` | admin |
| **Audit** | `/audit-logs`, `/audit-logs/actions` | admin |
| **Notifications** | `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`, `/notifications/preferences` | the signed-in user's own inbox |
| **Health** | `/health`, `/health/ready` | public, no tenant data |

## 4. Authorisation rules that callers must know

* Every school-owned row is filtered by the caller's `schoolId`. Cross-school IDs return **403**, not
  404, because ownership of the record is verified before existence is revealed — both are denials and
  neither leaks data.
* A teacher may read and write assessments **they created** or **teach the class for**; admins can read
  all assessments in the school; guardians can never see drafts.
* A guardian reading results, hand-ins, resources or timetable for a learner must have a **verified**
  `ParentLearnerLink` with the relevant capability (`canViewResults` / `canViewResources`).
* Published timetables are immutable: moving an entry on a published version returns
  `400 BUSINESS_RULE_VIOLATION` ("A published timetable is read-only"). New work happens on a
  duplicate, and publishing supersedes the previous version.
* Only administrators hold `timetable:publish`; teacher and parent publish attempts return 403.

## 5. Worked example

```bash
# 1. sign in
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"teacher@nhjs.demo","password":"Teacher-EduTrack-2026!demo"}' | jq '.data.accessToken'

# 2. today's timetable (teacher)
curl -s http://localhost:4000/api/v1/timetables/me -H "Authorization: Bearer $TOKEN" | jq '.data.lessons[0]'

# 3. enter marks as a draft (teacher owns the assessment)
curl -s -X POST http://localhost:4000/api/v1/results/grid/$ASSESSMENT_ID \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"saveAsDraft":true,"results":[{"learnerId":"…","numericScore":14,"isAbsent":false}]}'

# 4. publish (creates guardian notifications)
curl -s -X POST http://localhost:4000/api/v1/assessments/$ASSESSMENT_ID/publish \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"notifyParents":true}'
```

Uploads use `multipart/form-data` on `POST /files/upload?purpose=ASSESSMENT|SUBMISSION|RESOURCE|LOGO|IMPORT|GENERAL`.
The server ignores the client-declared extension for trust decisions: it sniffs the file signature and
MIME, then stores with a server-generated key.
