/**
 * Response types for the EduTrack Pro API.
 *
 * These mirror the serialised DTOs returned by `apps/api` (verified against live
 * responses, see docs/API.md). They are deliberately hand-written rather than
 * generated so the UI can stay loose about optional fields without pulling the
 * whole Prisma client into the browser bundle.
 */

export type Role = 'SUPERADMIN' | 'ADMIN' | 'CLASS_TEACHER' | 'TEACHER' | 'PARENT';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  role: Role;
  schoolId: string;
  schoolName: string;
  membershipId?: string | null;
  permissions: string[];
  teacherProfileId?: string | null;
  parentProfileId?: string | null;
  timezone?: string;
  mustChangePassword?: boolean;
}

export interface SchoolProfile {
  id: string;
  name: string;
  code: string;
  addressLine?: string | null;
  county?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  motto?: string | null;
  logoFileId?: string | null;
  timezone: string;
  currency: string;
  portalName?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  currentAcademicYearId?: string | null;
  currentTermId?: string | null;
  workingDays: number[];
  schoolOpenTime?: string;
  schoolCloseTime?: string;
  defaultPeriodMinutes?: number;
  maxPeriodsPerDay?: number;
  breakConfig?: Array<{ label: string; minutes: number; afterPeriod: number }>;
  lunchConfig?: { label: string; minutes: number; afterPeriod: number } | null;
  settings?: Record<string, unknown>;
  isActive: boolean;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  isLocked: boolean;
  notes?: string | null;
  terms?: Term[];
  _count?: { classes: number };
}

export interface Term {
  id: string;
  academicYearId: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  resultsPublishedAt?: string | null;
  academicYear?: { id: string; name: string };
  _count?: { assessments: number };
}

export interface GradeLevel {
  id: string;
  level: number;
  name: string;
  order: number;
  classCount: number;
  learnerCount: number;
}

export interface ClassSummary {
  id: string;
  name: string;
  stream?: string | null;
  capacity?: number | null;
  gradeId: string;
  gradeName: string;
  gradeLevel: number;
  academicYearId: string;
  academicYearName?: string;
  classTeacherId?: string | null;
  classTeacherName?: string | null;
  learnerCount?: number;
  assignmentCount?: number;
  isActive: boolean;
}

export interface LearnerSummary {
  id: string;
  admissionNumber: string;
  assessmentNumber?: string | null;
  upiNumber?: string | null;
  fullName: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  gender: string;
  dateOfBirth?: string | null;
  gradeId?: string | null;
  gradeName?: string | null;
  gradeLevel?: number | null;
  currentClassId?: string | null;
  className?: string | null;
  status: string;
  enrolledOn?: string | null;
  isBoarding?: boolean;
  specialNeeds?: string | null;
  guardianCount?: number;
  guardians?: GuardianLink[];
}

export interface TeacherSummary {
  id: string;
  userId: string;
  staffNumber: string;
  fullName: string;
  email: string;
  phone?: string | null;
  tscNumber?: string | null;
  specialization?: string | null;
  qualifications?: string | null;
  employmentType?: string | null;
  maxPeriodsPerDay?: number | null;
  maxPeriodsPerWeek?: number | null;
  prefersFreeDays?: number[];
  isActive: boolean;
  lastLoginAt?: string | null;
  assignmentCount?: number;
  assignments?: Array<{ id: string; classId: string; className: string; learningAreaId: string; learningAreaName: string }>;
  unavailableSlots?: Array<{ dayOfWeek: number; sequence: number; reason?: string | null }>;
}

export interface ParentSummary {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  relationship?: string | null;
  occupation?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  linkedLearners?: Array<{
    linkId: string;
    id: string;
    fullName: string;
    admissionNumber: string;
    gradeName?: string | null;
    className?: string | null;
    relationship: string;
    isVerified: boolean;
    canViewResults: boolean;
    canViewResources: boolean;
  }>;
}

export interface GuardianLink {
  id: string;
  relationship: string;
  isVerified: boolean;
  verifiedAt?: string | null;
  verificationMethod?: string | null;
  isPrimaryContact?: boolean;
  canViewResults: boolean;
  canViewResources: boolean;
  createdAt?: string;
  parent?: { id: string; name: string; email: string; phone?: string | null };
  parentProfile?: { id: string; fullName?: string; name?: string };
  learner?: {
    id: string;
    name: string;
    fullName?: string;
    admissionNumber?: string;
    assessmentNumber?: string | null;
    gradeName?: string | null;
    className?: string | null;
  };
}

