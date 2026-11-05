# Timetable engine

The engine is a **deterministic constraint solver**. It exists so a school can produce a timetable from
its real data (classes, teachers, availability, weekly lesson requirements, bell times) instead of
hand-drawing one, and so an impossible request fails with an explanation rather than a published
timetable full of clashes.

## 1. Inputs

| Input | Endpoint | Where it lives |
| --- | --- | --- |
| Working days, school hours, period length, breaks, lunch | `PATCH /school/profile`, `POST /school/periods` | `School` + `TimetablePeriod` |
| Weekly lesson requirement per class + learning area | `POST /learning-areas/requirements` | `ClassLearningAreaRequirement` |
| Who teaches what | `POST /teacher-assignments` | `TeacherAssignment` |
| Teacher availability, workload caps, preferred free days | `POST /teacher-assignments/availability/:teacherId`, `PATCH /teachers/:id` | `TeacherAvailability`, `TeacherProfile` |
| Rooms (optional constraint) | `POST /room`, `POST /timetables` per-term config | `Room` |
| Year/term | `POST /school/academic-years`, `POST /school/terms` | `AcademicYear`, `Term` |

Generation requires at least one class id (`classIds`), a period grid and weekly requirements; without
requirements the job fails fast with `NO_REQUIREMENTS` diagnostics instead of producing an empty plan.

## 2. Hard constraints (a timetable that breaks these is never published)

1. No class is double-booked in a period.
2. No teacher is double-booked in a period.
3. No room is double-booked in a period.
4. Lessons never land in break, lunch or outside the school day (`isTeaching = false` periods are excluded).
5. Teachers are only scheduled when their `TeacherAvailability` says they are available.
6. A lesson is only created for a valid teacher ↔ learning area ↔ class relationship
   (existing `TeacherAssignment`) — the generator never invents a teacher.
7. Hard workload caps (`maxPeriodsPerDay`, `maxPeriodsPerWeek`) are respected.
8. Entries belong to the correct academic year and term.
9. Learner-overlap: a learner enrolled in the class cannot be scheduled twice (relevant for
   double lessons and multi-class shared lessons).
10. The published version carries no `ERROR`-severity conflict rows.

## 3. Soft preferences (trade-offs are reported, never hidden)

* Spread a subject across the week instead of stacking it on one day.
* Avoid excessive consecutive lessons for the same class or teacher.
* Minimise teacher gaps (free periods between lessons).
* Honour teacher preferences (preferred free days, preferred slots) when they do not break a hard rule.

Each generation returns `stats` (assigned, unplaced, spread quality, gap counts) plus `diagnostics`
explaining any soft preference that could not be satisfied. The admin workflow states plainly which
trade-off was chosen.

## 4. Workflow (10 steps, exactly as the admin workspace exposes it)

1. **Configure** — calendar, bell schedule, requirements, availability, rooms.
2. **Preflight** — `GET /timetables/preflight` reports what is still missing for the selected term.
3. **Generate** — `POST /timetables/generate` (`classIds`, optional room/teacher options, `replaceDraft`).
4. **Review** — the version view returns a week grid (per class, per teacher, whole school, per room).
5. **Validate** — `POST /timetables/:versionId/validate` recomputes conflicts; returns
   `{ conflicts, summary: { errors, warnings }, validated }`.
6. **Adjust** — drag-and-drop in the web grid, or the accessible form alternative
   (`POST /timetables/entries/move` with `targetPeriodId`, `targetDayOfWeek`, `targetSequence`),
   lock a fixed lesson, or delete one. Every change is re-validated immediately and returns the
   conflict list for the affected entries.
7. **Resolve** — the conflict panel lists severity, an explanation and a suggested resolution per
   conflict (`TimetableConflict` rows with code + resolution hint).
8. **Publish** — `POST /timetables/publish` with `{ versionId, force?, notes?, notify? }` in the body (admin only). Publishing with unresolved
   `ERROR` conflicts is refused with `BUSINESS_RULE_VIOLATION`; the response names the conflicts.
9. **Supersede** — publishing a version flips the previously published one to `SUPERSEDED`; the
   history keeps who published what and when.
10. **Distribute** — teachers read `GET /timetables/me`; guardians read
    `GET /timetables/learner/:learnerId` (published versions only, for their verified linked learner);
    neither role can edit, and a published version is read-only (`400` on any move attempt).

## 5. Infeasibility

If the solver cannot place every required lesson it returns `status: FAILED` with:

* `unplaced` — the lessons it could not place (class, learning area, periods still needed);
* `diagnostics[]` — why, in human terms (e.g. "Grade 8 has 34 required periods but only 30 teaching
  slots are configured", "Teacher X is only available for 6 periods and is required for 12");
* `stats`, `feasibility` and a `message` summarising the biggest blocker.

Nothing partial is published. The admin either relaxes a constraint (adds a period, expands
availability) or accepts fewer weekly lessons — deliberately a human decision.

## 6. Versioning and audit

`TimetableVersion` moves `DRAFT → VALIDATED → PUBLISHED → SUPERSEDED`. Drafts can be duplicated
(`POST /timetables/versions/:id/duplicate`) to try alternatives without touching what the school is
running. Every generate/validate/move/lock/publish action is written to `AuditLog` with the actor,
version and affected entries.

## 7. Conflict catalogue

`TimetableConflictCode` covers teacher clash, class clash, room clash, unavailable teacher,
break/lunch violation, workload cap exceeded, missing assignment, learner overlap, and room-type
mismatch — each with a `severity` (`ERROR` blocks publication, `WARNING` informs, `INFO` advises).
