# Database

PostgreSQL + Prisma. **48 models**, **19 enums**, **95 indexes and unique constraints**.
Schema: `prisma/schema.prisma` · migrations: `prisma/migrations/*` · seed: `prisma/seed.ts`.

## 1. Conventions applied to every model

| Convention | How it shows up |
| --- | --- |
| Tenant isolation | every school-owned table carries `schoolId` with an index and a foreign key to `School`; the API *always* adds it to the `where` clause |
| Timestamps | `createdAt` / `updatedAt` (`@default(now())`, `@updatedAt`) |
| Soft delete | `deletedAt DateTime?` on people, learners, classes, learning areas, resources, assessments, files; reads filter `deletedAt: null` |
| Identifiers | `cuid()` text ids (never sequential integers, so nothing can be enumerated from a URL) |
| Uniques | natural keys are unique *per school* (e.g. `@@unique([schoolId, admissionNumber])`), never globally, because two schools legitimately reuse the same admission numbers |
| Audit trail | `AuditLog` (who/what/when/before/after) plus domain-specific change logs (`ResultChangeLog`, `AssessmentChangeLog`) |
| Money/percentages | `Decimal` where exactness matters (result scores) |

## 2. Model groups

**Tenancy and identity** — `School`, `User`, `SchoolMembership`, `RefreshToken`,
`PasswordResetToken`, `NotificationPreference`. A `User` is a login; a `SchoolMembership` is
that login's role *inside one school* (role, status, invited/joined timestamps). One person can hold
different roles in different schools without sharing a password — the role is resolved per
membership, not stored on the user.

**People** — `TeacherProfile` (staff number, TSC number, employment type, specialisation,
max periods per day/week, preferred free days), `ParentProfile` (relationship), `Learner`
(admission number, **assessment number**, gender, date of birth, boarding flag, `currentClassId`,
status).

**Learner ↔ guardian** — `ParentLearnerLink` with relationship, `isVerified`, `isPrimaryContact`,
`canViewResults`, `canViewResources`. **Unverified links expose nothing**, and rights are individually
revocable — that is the "withdraw access" path when a guardian's circumstances change.

**Calendar** — `AcademicYear` (with `isCurrent`, `isLocked`), `Term` (dates, `isCurrent`,
results-publication flag). A locked year or an unpublished term blocks the actions that depend on it.

**Academics** — `Grade` (levels 7–9), `Class` (grade + stream + class teacher + room,
capacity), `ClassEnrollment` (learner in a class for a year/term with status),
`LearningArea`, `Strand`, `SubStrand`, `StrandTeacher`, `ClassLearningAreaRequirement`
(periods per week for a class + learning area + term), `TeacherAssignment` (who teaches what, where),
`TeacherAvailability` (per weekday/period, available or not, reason).

**Assessment** — `AssessmentCategory` (school-defined: CAT, quiz, assignment, test, practical,
project, end-term, other — *not* a national classification), `AchievementLevel` (school-defined bands
with code, label, description, min/max), `Assessment` (class + learning area + strand/sub-strand +
category + strand of the syllabus + marks and/or rubric), `AssessmentResource` (private files and links
attached to an assessment), `AssessmentResult` (score, percent, band, absent/excused, comment,
status, publish/amend stamps), `ResultRubricScore`, `ResultFeedback` (narrative comments),
`ResultChangeLog` and `AssessmentChangeLog` (immutable trail of edits after publication).

**Learning and hand-ins** — `LearningResource` (note/file/link/announcement tied to class + learning
area), `Assignment`, `AssignmentSubmission` (learner, submitted-by user, submitter role, file,
note/link, status, late flag, score, feedback, return reason). Because the API records *who handed the
work in*, a guardian handing work to the school on a learner's behalf is auditable.

**Timetable** — `Room` (kind: classroom, lab, hall, library…), `TimetablePeriod` (year grid: day,
sequence, label, times, `isBreak`, `isLunch`, `isTeaching`), `Timetable` (term-level container),
`TimetableVersion` (draft → validated → published → superseded, with notes and stamps),
`TimetableEntry` (class + learning area + teacher + room + day/sequence, double-lesson and lock flags),
`TimetableConflict` (code, severity, message, affected entries, resolution hint, resolution stamp),
`TimetableGenerationJob` (inputs, status, statistics, diagnostics, messages).

