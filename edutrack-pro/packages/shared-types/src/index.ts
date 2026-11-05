/**
 * @edutrack/shared-types
 * Transport-level types shared by the API, web and mobile clients.
 * These mirror the API contract (docs/API.md), not the Prisma models, so that
 * the API can evolve its persistence layer without breaking clients.
 */
import type { AppRole, Permission } from '@edutrack/shared-config';

/* ------------------------------- envelope ------------------------------- */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  details?: unknown;
  requestId?: string;
  timestamp: string;
  path: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/* --------------------------------- auth -------------------------------- */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  role: AppRole;
  schoolId: string;
  schoolName: string;
  membershipId: string;
  permissions: Permission[];
  teacherProfileId?: string | null;
  parentProfileId?: string | null;
  timezone: string;
  mustChangePassword?: boolean;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LinkedLearnerSummary {
  id: string;
  fullName: string;
  admissionNumber: string;
  gradeName: string;
  className: string;
  relationship: string;
  isVerified: boolean;
}

/* ------------------------------- school -------------------------------- */

export interface SchoolProfile {
  id: string;
  name: string;
  code: string | null;
  addressLine: string | null;
  county: string | null;
  phone: string | null;
  email: string | null;
  website?: string | null;
  motto?: string | null;
  logoFileId: string | null;
  logoUrl?: string | null;
  timezone: string;
  portalName: string;
  primaryColor: string;
  accentColor: string;
  workingDays: number[];
  schoolOpenTime: string;
  schoolCloseTime: string;
  defaultPeriodMinutes: number;
  maxPeriodsPerDay: number;
  breakConfig: BreakConfig[] | null;
  lunchConfig: LunchConfig | null;
  currentAcademicYear?: { id: string; name: string } | null;
  currentTerm?: { id: string; name: string; number: number } | null;
}

export interface BreakConfig { label: string; afterPeriod: number; minutes: number }
export interface LunchConfig { afterPeriod: number; minutes: number }

export interface AcademicYearDto {
  id: string; name: string; startDate: string; endDate: string;
  isCurrent: boolean; isLocked: boolean; terms?: TermDto[];
}

export interface TermDto {
  id: string; academicYearId: string; number: number; name: string;
  startDate: string; endDate: string; isCurrent: boolean;
  resultsPublishedAt?: string | null;
}

export interface GradeDto { id: string; level: number; name: string; order: number; classCount?: number }

export interface ClassDto {
  id: string; name: string; stream: string | null; capacity: number | null;
  gradeId: string; gradeName: string; gradeLevel: number;
  academicYearId: string; academicYearName: string;
  classTeacherId: string | null; classTeacherName: string | null;
  learnerCount?: number;
  isActive: boolean;
}

export interface LearningAreaDto {
  id: string; code: string; name: string; shortName: string | null;
  colorHex: string; isCore: boolean; isExamined: boolean;
  defaultPeriodsPerWeek: number | null; order: number; isActive: boolean;
  strandCount?: number;
}

export interface TeacherDto {
  id: string; userId: string; staffNumber: string; fullName: string; email: string;
  phone: string | null; tscNumber: string | null; specialization: string | null;
  employmentType: string; maxPeriodsPerDay: number | null; maxPeriodsPerWeek: number | null;
  isActive: boolean; assignmentCount?: number; weeklyPeriodLoad?: number;
}

export interface ParentDto {
  id: string; userId: string; fullName: string; email: string; phone: string | null;
  relationship: string; linkedLearners: LinkedLearnerSummary[]; isActive: boolean;
}

export interface LearnerDto {
  id: string; admissionNumber: string; assessmentNumber: string | null; upiNumber: string | null;
  fullName: string; firstName: string; lastName: string; gender: string;
  dateOfBirth: string | null;
  gradeId: string | null; gradeName: string | null; gradeLevel: number | null;
  currentClassId: string | null; className: string | null;
  status: string; enrolledOn: string | null; isBoarding: boolean;
  guardianCount?: number;
}