export interface LearningArea {
  id: string;
  code: string;
  name: string;
  shortName?: string | null;
  colorHex: string;
  isCore: boolean;
  isExamined: boolean;
  defaultPeriodsPerWeek?: number | null;
  order: number;
  isActive: boolean;
  description?: string | null;
  strandCount?: number;
  requirementCount?: number;
  assessmentCount?: number;
}

export interface Strand {
  id: string;
  learningAreaId: string;
  gradeLevel?: number | null;
  code?: string | null;
  name: string;
  description?: string | null;
  order?: number;
  subStrands?: SubStrand[];
}

export interface SubStrand {
  id: string;
  strandId: string;
  code?: string | null;
  name: string;
  description?: string | null;
  order?: number;
}

export interface PeriodRequirement {
  id: string;
  classId: string;
  className: string;
  gradeLevel?: number;
  learningAreaId: string;
  learningAreaName: string;
  learningAreaColor: string;
  periodsPerWeek: number;
  preferDoubleLesson: boolean;
  preferMorning: boolean;
  requiredRoomId?: string | null;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  teacherName: string;
  teacherEmail?: string;
  classId: string;
  className: string;
  gradeLevel?: number;
  learningAreaId: string;
  learningAreaName: string;
  learningAreaColor?: string;
  isPrimary: boolean;
  lessonsPerWeek?: number | null;
}

export interface CoverageReport {
  classesChecked: number;
  totalRequiredPeriods: number;
  missingTeacherAssignments: Array<{ classId: string; className: string; learningAreaId: string; learningAreaName: string }>;
  classesWithoutRequirements: Array<{ id: string; name: string }>;
  classesWithoutLearners: Array<{ id: string; name: string }>;
  teacherWorkloads: Array<{ teacherId: string; teacherName: string; staffNumber?: string; weeklyPeriods: number; maxPeriodsPerWeek?: number | null; overLimit: boolean }>;
  overloadedTeachers: Array<{ teacherId: string; teacherName: string; weeklyPeriods: number; maxPeriodsPerWeek?: number | null }>;
  isReady: boolean;
}

export interface AssessmentCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  defaultWeight?: number | null;
  order?: number;
  isActive: boolean;
}

export interface AchievementLevel {
  id: string;
  code: string;
  label: string;
  minPercent: number;
  maxPercent: number;
  description?: string | null;
  order?: number;
  isActive?: boolean;
}

export interface Rubric {
  id: string;
  /** The API returns this as `title`; `name` is kept for older payloads. */
  title?: string;
  name?: string;
  description?: string | null;
  learningAreaId?: string | null;
  totalPoints?: number | null;
  criteria?: Array<{ id: string; name: string; description?: string | null; maxPoints: number; order?: number; levels?: Array<{ id: string; label: string; points: number; description?: string | null }> }>;
}

export interface AssessmentResource {
  id: string;
  fileId?: string | null;
  fileName?: string | null;
  title?: string | null;
  kind?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  externalUrl?: string | null;
  createdAt?: string;
}

export interface ResultSummary {
  totalLearners: number;
  entered: number;
  missing: number;
  published: number;
  completionPercent: number;
}

export interface Assessment {
  id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  academicYearId: string;
  termId?: string | null;
  termName?: string | null;
  classId: string;
  className: string;
  gradeLevel?: number;
  learningAreaId: string;
  learningAreaName: string;
  learningAreaColor?: string;
  categoryId: string;
  categoryCode?: string;
  categoryName: string;
  strandId?: string | null;
  strandName?: string | null;
  subStrandId?: string | null;
  subStrandName?: string | null;
  rubricId?: string | null;
  createdById?: string;
  createdByName?: string;
  assessmentDate: string;
  dueDate?: string | null;
  totalMarks?: number | null;
  usesMarks: boolean;
  usesRubric: boolean;
  isExternallyReported: boolean;
  status: 'DRAFT' | 'READY_FOR_REVIEW' | 'PUBLISHED' | 'CORRECTED' | 'ARCHIVED';
  publishedAt?: string | null;
  correctedAt?: string | null;
  correctionReason?: string | null;
  resources?: AssessmentResource[];
  resultSummary?: ResultSummary;
  canEdit?: boolean;
  canPublish?: boolean;
}

