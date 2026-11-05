/**
 * @edutrack/shared-config
 * Cross-cutting constants, design tokens and role permission matrices shared by
 * the API, the Next.js web app and the Expo mobile app.
 * Build-time safe: no Node or browser specific APIs.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'EduTrack Pro';
export const APP_VERSION = '1.0.0';
export const API_PREFIX = '/api/v1';
export const DEFAULT_TIMEZONE = 'Africa/Nairobi';

/** Junior School grades covered by the first iteration of the platform. */
export const JUNIOR_SCHOOL_LEVELS = [7, 8, 9] as const;

export const ROLES = ['SUPERADMIN', 'ADMIN', 'CLASS_TEACHER', 'TEACHER', 'PARENT'] as const;
export type AppRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPERADMIN: 'Platform Superadmin',
  ADMIN: 'School Administrator',
  CLASS_TEACHER: 'Class Teacher',
  TEACHER: 'Teacher',
  PARENT: 'Parent / Guardian',
};

/** Class teachers retain subject-teacher workflows; class-wide powers are separate. */
export function isTeacherRole(role: AppRole): role is 'TEACHER' | 'CLASS_TEACHER' {
  return role === 'TEACHER' || role === 'CLASS_TEACHER';
}

/** Fine-grained permissions. Enforced on the backend for every request. */
export const PERMISSIONS = [
  'school:read',
  'school:write',
  'calendar:manage',
  'user:manage',
  'teacher:manage',
  'parent:manage',
  'learner:manage',
  'learner:read:linked',
  'class:manage',
  'learning-area:manage',
  'assignment:manage',
  'submission:create',
  'submission:read',
  'submission:review',
  'assessment:create',
  'assessment:read:assigned',
  'assessment:read:published',
  'result:enter',
  'result:read:draft',
  'result:read:published',
  'result:publish',
  'result:amend',
  'resource:create',
  'resource:read:assigned',
  'resource:read:published',
  'timetable:read:own',
  'timetable:read:class',
  'timetable:read:published-linked',
  'timetable:generate',
  'timetable:edit',
  'timetable:validate',
  'timetable:publish',
  'notification:read',
  'report:read:school',
  'report:read:class',
  'report:read:learner',
  'class-teacher:read',
  'class-teacher:assign',
  'class-teacher:results:review',
  'class-teacher:reports:manage',
  'class-teacher:interventions:manage',
  'audit:read',
  'export:school-data',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  // Superadmins use isolated /admin routes and never inherit school permissions.
  SUPERADMIN: [],
  ADMIN: [
    'school:read', 'school:write', 'calendar:manage', 'user:manage', 'teacher:manage',
    'parent:manage', 'learner:manage', 'class:manage', 'learning-area:manage',
    'assignment:manage', 'assessment:create', 'assessment:read:assigned',
    'assessment:read:published', 'result:enter', 'result:read:draft', 'result:read:published',
    'result:publish', 'result:amend', 'resource:create', 'resource:read:assigned',
    'submission:create', 'submission:read', 'submission:review',
    'resource:read:published', 'timetable:read:own', 'timetable:read:class',
    'timetable:generate', 'timetable:edit', 'timetable:validate', 'timetable:publish',
    'notification:read', 'report:read:school', 'report:read:class', 'report:read:learner',
    'class-teacher:read', 'class-teacher:assign', 'class-teacher:results:review',
    'class-teacher:reports:manage', 'class-teacher:interventions:manage',
    'audit:read', 'export:school-data',
  ],
  CLASS_TEACHER: [
    'school:read', 'learner:read:linked', 'assessment:create', 'assessment:read:assigned',
    'result:enter', 'result:read:draft', 'result:publish', 'resource:create', 'resource:read:assigned',
    'timetable:read:own', 'timetable:read:class', 'notification:read', 'report:read:class', 'report:read:learner',
    'submission:create', 'submission:read', 'submission:review', 'result:amend',
    'class-teacher:read', 'class-teacher:results:review', 'class-teacher:reports:manage',
    'class-teacher:interventions:manage',
  ],
  TEACHER: [
    'school:read', 'learner:read:linked', 'assessment:create', 'assessment:read:assigned',
    'result:enter', 'result:read:draft', 'result:publish', 'resource:create',
    'resource:read:assigned', 'timetable:read:own', 'timetable:read:class',
    'notification:read', 'report:read:class', 'report:read:learner',
    'submission:create', 'submission:read', 'submission:review',
    // A teacher may correct a result they published for a class they teach
    // (ResultsService re-checks the class/learning-area assignment and every
    // amendment is written to the immutable change log).
    'result:amend',
  ],
  PARENT: [
    'learner:read:linked', 'assessment:read:published', 'result:read:published',
    'resource:read:published', 'timetable:read:published-linked', 'notification:read',
    'report:read:learner',
    // Guardians hand work in on behalf of a linked learner (learners have no logins).
    'submission:create', 'submission:read',
  ],
};