export interface TeacherAssignmentDto {
  id: string; teacherId: string; teacherName: string; classId: string; className: string;
  learningAreaId: string; learningAreaName: string; learningAreaColor: string;
  isPrimary: boolean; lessonsPerWeek: number | null;
}

export interface ClassEnrollmentDto {
  id: string; learnerId: string; learnerName: string; admissionNumber: string;
  classId: string; className: string; status: string; enrolledAt: string;
}

/* ----------------------------- assessment ------------------------------ */

export interface AssessmentCategoryDto {
  id: string; code: string; name: string; allowsMarks: boolean; allowsRubric: boolean;
  defaultMaxMarks: number | null; defaultWeight: number | null; isActive: boolean;
}

export interface AchievementLevelDto {
  id: string; code: string; label: string; minPercent: number; maxPercent: number;
  description: string | null;
}

export interface RubricCriterionDto {
  id: string; title: string; description: string | null; maxScore: number | null;
  weight: number | null; order: number;
  levels: { id: string; label: string; score: number; description: string | null }[];
}

export interface RubricDto {
  id: string; title: string; description: string | null; learningAreaId: string | null;
  isTemplate: boolean; criteria: RubricCriterionDto[];
}

export interface AssessmentDto {
  id: string; title: string; description: string | null; instructions: string | null;
  academicYearId: string; termId: string; termName: string;
  classId: string; className: string; gradeLevel: number;
  learningAreaId: string; learningAreaName: string; learningAreaColor: string;
  categoryId: string; categoryCode: string; categoryName: string;
  strandId: string | null; strandName: string | null;
  subStrandId: string | null; subStrandName: string | null;
  rubricId: string | null;
  createdById: string; createdByName: string;
  assessmentDate: string; dueDate: string | null;
  totalMarks: number | null; usesMarks: boolean; usesRubric: boolean;
  status: AssessmentStatusValue;
  publishedAt: string | null; correctedAt: string | null; correctionReason?: string | null;
  resources: AssessmentResourceDto[];
  resultSummary?: AssessmentResultSummary;
  // Teacher permission flags so the UI can hide actions the API will reject
  canEdit?: boolean;
  canPublish?: boolean;
}

export type AssessmentStatusValue = 'DRAFT' | 'READY_FOR_REVIEW' | 'PUBLISHED' | 'CORRECTED' | 'ARCHIVED';

export interface AssessmentResourceDto {
  id: string; fileId: string | null; title: string | null; kind: string;
  externalUrl: string | null; fileName: string | null; mimeType: string | null;
  sizeBytes: number | null; downloadUrl: string | null; createdAt: string;
}

export interface AssessmentResultSummary {
  totalLearners: number; entered: number; missing: number; published: number;
  completionPercent: number;
}

export interface AssessmentResultDto {
  id: string; assessmentId: string; learnerId: string; learnerName: string;
  admissionNumber: string;
  numericScore: number | null; totalMarks: number | null; percent: number | null;
  achievementLevelId: string | null; achievementLevel: AchievementLevelDto | null;
  isAbsent: boolean; isExcused: boolean; status: string; comment: string | null;
  rubricScores: { criterionId: string; levelId: string | null; score: number | null; comment: string | null }[];
  feedback: { id: string; narrative: string; authorName: string; createdAt: string }[];
  publishedAt: string | null; amendedAt: string | null; updatedAt: string;
}

/* ------------------------------ timetable ------------------------------ */

export interface TimetablePeriodDto {
  id: string; dayOfWeek: number; sequence: number; label: string;
  startTime: string; endTime: string; isBreak: boolean; isLunch: boolean; isTeaching: boolean;
}

export interface TimetableEntryDto {
  id: string; dayOfWeek: number; sequence: number; periodId: string;
  classId: string; className: string; classColor?: string;
  learningAreaId: string; learningAreaName: string; learningAreaColor: string;
  teacherId: string | null; teacherName: string | null;
  roomId: string | null; roomName: string | null;
  isDoubleLesson: boolean; isLocked: boolean; note: string | null;
  startTime?: string; endTime?: string;
}