export interface ResultRow {
  learnerId: string;
  learnerName: string;
  admissionNumber: string;
  assessmentNumber?: string | null;
  resultId?: string | null;
  numericScore?: number | null;
  percent?: number | null;
  achievementLevelId?: string | null;
  achievementLevel?: { id?: string; code?: string; label: string; description?: string | null } | null;
  isAbsent: boolean;
  isExcused: boolean;
  status: string;
  comment?: string | null;
  enteredBy?: string | null;
  updatedAt?: string | null;
  rubricScores?: Array<{ criterionId: string; points: number | null }>;
  feedback?: Array<{ id: string; kind: string; body: string; createdAt: string }>;
}

export interface ResultGrid {
  assessment: Pick<Assessment, 'id' | 'title' | 'className' | 'learningAreaName' | 'totalMarks' | 'usesMarks' | 'usesRubric' | 'status' | 'assessmentDate'>;
  achievementLevels: AchievementLevel[];
  rubric: Rubric | null;
  rows: ResultRow[];
  summary: { expected: number; entered: number; missing: number; absent: number; averagePercent: number | null };
}

/**
 * One published result as the API serves it to a guardian or teacher
 * (`GET /results/learner/:learnerId`). The achievement level is the school's own
 * configurable band — `reportingBasis` records that fact so nothing here is
 * mistaken for a national grade.
 */
export interface LearnerResult {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  learningAreaId?: string;
  learningAreaName: string;
  learningAreaColor?: string | null;
  categoryName: string;
  termName?: string | null;
  className?: string | null;
  assessmentDate: string;
  numericScore?: number | null;
  totalMarks?: number | null;
  percent?: number | null;
  achievementLevel?: { code?: string; label: string; description?: string | null } | null;
  isAbsent?: boolean;
  isExcused?: boolean;
  status: string;
  comment?: string | null;
  publishedAt?: string | null;
  amendedAt?: string | null;
  wasCorrected?: boolean;
  feedback?: Array<{ id: string; body?: string | null; narrative?: string | null; createdAt?: string }>;
  rubricScores?: Array<{ criterionId?: string; criterionTitle?: string; levelLabel?: string; points?: number | null }>;
  reportingBasis?: string;
}

/** `GET /results/learner/:learnerId/progress` returns one entry per learning area. */
export interface LearnerProgressArea {
  learningAreaId: string;
  learningAreaName: string;
  colorHex?: string | null;
  points: Array<{ label: string; percent: number; achievement?: string | null; date?: string | null }>;
  averagePercent: number;
  latestAchievement?: string | null;
  trend: 'UP' | 'DOWN' | 'FLAT' | 'INSUFFICIENT_DATA';
  basis?: string;
}

export interface LearnerProgress {
  learner: { id: string; fullName: string; admissionNumber: string; gradeName?: string | null; className?: string | null };
  byLearningArea: Array<{ learningAreaId: string; learningAreaName: string; color?: string; points: Array<{ assessmentTitle: string; date: string; percent: number | null; scoreLabel: string }>; averagePercent?: number | null; assessmentCount: number }>;
  feedback?: Array<{ id: string; kind: string; body: string; createdAt: string; learningAreaName?: string; teacherName?: string }>;
  note?: string;
}

export interface LearningResource {
  id: string;
  title: string;
  description?: string | null;
  body?: string | null;
  type: string;
  classId?: string | null;
  className?: string | null;
  learningAreaId?: string | null;
  learningAreaName?: string | null;
  strandId?: string | null;
  learningAreaColor?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  downloadUrl?: string | null;
  externalUrl?: string | null;
  dueDate?: string | null;
  visibleToParents: boolean;
  publishedAt?: string | null;
  createdAt?: string;
  createdByName?: string;
}

export interface Assignment {
  id: string;
  title: string;
  instructions?: string | null;
  classId: string;
  className?: string | null;
  learningAreaId?: string | null;
  learningAreaName?: string | null;
  dueDate?: string | null;
  maxScore?: number | null;
  fileId?: string | null;
  fileName?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
  createdByName?: string | null;
  submission?: Submission | null;
}

