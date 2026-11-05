# Assessment workflow

## 1. What the product does *not* claim

EduTrack Pro records a school's **own** assessment practice. It does not model official national
grading, does not apply national thresholds, and never labels a learner with a national outcome.
Concretely:

* Assessment **categories** (CAT, quiz, assignment, test, practical, project, end-term, other) are
  records the school creates and names — they are explicitly *not* a KNEC classification.
* **Achievement bands** are school-defined rows with a code, label, description and score range. The
  seed ships neutral examples; no band is asserted to be national policy.
* Every result carries `reportingBasis: "SCHOOL_DEFINED_ACHIEVEMENT_BAND"`, and the results CSV export
  labels its band column `school band`. The exports suite asserts the absence of national/KNEC wording
  so this cannot regress silently.
* Nothing in the codebase tells a school which bands are "correct" — schools differ, and the software
  should not invent policy.

## 2. Lifecycle

```
DRAFT ──▶ READY_FOR_REVIEW ──▶ PUBLISHED ──▶ (amend) AMENDED
  ▲              │                  │
  └── edit ◀─────┘                  └── corrections write ResultChangeLog rows + notify guardians
```

| State | What it means | Allowed actions |
| --- | --- | --- |
| `DRAFT` | teacher is still building the assessment / entering marks | edit assessment, enter and edit marks, attach resources |
| `READY_FOR_REVIEW` | completed, awaiting review | view; edits require reverting to draft (admins can review and publish) |
| `PUBLISHED` | visible to guardians of enrolled learners; notifications sent | results are read-only except through the amend path |
| `AMENDED` | a correction was applied after publication | history available via `GET /results/:id/history`; guardians were notified |
| `ARCHIVED` | retained for history but no longer active in dashboards | read-only |

Enforced rules:

1. **Marks validation** — a score cannot exceed the assessment's `totalMarks`, cannot be negative, and
   marks cannot be entered for a learner who is not enrolled in the class.
2. **Rubric mode** — when an assessment uses a rubric, each criterion is scored against that rubric's
   levels; an assessment may use marks, a rubric, or both.
3. **Absent / excused** — flagged instead of scored, so an absence never counts as a zero.
4. **Publication preconditions** — a term must be marked as accepting results publication, the
   assessment must belong to the current term, and every entered score must be valid. Publication is
   all-or-nothing inside a transaction.
5. **Correction integrity** — amending a published result requires a reason of at least 5 characters,
   writes a `ResultChangeLog` row with the actor, before/after and reason, and notifies the guardian.
   The original score is never destroyed.
6. **Only the owning teacher (or a school admin) can publish.** Parent and learner accounts have no
   publish capability at all.

## 3. Guardian visibility

A guardian sees a result only when **all** of these hold: the learner is linked to them with a
**verified** link, the link has `canViewResults`, and the result's status is `PUBLISHED` or `AMENDED`.
Drafts, review-stage results and other learners' rows are never returned — the integration and E2E
suites assert this explicitly, including the case of a *linked but unverified* guardian.

## 4. Evidence and feedback

* An assessment can carry **evidence files** (PDF/JPG/PNG/safe types) attached through
  `POST /assessments/:id/resources`; files are private and only downloadable through an authorised,
  time-limited link.
* Narrative feedback (`ResultFeedback`) is separate from the mark and from the band, so a teacher can
  describe a competency without inventing a score.
* Learners' progress is summarised per learning area (`GET /results/learner/:id/progress`) with a trend
  computed from published results only, and is explicitly flagged as school-defined.

## 5. Testing

Covered by `apps/api/test/unit/*` (result validation, publication rules, parent-learner access),
`apps/api/test/integration/assessments-results.spec.ts`, `notification-preferences.spec.ts`,
`exports.spec.ts`, and E2E journey 7 (teacher creates an assessment, attaches a real PDF and PNG,
rejects a fake PDF, publishes, amends) with journey 8 (guardian sees published rows only).