export interface TimetableVersionDto {
  id: string; timetableId: string; versionNumber: number; status: string;
  notes: string | null; generatedAt: string | null; publishedAt: string | null;
  publishedByName: string | null; supersededAt: string | null; entryCount: number;
  isCurrent: boolean; conflictSummary?: ConflictSummary;
}

export interface TimetableDto {
  id: string; name: string; description: string | null; academicYearId: string;
  academicYearName: string; termId: string; termName: string; scope: string;
  status: string; currentVersionId: string | null; publishedAt: string | null;
  createdAt: string; createdByName: string; versions?: TimetableVersionDto[];
  conflictSummary?: ConflictSummary;
}

export type ConflictSeverityValue = 'ERROR' | 'WARNING' | 'INFO';

export interface TimetableConflictDto {
  id: string; severity: ConflictSeverityValue; code: string; message: string;
  suggestion: string | null; classId: string | null; className: string | null;
  teacherId: string | null; teacherName: string | null; roomId: string | null;
  periodId: string | null; entryId: string | null; dayOfWeek: number | null;
  sequence: number | null; metadata?: Record<string, unknown> | null;
}

export interface ConflictSummary {
  errors: number; warnings: number; infos: number; byCode: Record<string, number>;
}

export interface GenerationDiagnostic {
  code: string; severity: ConflictSeverityValue; message: string; suggestion?: string;
  classId?: string; className?: string; teacherId?: string; teacherName?: string;
  learningAreaId?: string; learningAreaName?: string;
  required?: number; scheduled?: number; deficit?: number;
}

export interface GenerationResult {
  jobId: string;
  status: 'COMPLETED' | 'FAILED';
  versionId?: string;
  versionNumber?: number;
  assigned: number;
  unassigned: number;
  conflicts: TimetableConflictDto[];
  diagnostics: GenerationDiagnostic[];
  stats: GenerationStats;
  durationMs: number;
  message: string;
}

export interface GenerationStats {
  classesConsidered: number;
  lessonsRequired: number;
  lessonsPlaced: number;
  lessonsUnplaced: number;
  slotsAvailable: number;
  teachersConsidered: number;
  hardConflicts: number;
  softViolations: number;
  score?: number;
  attempts?: number;
}

export interface TeacherTimetableLesson {
  dayOfWeek: number; sequence: number; startTime: string; endTime: string;
  learningAreaName: string; learningAreaColor: string; className: string;
  roomName: string | null; periodLabel: string;
}

export interface TeacherTimetablePayload {
  published: boolean; versionId?: string; versionNumber: number | null; publishedAt: string | null;
  periods: TimetablePeriodDto[]; lessons: TeacherTimetableLesson[]; conflictCount?: number;
}

export interface LearnerTimetableLesson extends TeacherTimetableLesson {
  teacherName: string | null;
}

export interface LearnerTimetablePayload {
  published: boolean; versionId?: string; versionNumber: number | null; publishedAt: string | null;
  className: string | null; classId: string | null;
  periods: TimetablePeriodDto[]; lessons: LearnerTimetableLesson[];
}

/* ------------------------------ resources ------------------------------ */

export interface LearningResourceDto {
  id: string; title: string; description: string | null; body: string | null;
  type: 'NOTE' | 'FILE' | 'LINK' | 'ASSIGNMENT' | 'ANNOUNCEMENT';
  classId: string; className: string; learningAreaId: string; learningAreaName: string;
  createdByName: string; fileId: string | null; fileName: string | null;
  mimeType: string | null; sizeBytes: number | null; downloadUrl: string | null;
  externalUrl: string | null; dueDate: string | null; visibleToParents: boolean;
  publishedAt: string | null; createdAt: string;
}

export interface AssignmentDto {
  id: string; title: string; instructions: string | null; classId: string; className: string;
  learningAreaId: string; learningAreaName: string; dueDate: string | null;
  maxScore: number | null; publishedAt: string | null; createdByName: string;
}