export interface Submission {
  id: string;
  assignmentId: string;
  assignmentTitle?: string;
  classId?: string;
  className?: string | null;
  learningAreaName?: string | null;
  learnerId?: string;
  learnerName?: string;
  admissionNumber?: string;
  submittedById?: string;
  submitterRole?: Role;
  /** Who actually pressed submit (a guardian, or a teacher on their behalf). */
  submittedByName?: string | null;
  status: 'SUBMITTED' | 'LATE' | 'RETURNED' | 'REVIEWED' | 'ACCEPTED';
  submittedAt?: string;
  isLate?: boolean;
  note?: string | null;
  learningAreaColor?: string | null;
  maxScore?: number | null;
  dueDate?: string | null;
  /** The uploaded file, when the hand-in included one (private storage). */
  file?: { id: string; name?: string | null; mimeType?: string | null; sizeBytes?: number | null; downloadUrl?: string | null } | null;
  fileId?: string | null;
  fileName?: string | null;
  linkUrl?: string | null;
  externalUrl?: string | null;
  score?: number | null;
  feedback?: string | null;
  returnedReason?: string | null;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
}

/**
 * One row per *enrolled learner* for an assignment, so learners without a hand-in
 * still appear (status `MISSING`, `submissionId` null).
 */
export interface SubmissionSummaryRow {
  learnerId: string;
  learnerName: string;
  admissionNumber: string;
  status: Submission['status'] | 'MISSING';
  submittedAt?: string | null;
  isLate?: boolean;
  score?: number | null;
  feedback?: string | null;
  submissionId?: string | null;
}

export interface SubmissionSummary {
  assignment: { id: string; title: string; dueDate?: string | null; maxScore?: number | null; className?: string; learningAreaName?: string };
  rows: SubmissionSummaryRow[];
  completion: { expected: number; handedIn: number; missing: number; late: number; reviewed: number; returned: number; completionPercent: number };
}

export interface TimetablePeriod {
  id: string;
  dayOfWeek: number;
  sequence: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  isLunch: boolean;
  isTeaching: boolean;
}

export interface TimetableLesson {
  id?: string;
  entryId?: string;
  dayOfWeek: number;
  sequence: number;
  startTime?: string;
  endTime?: string;
  periodLabel?: string;
  learningAreaName: string;
  learningAreaColor?: string;
  className?: string;
  teacherName?: string | null;
  roomName?: string | null;
  isDoubleLesson?: boolean;
  isLocked?: boolean;
}

export interface TimetableVersionSummary {
  id: string;
  timetableId?: string;
  versionNumber: number;
  status: 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'SUPERSEDED';
  notes?: string | null;
  generatedAt?: string;
  publishedAt?: string | null;
  publishedByName?: string | null;
  supersededAt?: string | null;
  entryCount: number;
  isCurrent: boolean;
  conflictCount?: number;
  conflictSummary?: { stats?: Record<string, number>; diagnostics?: TimetableDiagnostic[] } | null;
}

export interface Timetable {
  id: string;
  name: string;
  description?: string | null;
  academicYearId: string;
  academicYearName?: string;
  termId?: string | null;
  termName?: string | null;
  scope: string;
  status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  currentVersionId?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
  createdByName?: string;
  versions?: TimetableVersionSummary[];
  currentVersion?: TimetableVersionSummary | null;
}

export interface TimetableDiagnostic {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  suggestion?: string | null;
  context?: Record<string, unknown>;
}

export interface TimetableConflict {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  suggestion?: string | null;
  dayOfWeek?: number;
  sequence?: number;
  className?: string;
  teacherName?: string;
  roomName?: string;
  entryIds?: string[];
}

export interface TimetableVersionDetail {
  version: TimetableVersionSummary;
  timetable?: Timetable;
  periods?: TimetablePeriod[];
  entries?: TimetableLesson[];
  conflicts?: TimetableConflict[];
  diagnostics?: TimetableDiagnostic[];
  stats?: Record<string, unknown>;
}