**Platform** — `FileObject` (private storage key, MIME, size, visibility, purpose, uploader),
`Notification` (type, title, body, link, entity, read timestamp, email status), `AuditLog`,
`LearnerIntervention` (support/intervention notes for a learner).

## 3. Core relationships

```mermaid
erDiagram
  School ||--o{ SchoolMembership : has
  School ||--o{ Learner : has
  School ||--o{ Class : has
  User ||--o{ SchoolMembership : "belongs to"
  User ||--o| TeacherProfile : may_have
  User ||--o| ParentProfile : may_have
  SchoolMembership ||--o| TeacherProfile : profile
  SchoolMembership ||--o| ParentProfile : profile
  ParentProfile ||--o{ ParentLearnerLink : links
  Learner ||--o{ ParentLearnerLink : linked_by
  Grade ||--o{ Class : contains
  Class ||--o{ ClassEnrollment : enrols
  Learner ||--o{ ClassEnrollment : enrolled_in
  LearningArea ||--o{ Strand : has
  Strand ||--o{ SubStrand : has
  TeacherAssignment }o--|| TeacherProfile : teacher
  TeacherAssignment }o--|| Class : class
  TeacherAssignment }o--|| LearningArea : area
  Assessment }o--|| Class : for
  Assessment }o--|| LearningArea : in
  Assessment }o--|| AssessmentCategory : category
  Assessment ||--o{ AssessmentResult : produces
  Learner ||--o{ AssessmentResult : receives
  AssessmentResult ||--o{ ResultRubricScore : breaks_into
  AssessmentResult ||--o{ ResultFeedback : narratives
  AssessmentResult ||--o{ ResultChangeLog : edits
  Assessment ||--o{ AssessmentResource : evidence
  Assignment }o--|| Class : for
  Assignment ||--o{ AssignmentSubmission : handed_in
  Learner ||--o{ AssignmentSubmission : submits
  Timetable }o--|| Term : covers
  Timetable ||--o{ TimetableVersion : versions
  TimetableVersion ||--o{ TimetableEntry : contains
  TimetableVersion ||--o{ TimetableConflict : reports
  TimetableEntry }o--|| Class : scheduled_for
  TimetableEntry }o--|| LearningArea : teaches
  TimetableEntry }o--o| TeacherProfile : taught_by
  TimetableEntry }o--o| Room : in
  TimetablePeriod ||--o{ TimetableEntry : slot
  School ||--o{ Notification : sends
  User ||--o{ Notification : receives
  School ||--o{ AuditLog : records
  School ||--o{ FileObject : stores
```

## 4. Indexing notes

* Every foreign key is indexed, because the API filters by `schoolId` plus one dimension
  (class, learner, term, teacher) on nearly every list endpoint.
* Hot composite indexes include `AssessmentResult(schoolId, learnerId, status)`,
  `Assessment(classId, termId, learningAreaId)`, `TimetableEntry(versionId, dayOfWeek, sequence)`,
  `Notification(userId, readAt)`, `AuditLog(schoolId, createdAt)`.
* Uniqueness that carries a business rule: one teacher assignment per
  class + learning area + term; one timetable entry per version + day + sequence + class; one
  enrolment per learner + class + year; one membership per user + school.

## 5. Transactions and consistency

* Mark entry, result publication, enrolment changes, timetable publishing and file+mapping writes run
  inside `prisma.$transaction`, so a partial failure cannot leave a half-published assessment or a
  timetable that is published with unresolved errors.
* Publication is idempotent: re-publishing a corrected assessment creates a correction trail rather
  than a second set of results.
* Deletes are soft wherever history matters; hard deletes are limited to join rows with no history
  (e.g. removing a draft timetable entry).

## 6. Seeding

`npm run db:seed` is deterministic (fixed RNG seed) and produces one demo school —
**Nakuru Hills Junior School (Demo)**, code `NHJS-001`, timezone `Africa/Nairobi`:
14 users (admin, 8 teachers, guardians), 120 learners, 5 classes across Grades 7–9, 9 learning areas
with strands and sub-strands, school assessment categories and achievement bands, 30 assessments with
570 results, one published timetable (160 lesson entries), notifications and audit rows.

Passwords come from environment variables (`SEED_ADMIN_PASSWORD`, `SEED_TEACHER_PASSWORD`,
`SEED_PARENT_PASSWORD`); the seed refuses to run with placeholder values in production and **never**
contains a hardcoded production password. The seed generates synthetic names and admission numbers
only — no real learner data is included anywhere in this repository.