/* --------------------------- notifications ----------------------------- */

export interface NotificationDto {
  id: string; type: string; title: string; body: string | null; link: string | null;
  entityType: string | null; entityId: string | null; readAt: string | null;
  createdAt: string; emailStatus: string | null;
}

/* ------------------------------ dashboards ----------------------------- */

export interface AdminDashboard {
  counts: {
    teachers: number; learners: number; classes: number; parents: number;
    learningAreas: number; assessments: number; resources: number;
  };
  academicContext: {
    academicYearName: string | null; termName: string | null; termEndsOn: string | null;
  };
  assessmentOverview: {
    draft: number; readyForReview: number; published: number; missingResults: number;
  };
  timetableStatus: {
    timetables: number; published: number; draft: number; openConflicts: number;
  };
  setupWarnings: { code: string; message: string; severity: ConflictSeverityValue; link?: string }[];
  recentActivity: { id: string; action: string; summary: string; actorName: string; createdAt: string }[];
  enrolmentByGrade: { gradeName: string; learners: number; classes: number }[];
  teacherWorkload: { teacherName: string; assignedPeriods: number; maxPeriodsPerWeek: number | null }[];
}

export interface TeacherDashboard {
  today: { dayOfWeek: number; lessons: TeacherTimetableLesson[] };
  upcoming: TeacherTimetableLesson[];
  classes: ClassDto[];
  learningAreas: LearningAreaDto[];
  assessments: {
    inProgress: number; awaitingPublication: number; draftsWithMissingResults: number;
    recent: AssessmentDto[];
  };
  weeklyLoad: { totalPeriods: number; maxPeriodsPerWeek: number | null; byDay: { dayOfWeek: number; periods: number }[] };
  recentResources: LearningResourceDto[];
  timetableStatus: { published: boolean; versionNumber: number | null; publishedAt: string | null };
}

export interface ParentDashboard {
  learners: (LinkedLearnerSummary & { classId: string | null; gradeLevel: number | null })[];
  selectedLearnerId: string | null;
  latestResults: {
    id: string; assessmentTitle: string; learningAreaName: string; categoryName: string;
    scoreLabel: string; achievementLabel: string | null; publishedAt: string | null;
  }[];
  recentFeedback: { id: string; narrative: string; learningAreaName: string; assessmentTitle: string; createdAt: string }[];
  upcomingAssignments: AssignmentDto[];
  recentResources: LearningResourceDto[];
  timetable: {
    published: boolean; versionNumber: number | null;
    lessons: TeacherTimetableLesson[]; periods: TimetablePeriodDto[];
  };
  progress: { learningAreaName: string; color: string; points: { label: string; percent: number | null; achievement: string | null }[] }[];
  unreadNotifications: number;
}

/* --------------------------------- files ------------------------------- */

export interface FileObjectDto {
  id: string; originalName: string; mimeType: string; sizeBytes: number;
  purpose: string; createdAt: string; downloadUrl: string;
}

export interface UploadPolicy {
  maxBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
}

/* ------------------------------- imports ------------------------------- */

export interface CsvImportResult {
  total: number; created: number; updated: number; skipped: number;
  errors: { row: number; field: string; message: string; value?: string }[];
  preview?: unknown[];
}

/* ------------------------------- reports ------------------------------- */

export interface LearnerProgressReport {
  learner: LearnerDto;
  term: { id: string; name: string; academicYearName: string };
  learningAreas: {
    learningAreaId: string; learningAreaName: string; colorHex: string;
    assessments: { id: string; title: string; categoryName: string; date: string; score: string; status: string }[];
    averagePercent: number | null;
    latestAchievement: string | null;
    trend: 'UP' | 'DOWN' | 'STEADY' | 'INSUFFICIENT_DATA';
  }[];
  feedback: { narrative: string; authorName: string; learningAreaName: string; createdAt: string }[];
}
