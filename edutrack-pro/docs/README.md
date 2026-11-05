# EduTrack Pro — documentation

EduTrack Pro is a school records platform for Kenyan **junior schools (Grades 7–9)**. It covers
school administration, competency-based assessment recording, learning resources, hand-ins, and a
constraint-based timetable engine. This folder is the written handover: read it in the order below.

| Document | Read it when you need to… |
| --- | --- |
| [IMPLEMENTATION_AND_DEPLOYMENT.md](IMPLEMENTATION_AND_DEPLOYMENT.md) | get the app running, run every verification gate, or deploy it — commands only, start here |
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the monorepo, module layout, request lifecycle and design decisions |
| [DATABASE.md](DATABASE.md) | see every model, its relationships, indexes, soft-delete and tenant rules |
| [API.md](API.md) | call the REST API: auth, envelope, errors, pagination, endpoint groups |
| [ASSESSMENT_WORKFLOW.md](ASSESSMENT_WORKFLOW.md) | follow a mark from entry → review → publication → correction, and what guardians may see |
| [TIMETABLE_ENGINE.md](TIMETABLE_ENGINE.md) | run, read and repair timetable generation; hard vs soft constraints and diagnostics |
| [SECURITY.md](SECURITY.md) | review hashing, tokens, RBAC, tenant isolation, uploads, logging and what is still open |
| [DEPLOYMENT.md](DEPLOYMENT.md) | install, configure, migrate, seed, run behind TLS, back up, scale |
| [EMAIL_SETUP.md](EMAIL_SETUP.md) | switch email notifications from the console stub to a real provider |
| [MOBILE.md](MOBILE.md) | run the Expo app on Android/iOS and cut release builds |
| [REDESIGN_AND_AUTH_REPORT.md](REDESIGN_AND_AUTH_REPORT.md) | see the outcome of the redesign, real-authentication and production-readiness phase: what changed, what is verified, what is left |
| [TESTING.md](TESTING.md) | run and extend the unit, integration and end-to-end suites |
| [FEATURES_AND_LIMITATIONS.md](FEATURES_AND_LIMITATIONS.md) | see exactly what is finished, what is configuration-only, and what is not built |

**Scope discipline that shaped this codebase:** learners are *records*, not users — only three roles
can sign in (**Admin, Teacher, Parent**). The school's own assessment categories and achievement bands
are configurable school data; nothing in the product encodes official national grading, and nothing
claims to be a national result.