export interface TimetablePreflight {
  termId?: string | null;
  school: { workingDays: number[]; maxPeriodsPerDay: number; timezone: string };
  periods: TimetablePeriod[];
  teachingSlotCount: number;
  classes: Array<{ classId: string; className: string; gradeName?: string; learners: number; requiredPeriods: number; capacity: number; learningAreas: string[]; feasible: boolean; issue?: string | null }>;
  teachers: Array<{ id: string; name: string; staffNumber?: string; maxPeriodsPerDay?: number | null; maxPeriodsPerWeek?: number | null; unavailableSlots: number; assignments: number }>;
  assignments: Array<{ assignmentId: string; teacherId: string; teacherName: string; classId: string; learningAreaId: string; weeklyLimit?: number | null; dailyLimit?: number | null }>;
  issues: TimetableDiagnostic[];
  ready: boolean;
  blockingIssueCount: number;
  warningCount: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  channels?: string[];
  emailStatus?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  emailAddress?: string | null;
  mutedTypes: string[];
  emailProvider?: string;
  emailDeliveryConfigured?: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

export interface AdminDashboard {
  counts: { teachers: number; learners: number; classes: number; parents: number; learningAreas: number; assessments: number; resources: number };
  academicContext?: { academicYearName?: string; termName?: string; termEndsOn?: string | null };
  assessmentOverview?: { draft: number; readyForReview: number; published: number; missingResults: number; awaitingResults: Array<{ id: string; title: string; className: string; learningAreaName: string; entered: number; expected: number; missing: number }> };
  timetableStatus?: { timetables: number; published: number; draft: number; openConflicts: number; versions: number };
  setupWarnings?: Array<{ code: string; message: string; severity: string; link?: string }>;
  recentActivity?: AuditLogEntry[];
}

export interface TeacherDashboard {
  today?: { dayOfWeek: number; lessons: TimetableLesson[] };
  upcoming?: TimetableLesson[];
  classes?: Array<Partial<ClassSummary> & { id: string; name: string; learnerCount?: number }>;
  learningAreas?: LearningArea[];
  assessments?: { inProgress: number; awaitingPublication: number; draftsWithMissingResults: number; recent: Array<Pick<Assessment, 'id' | 'title' | 'className' | 'learningAreaName' | 'categoryName' | 'status' | 'assessmentDate'>> };
  weeklyLoad?: { totalPeriods: number; maxPeriodsPerWeek?: number | null; byDay: Array<{ dayOfWeek: number; periods: number }> };
  recentResources?: LearningResource[];
  pendingSubmissions?: number;
}

/**
 * The guardian dashboard returns a *summary* of each recent result (a formatted
 * score label rather than the raw mark), which is why it is not `LearnerResult`.
 */
export interface ParentResultHighlight {
  id: string;
  assessmentTitle: string;
  learningAreaName: string;
  categoryName: string;
  scoreLabel: string;
  achievementLabel?: string | null;
  publishedAt?: string | null;
}

export interface ParentDashboard {
  learners: Array<{ id: string; fullName: string; admissionNumber: string; gradeName?: string; className?: string; classId?: string; gradeLevel?: number; relationship: string; isVerified: boolean }>;
  selectedLearnerId?: string | null;
  latestResults?: ParentResultHighlight[];
  recentFeedback?: Array<{ id: string; kind: string; body: string; createdAt: string; learningAreaName?: string }>;
  upcomingAssignments?: Assignment[];
  recentResources?: LearningResource[];
  progress?: Array<{ learningAreaName: string; color?: string; points: Array<{ assessmentTitle: string; date: string; percent: number | null }> }>;
  unreadNotifications?: number;
  academicContext?: { academicYearName?: string; termName?: string };
}

/** Shape of GET /reports/school (verified against the running API). */
export interface SchoolReports {
  academicContext?: { academicYearName?: string; termName?: string };
  enrolmentByGrade?: Array<{
    gradeName: string;
    learners: number;
    classes: Array<{ classId: string; name: string; learners: number; capacity?: number | null }>;
  }>;
  assessmentStatus?: { draft: number; ready: number; published: number; archived: number };
  assessmentCompletion?: Array<{
    assessmentId: string;
    title: string;
    className: string;
    learningAreaName: string;
    categoryName: string;
    status: string;
    entered: number;
    expected: number;
    missing: number;
    completionPercent: number;
  }>;
  classCoverage?: Array<{
    classId: string;
    className: string;
    gradeName?: string;
    learners: number;
    requiredLearningAreas: number;
    assignedTeachers: number;
    missingTeacherAssignments: number;
    gaps: string[];
  }>;
  teacherWorkload?: Array<{
    teacherId: string;
    teacherName: string;
    staffNumber?: string;
    classes: number;
    weeklyPeriods: number;
    maxPeriodsPerWeek?: number | null;
    overLimit: boolean;
  }>;
  timetableCoverage?: Array<{
    timetableId: string;
    name: string;
    termName?: string | null;
    status: string;
    versions: Array<{ versionNumber: number; status: string; entries: number; conflicts: number }>;
  }>;
  classLearningAreaProgress?: Array<{ className: string; learningAreas: Array<{ name: string; periodsPerWeek: number }> }>;
}