export function roleHasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Assessment lifecycle. Only PUBLISHED/CORRECTED results reach parents. */
export const ASSESSMENT_STATUS_FLOW = ['DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED', 'CORRECTED', 'ARCHIVED'] as const;

/** Default assessment categories a school can rename, disable or extend. */
export const DEFAULT_ASSESSMENT_CATEGORIES = [
  { code: 'CAT', name: 'Continuous Assessment Test', allowsMarks: true, allowsRubric: true },
  { code: 'QUIZ', name: 'Quiz', allowsMarks: true, allowsRubric: true },
  { code: 'ASSIGNMENT', name: 'Assignment', allowsMarks: true, allowsRubric: true },
  { code: 'TEST', name: 'Written Test', allowsMarks: true, allowsRubric: true },
  { code: 'PRACTICAL', name: 'Practical Assessment', allowsMarks: true, allowsRubric: true },
  { code: 'PROJECT', name: 'Project', allowsMarks: true, allowsRubric: true },
  { code: 'END_TERM', name: 'End of Term Assessment', allowsMarks: true, allowsRubric: false },
  { code: 'OTHER', name: 'Other (school defined)', allowsMarks: true, allowsRubric: true },
] as const;

/**
 * Generic, clearly non-official achievement bands used as a starting point.
 * Schools MUST review and edit these; they are not KNEC bands and carry no
 * national meaning.
 */
export const DEFAULT_ACHIEVEMENT_LEVELS = [
  { code: 'BE', label: 'Beginning', minPercent: 0, maxPercent: 49, description: 'Needs substantial support to demonstrate the competency.' },
  { code: 'AP', label: 'Approaching', minPercent: 50, maxPercent: 69, description: 'Demonstrates the competency with support.' },
  { code: 'ME', label: 'Meeting', minPercent: 70, maxPercent: 89, description: 'Demonstrates the competency independently.' },
  { code: 'EX', label: 'Exceeding', minPercent: 90, maxPercent: 100, description: 'Demonstrates the competency independently and consistently applies it in new contexts.' },
] as const;

/**
 * Starter learning-area catalogue for Kenyan Junior School. Provided as an
 * importable template only - schools configure their own codes, names and
 * weekly period allocations according to their policy and curriculum guidance.
 */
export const LEARNING_AREA_TEMPLATE = [
  { code: 'ENG', name: 'English', shortName: 'Eng', colorHex: '#1D4ED8', isCore: true },
  { code: 'KISW', name: 'Kiswahili', shortName: 'Kis', colorHex: '#9333EA', isCore: true },
  { code: 'MATH', name: 'Mathematics', shortName: 'Math', colorHex: '#0F766E', isCore: true },
  { code: 'INTSCI', name: 'Integrated Science', shortName: 'Sci', colorHex: '#047857', isCore: true },
  { code: 'SST', name: 'Social Studies', shortName: 'SST', colorHex: '#B45309', isCore: true },
  { code: 'CRE', name: 'Christian Religious Education', shortName: 'CRE', colorHex: '#7C3AED', isCore: false },
  { code: 'IRE', name: 'Islamic Religious Education', shortName: 'IRE', colorHex: '#0891B2', isCore: false },
  { code: 'AGRI', name: 'Agriculture', shortName: 'Agri', colorHex: '#65A30D', isCore: false },
  { code: 'PRE-TECH', name: 'Pre-Technical Studies', shortName: 'Pre-Tech', colorHex: '#0E7490', isCore: false },
  { code: 'CAREER', name: 'Career & Technology Studies', shortName: 'CTS', colorHex: '#BE185D', isCore: false },
  { code: 'CREATIVE', name: 'Creative Arts & Sports', shortName: 'Creative', colorHex: '#C2410C', isCore: false },
] as const;

/** Upload policy - enforced by signature/MIME sniffing on the server. */
export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const;

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt',
] as const;

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // keep in sync with MAX_UPLOAD_MB

/** Design tokens - mirrored in apps/web/tailwind.config.ts and the mobile theme. */
export const DESIGN_TOKENS = {
  colors: {
    navy: { 50: '#F4F8FE', 100: '#EDF4FC', 200: '#D9E6F4', 500: '#63758B', 700: '#477DB5', 800: '#315F91', 900: '#244A78', 950: '#23364D' },
    blue: { primary: '#244A78', secondary: '#315F91', bright: '#477DB5', action: '#3B82F6' },
    teal: { 50: '#DDF7F1', 500: '#14B8A6' },
    page: '#F4F8FE',
    surface: '#FFFFFF',
    ink: '#23364D',
    muted: '#63758B',
    border: '#D9E6F4',
    danger: '#D64545',
    warning: '#F2B84B',
    warningSoft: '#FFF4D6',
    success: '#16865B',
  },
  radius: { sm: '6px', md: '10px', lg: '14px' },
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

export const TIMETABLE_DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
] as const;

export const CONFLICT_SEVERITY_ORDER: Record<'ERROR' | 'WARNING' | 'INFO', number> = {
  ERROR: 0, WARNING: 1, INFO: 2,
};

export * from './permissions';
