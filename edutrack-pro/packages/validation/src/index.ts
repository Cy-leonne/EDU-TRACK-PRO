/**
 * @edutrack/validation
 * Zod schemas shared by the API (request validation), the web app (form
 * validation) and the mobile app. Keeping one source of truth means a form and
 * its endpoint cannot drift apart.
 */
import { z } from 'zod';
import { ALLOWED_UPLOAD_EXTENSIONS, JUNIOR_SCHOOL_LEVELS } from '@edutrack/shared-config';

/* ------------------------------ primitives ------------------------------ */

export const idSchema = z.string().min(1, 'Required').max(64);

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

/** Kenyan-friendly phone: allow +254..., 07..., 01... with optional spaces */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number, e.g. 0712345678');

export const optionalPhoneSchema = z.union([phoneSchema, z.literal('')]).optional().nullable();

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Too long')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM format');

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(64).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(120).optional(),
});

export const workingDaysSchema = z
  .array(z.coerce.number().int().min(1).max(7))
  .min(1, 'Select at least one school day')
  .max(7)
  .transform((days) => Array.from(new Set(days)).sort((a, b) => a - b));

/* --------------------------------- auth -------------------------------- */

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  clientType: z.enum(['WEB', 'MOBILE']).default('WEB'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  clientType: z.enum(['WEB', 'MOBILE']).default('WEB'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'Invalid reset link'),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/**
 * First-administrator bootstrap. Requires the one-time token from
 * INITIAL_ADMIN_SETUP_TOKEN; the endpoint is disabled when that is unset.
 */
export const firstAdminSetupSchema = z.object({
  setupToken: z.string().min(16, 'Provide the setup token from the server environment'),
  fullName: z.string().trim().min(3).max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: optionalPhoneSchema,
  school: z.object({
    name: z.string().trim().min(3).max(160),
    code: z.string().trim().max(32).optional(),
    county: z.string().trim().max(80).optional(),
    timezone: z.string().default('Africa/Nairobi'),
  }),
});

/** Parent self-link request: assessment number PLUS a second verifier. */
export const parentLinkRequestSchema = z.object({
  learnerAssessmentNumber: z.string().trim().min(4).max(32),
  learnerSurname: z.string().trim().min(2).max(60),
  relationship: z.string().trim().min(2).max(40).default('Parent'),
});

/* ------------------------ registration & invitations ------------------- */

/**
 * School + first-administrator registration.
 *
 * Two ways in, both controlled by server configuration:
 *   • with `setupToken` (INITIAL_ADMIN_SETUP_TOKEN) — always available, one time
 *   • without a token — only when ALLOW_SCHOOL_SELF_REGISTRATION=true, so a
 *     deployment can choose to expose a public "register my school" page
 *
 * The password is confirmed client- and server-side so a typo cannot lock a new
 * administrator out of a brand-new school.
 */
export const schoolRegistrationSchema = z
  .object({
    setupToken: z.string().trim().min(16).max(200).optional(),
    school: z.object({
      name: z.string().trim().min(3, 'Enter the school name').max(160),
      code: z
        .string()
        .trim()
        .min(2, 'Use at least 2 characters')
        .max(32)
        .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only')
        .optional()
        .or(z.literal('')),
      county: z.string().trim().max(80).optional().or(z.literal('')),
      phone: optionalPhoneSchema,
      email: z.union([emailSchema, z.literal('')]).optional(),
      timezone: z.string().default('Africa/Nairobi'),
    }),
    admin: z.object({
      fullName: z.string().trim().min(3, 'Enter your full name').max(120),
      email: emailSchema,
      phone: optionalPhoneSchema,
      password: passwordSchema,
      confirmPassword: z.string().min(1, 'Confirm your password'),
    }),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms and privacy notice to continue.' }) }),
  })
  .refine((value) => value.admin.password === value.admin.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['admin', 'confirmPassword'],
  });

/**
 * Guardian self-registration.
 *
 * A guardian either arrives with an invitation from the school (preferred — the
 * learner link is prepared in advance) or registers with the school's own code.
 * In both cases learner data stays invisible until a school administrator
 * verifies the parent–learner relationship, so knowing an admission number is
 * never enough to read records.
 */
export const parentRegistrationSchema = z
  .object({
    invitationToken: z.string().trim().min(20).max(200).optional(),
    schoolCode: z.string().trim().min(2).max(32).optional(),
    fullName: z.string().trim().min(3, 'Enter your full name').max(120),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password'),
    relationship: z.string().trim().min(2, 'e.g. Mother, Father, Guardian').max(40),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms and privacy notice to continue.' }) }),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((value) => Boolean(value.invitationToken) || Boolean(value.schoolCode), {
    message: 'Enter the school code from your invitation letter, or open the invitation link you were sent.',
    path: ['schoolCode'],
  });

/** Accepting an invitation: proves the token and sets the invitee's own password. */
export const acceptInvitationSchema = z
  .object({
    token: z.string().trim().min(20, 'This invitation link is incomplete').max(200),
    fullName: z.string().trim().min(3).max(120).optional(),
    phone: optionalPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

/** Administrator-issued invitation (teacher, additional admin, or guardian). */
export const invitationCreateSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(3).max(120),
  role: z.enum(['ADMIN', 'TEACHER', 'PARENT']),
  phone: optionalPhoneSchema,
  staffNumber: z.string().trim().max(40).optional(),
  employmentType: z.enum(['TSC_EMPLOYED', 'BOM_EMPLOYED', 'INTERN', 'VOLUNTEER', 'CONTRACT']).optional(),
  relationship: z.string().trim().max(40).optional(),
  learnerId: z.string().min(1).max(64).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const invitationRevokeSchema = z.object({ reason: z.string().trim().max(200).optional() });

/** Activate / deactivate an account (administrator only). */
export const accountStatusSchema = z.object({ isActive: z.boolean() });

/* -------------------------------- school ------------------------------- */

const schoolProfileBaseSchema = z.object({
  name: z.string().trim().min(3).max(160),
  code: z.string().trim().max(32).optional().nullable(),
  addressLine: z.string().trim().max(200).optional().nullable(),
  county: z.string().trim().max(80).optional().nullable(),
  phone: optionalPhoneSchema,
  email: z.union([emailSchema, z.literal('')]).optional().nullable(),
  website: z.string().trim().url('Enter a full URL').max(200).optional().nullable().or(z.literal('')),
  motto: z.string().trim().max(160).optional().nullable(),
  timezone: z.string().trim().min(3).max(64).default('Africa/Nairobi'),
  portalName: z.string().trim().min(2).max(60).default('EduTrack Pro'),
  primaryColor: hexColorSchema.default('#12304A'),
  accentColor: hexColorSchema.default('#0F766E'),
  workingDays: workingDaysSchema,
  schoolOpenTime: timeOfDaySchema,
  schoolCloseTime: timeOfDaySchema,
  defaultPeriodMinutes: z.coerce.number().int().min(20).max(120),
  maxPeriodsPerDay: z.coerce.number().int().min(4).max(16),
  lunchAfterPeriod: z.coerce.number().int().min(1).max(15).nullable().optional(),
  lunchMinutes: z.coerce.number().int().min(15).max(120).nullable().optional(),
  breaks: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        afterPeriod: z.coerce.number().int().min(1).max(15),
        minutes: z.coerce.number().int().min(5).max(60),
      }),
    )
    .max(4)
    .default([]),
});

export const schoolProfileSchema = schoolProfileBaseSchema.refine((s) => s.schoolOpenTime < s.schoolCloseTime, {
  message: 'Closing time must be after opening time',
  path: ['schoolCloseTime'],
});

/**
 * PATCH /school/profile — every field optional, but a closing time sent without
 * an opening time (or vice versa) is still checked against the stored value in
 * the service layer.
 */
export const schoolProfileUpdateSchema = schoolProfileBaseSchema.partial();

const academicYearBaseSchema = z.object({
    name: z.string().trim().min(4).max(20),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    isCurrent: z.boolean().default(false),
});

export const academicYearSchema = academicYearBaseSchema.refine((v) => v.startDate < v.endDate, {
  message: 'End date must be after start date',
  path: ['endDate'],
});

/** Partial form used by PATCH endpoints. */
export const academicYearUpdateSchema = academicYearBaseSchema.partial();

const termBaseSchema = z.object({
    academicYearId: idSchema,
    number: z.coerce.number().int().min(1).max(3),
    name: z.string().trim().min(3).max(30),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    isCurrent: z.boolean().default(false),
});

export const termSchema = termBaseSchema.refine((v) => v.startDate < v.endDate, {
  message: 'End date must be after start date',
  path: ['endDate'],
});

/** Partial form used by PATCH endpoints. */
export const termUpdateSchema = termBaseSchema.partial();

/* -------------------------------- classes ------------------------------ */

export const classSchema = z.object({
  name: z.string().trim().min(2).max(60),
  stream: z.string().trim().max(40).optional().nullable(),
  gradeId: idSchema,
  academicYearId: idSchema,
  classTeacherId: idSchema.optional().nullable(),
  roomId: idSchema.optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(200).optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const learningAreaSchema = z.object({
  code: z.string().trim().min(2).max(16).regex(/^[A-Za-z0-9\-_]+$/, 'Use letters, numbers and dashes only'),
  name: z.string().trim().min(2).max(80),
  shortName: z.string().trim().max(20).optional().nullable(),
  colorHex: hexColorSchema.default('#0F766E'),
  description: z.string().trim().max(400).optional().nullable(),
  isCore: z.boolean().default(false),
  isExamined: z.boolean().default(true),
  defaultPeriodsPerWeek: z.coerce.number().int().min(1).max(20).optional().nullable(),
  order: z.coerce.number().int().min(0).max(200).default(0),
  isActive: z.boolean().default(true),
});

export const strandSchema = z.object({
  learningAreaId: idSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  order: z.coerce.number().int().min(0).max(200).default(0),
});

export const subStrandSchema = z.object({
  strandId: idSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  order: z.coerce.number().int().min(0).max(200).default(0),
});

/* -------------------------------- people ------------------------------- */

export const createTeacherSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: emailSchema,
  phone: optionalPhoneSchema,
  staffNumber: z.string().trim().min(1).max(30),
  tscNumber: z.string().trim().max(30).optional().nullable(),
  nationalId: z.string().trim().max(30).optional().nullable(),
  specialization: z.string().trim().max(120).optional().nullable(),
  qualifications: z.string().trim().max(300).optional().nullable(),
  employmentType: z
    .enum(['TSC_EMPLOYED', 'BOM_EMPLOYED', 'INTERN', 'VOLUNTEER', 'CONTRACT'])
    .default('TSC_EMPLOYED'),
  maxPeriodsPerDay: z.coerce.number().int().min(1).max(16).optional().nullable(),
  maxPeriodsPerWeek: z.coerce.number().int().min(1).max(80).optional().nullable(),
  prefersFreeDays: z.array(z.coerce.number().int().min(1).max(7)).max(3).default([]),
  temporaryPassword: passwordSchema.optional(),
});

export const updateTeacherSchema = createTeacherSchema.partial().omit({ temporaryPassword: true }).extend({
  isActive: z.boolean().optional(),
});

export const createParentSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: emailSchema,
  phone: phoneSchema,
  altPhone: optionalPhoneSchema,
  relationship: z.string().trim().min(2).max(40).default('Parent'),
  occupation: z.string().trim().max(120).optional().nullable(),
  addressLine: z.string().trim().max(200).optional().nullable(),
  temporaryPassword: passwordSchema.optional(),
});

export const updateParentSchema = createParentSchema.partial().omit({ temporaryPassword: true }).extend({
  isActive: z.boolean().optional(),
});

export const learnerSchema = z.object({
  admissionNumber: z.string().trim().min(1).max(30),
  upiNumber: z.string().trim().max(32).optional().nullable(),
  assessmentNumber: z.string().trim().max(32).optional().nullable(),
  firstName: z.string().trim().min(2).max(60),
  middleName: z.string().trim().max(60).optional().nullable(),
  lastName: z.string().trim().min(2).max(60),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']).default('UNDISCLOSED'),
  dateOfBirth: dateOnlySchema.optional().nullable().or(z.literal('')),
  gradeId: idSchema.optional().nullable(),
  currentClassId: idSchema.optional().nullable(),
  status: z
    .enum(['ACTIVE', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'SUSPENDED', 'DECEASED'])
    .default('ACTIVE'),
  enrolledOn: dateOnlySchema.optional().nullable().or(z.literal('')),
  specialNeeds: z.string().trim().max(500).optional().nullable(),
  medicalNotes: z.string().trim().max(500).optional().nullable(),
  homeLocation: z.string().trim().max(120).optional().nullable(),
  isBoarding: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const parentLearnerLinkSchema = z.object({
  parentProfileId: idSchema,
  learnerId: idSchema,
  relationship: z.string().trim().min(2).max(40).default('Parent'),
  isPrimaryContact: z.boolean().default(false),
  isVerified: z.boolean().default(false),
  verificationMethod: z
    .enum(['ADMIN_RECORD', 'DOCUMENT', 'ASSESSMENT_NUMBER_AND_ID'])
    .optional()
    .nullable(),
  canViewResults: z.boolean().default(true),
  canViewResources: z.boolean().default(true),
  notes: z.string().trim().max(300).optional().nullable(),
});

export const enrollmentSchema = z.object({
  learnerId: idSchema,
  classId: idSchema,
  termId: idSchema.optional().nullable(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN']).default('ACTIVE'),
  notes: z.string().trim().max(300).optional().nullable(),
});

export const bulkEnrollmentSchema = z.object({
  classId: idSchema,
  learnerIds: z.array(idSchema).min(1, 'Select at least one learner').max(200),
});

/* --------------------------- teacher assignment ------------------------ */

export const teacherAssignmentSchema = z.object({
  teacherId: idSchema,
  classId: idSchema,
  learningAreaId: idSchema,
  isPrimary: z.boolean().default(true),
  lessonsPerWeek: z.coerce.number().int().min(1).max(20).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

export const teacherAvailabilitySchema = z.object({
  teacherId: idSchema,
  // Full weekly grid replacement - simplest for the admin UI and idempotent.
  unavailable: z
    .array(
      z.object({
        dayOfWeek: z.coerce.number().int().min(1).max(7),
        periodIndex: z.coerce.number().int().min(1).max(20),
        reason: z.string().trim().max(120).optional().nullable(),
      }),
    )
    .max(200)
    .default([]),
});

export const classRequirementSchema = z.object({
  classId: idSchema,
  learningAreaId: idSchema,
  periodsPerWeek: z.coerce.number().int().min(1).max(20),
  preferDoubleLesson: z.boolean().default(false),
  preferMorning: z.boolean().default(false),
  requiredRoomId: idSchema.optional().nullable(),
});

export const bulkClassRequirementSchema = z.object({
  classIds: z.array(idSchema).min(1).max(40),
  requirements: z
    .array(
      z.object({
        learningAreaId: idSchema,
        periodsPerWeek: z.coerce.number().int().min(1).max(20),
        preferDoubleLesson: z.boolean().default(false),
        preferMorning: z.boolean().default(false),
      }),
    )
    .min(1),
});

/* ------------------------------ assessments ---------------------------- */

const assessmentBaseSchema = z.object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).optional().nullable(),
    instructions: z.string().trim().max(8000).optional().nullable(),
    academicYearId: idSchema,
    termId: idSchema,
    classId: idSchema,
    learningAreaId: idSchema,
    categoryId: idSchema,
    strandId: idSchema.optional().nullable(),
    subStrandId: idSchema.optional().nullable(),
    rubricId: idSchema.optional().nullable(),
    assessmentDate: dateOnlySchema,
    dueDate: dateOnlySchema.optional().nullable().or(z.literal('')),
    totalMarks: z.coerce.number().positive().max(10000).optional().nullable(),
    usesMarks: z.boolean().default(true),
    usesRubric: z.boolean().default(false),
    weight: z.coerce.number().min(0).max(100).optional().nullable(),
    isExternallyReported: z.boolean().default(false),
});

export const assessmentSchema = assessmentBaseSchema
  .refine((a) => a.usesMarks || a.usesRubric, {
    message: 'Choose numerical marks, rubric assessment, or both',
    path: ['usesMarks'],
  })
  .refine((a) => !a.usesMarks || (a.totalMarks ?? 0) > 0, {
    message: 'Total marks are required when numerical marks are used',
    path: ['totalMarks'],
  })
  .refine((a) => !a.subStrandId || a.strandId, {
    message: 'Select a strand before a sub-strand',
    path: ['strandId'],
  });

/** Partial form for PATCH /assessments/:id (constraints are re-checked in the service). */
export const assessmentUpdateSchema = assessmentBaseSchema.partial();

export const assessmentStatusSchema = z.object({
  status: z.enum(['DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']),
  reason: z.string().trim().max(300).optional().nullable(),
});

/** One row of the results grid. */
export const resultEntrySchema = z
  .object({
    learnerId: idSchema,
    numericScore: z.coerce.number().min(0).max(10000).nullable().optional(),
    achievementLevelId: idSchema.nullable().optional(),
    isAbsent: z.boolean().optional(),
    isExcused: z.boolean().optional(),
    comment: z.string().trim().max(1000).nullable().optional(),
    rubricScores: z
      .array(
        z.object({
          criterionId: idSchema,
          levelId: idSchema.nullable().optional(),
          score: z.coerce.number().min(0).max(1000).nullable().optional(),
          comment: z.string().trim().max(500).nullable().optional(),
        }),
      )
      .optional(),
  })
  .refine((r) => !(r.isAbsent && r.isExcused), { message: 'A result cannot be both absent and excused' });

export const bulkResultEntrySchema = z.object({
  results: z.array(resultEntrySchema).min(1, 'Provide at least one result').max(300),
  saveAsDraft: z.boolean().default(true),
});

export const publishResultsSchema = z.object({
  notifyParents: z.boolean().default(true),
  publishFeedback: z.boolean().default(true),
});

export const amendResultSchema = z.object({
  numericScore: z.coerce.number().min(0).max(10000).nullable().optional(),
  achievementLevelId: idSchema.nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().min(5, 'Explain the correction (stored in the audit trail)').max(400),
  notifyParents: z.boolean().default(true),
});

export const feedbackSchema = z.object({
  resultId: idSchema,
  narrative: z.string().trim().min(3).max(2000),
  isPublished: z.boolean().default(false),
});

/* -------------------------------- rubrics ------------------------------ */

export const rubricSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  learningAreaId: idSchema.optional().nullable(),
  isTemplate: z.boolean().default(false),
  criteria: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(160),
        description: z.string().trim().max(600).optional().nullable(),
        maxScore: z.coerce.number().min(0).max(1000).optional().nullable(),
        weight: z.coerce.number().min(0).max(100).optional().nullable(),
        levels: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              score: z.coerce.number().min(0).max(1000),
              description: z.string().trim().max(400).optional().nullable(),
            }),
          )
          .min(1, 'Add at least one achievement level per criterion')
          .max(6),
      }),
    )
    .min(1, 'Add at least one criterion')
    .max(20),
});

/* ------------------------------- resources ----------------------------- */

const learningResourceBaseSchema = z.object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional().nullable(),
    body: z.string().trim().max(20000).optional().nullable(),
    type: z.enum(['NOTE', 'FILE', 'LINK', 'ASSIGNMENT', 'ANNOUNCEMENT']).default('NOTE'),
    classId: idSchema,
    learningAreaId: idSchema,
    fileId: idSchema.optional().nullable(),
    externalUrl: z.string().trim().url('Enter a full URL').max(500).optional().nullable().or(z.literal('')),
    dueDate: dateOnlySchema.optional().nullable().or(z.literal('')),
    visibleToParents: z.boolean().default(true),
  publishNow: z.boolean().default(true),
});

export const learningResourceSchema = learningResourceBaseSchema
  .refine((r) => r.type !== 'FILE' || !!r.fileId, { message: 'Attach a file', path: ['fileId'] })
  .refine((r) => r.type !== 'LINK' || !!r.externalUrl, { message: 'Provide a link', path: ['externalUrl'] });

export const learningResourceUpdateSchema = learningResourceBaseSchema.partial();

export const assignmentSchema = z.object({
  title: z.string().trim().min(3).max(160),
  instructions: z.string().trim().max(8000).optional().nullable(),
  classId: idSchema,
  learningAreaId: idSchema,
  resourceId: idSchema.optional().nullable(),
  dueDate: dateOnlySchema.optional().nullable().or(z.literal('')),
  maxScore: z.coerce.number().min(0).max(1000).optional().nullable(),
  publishNow: z.boolean().default(true),
});

/* ------------------------------ timetable ------------------------------ */

const timetablePeriodBaseSchema = z.object({
    dayOfWeek: z.coerce.number().int().min(1).max(7),
    sequence: z.coerce.number().int().min(1).max(30),
    label: z.string().trim().min(1).max(40),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    isBreak: z.boolean().default(false),
  isLunch: z.boolean().default(false),
});

export const timetablePeriodSchema = timetablePeriodBaseSchema.refine((p) => p.startTime < p.endTime, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

export const timetableBellScheduleSchema = z.object({
  academicYearId: idSchema,
  termId: idSchema.optional().nullable(),
  periods: z.array(timetablePeriodSchema).min(1, 'Define at least one period').max(200),
});

export const timetableSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  academicYearId: idSchema,
  termId: idSchema,
  scope: z.enum(['WHOLE_SCHOOL', 'GRADE', 'CLASS']).default('WHOLE_SCHOOL'),
  gradeId: idSchema.optional().nullable(),
  /** Soft-constraint weights and preferences. */
  config: z
    .object({
      seed: z.coerce.number().int().optional(),
      timeLimitMs: z.coerce.number().int().min(500).max(60000).default(12000),
      maxConsecutiveSameArea: z.coerce.number().int().min(1).max(5).default(2),
      maxConsecutiveTeacherPeriods: z.coerce.number().int().min(1).max(10).default(4),
      maxPeriodsPerDayPerClass: z.coerce.number().int().min(1).max(14).default(8),
      respectTeacherFreeDays: z.boolean().default(true),
      useRooms: z.boolean().default(false),
      balanceDailyLoad: z.boolean().default(true),
      avoidTeacherGaps: z.boolean().default(true),
      preferDoubleLessons: z.boolean().default(false),
      teacherGapPenalty: z.coerce.number().min(0).max(50).default(3),
      classGapPenalty: z.coerce.number().min(0).max(50).default(5),
      sameSubjectSameDayPenalty: z.coerce.number().min(0).max(50).default(8),
      consecutiveSameSubjectPenalty: z.coerce.number().min(0).max(50).default(10),
      teacherConsecutivePenalty: z.coerce.number().min(0).max(50).default(2),
      balanceDailyLoadPenalty: z.coerce.number().min(0).max(50).default(4),
    })
    .default({}),
});

export const generateTimetableSchema = z.object({
  timetableId: idSchema.optional(),
  academicYearId: idSchema,
  termId: idSchema,
  classIds: z.array(idSchema).min(1, 'Select at least one class').max(80),
  name: z.string().trim().min(3).max(120).optional(),
  keepLockedEntries: z.boolean().default(true),
  basedOnVersionId: idSchema.optional().nullable(),
  config: timetableSchema.shape.config,
});

export const timetableEntrySchema = z.object({
  classId: idSchema,
  learningAreaId: idSchema,
  teacherId: idSchema.nullable().optional(),
  periodId: idSchema,
  roomId: idSchema.nullable().optional(),
  isDoubleLesson: z.boolean().default(false),
  isLocked: z.boolean().default(false),
  note: z.string().trim().max(300).optional().nullable(),
});

export const timetableEntryMoveSchema = z.object({
  versionId: idSchema,
  entryId: idSchema,
  targetPeriodId: idSchema.optional(),
  targetDayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
  targetSequence: z.coerce.number().int().min(1).max(30).optional(),
  teacherId: idSchema.nullable().optional(),
  roomId: idSchema.nullable().optional(),
  /** Admin acknowledges a soft warning (never a hard conflict). */
  acknowledgeWarnings: z.boolean().default(false),
  reason: z.string().trim().max(300).optional().nullable(),
});

export const timetablePublishSchema = z.object({
  versionId: idSchema,
  force: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
  notify: z.boolean().default(true),
});

export const roomSchema = z.object({
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().max(20).optional().nullable(),
  kind: z.enum(['CLASSROOM', 'LABORATORY', 'WORKSHOP', 'LIBRARY', 'HALL', 'FIELD', 'OTHER']).default('CLASSROOM'),
  capacity: z.coerce.number().int().min(1).max(1000).optional().nullable(),
  isActive: z.boolean().default(true),
});

/* ------------------------------ notifications -------------------------- */

export const notificationQuerySchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().optional(),
});

/* ------------------------------ submissions ---------------------------- */

/**
 * A submission is always made on behalf of a learner by a signed-in adult
 * (a guardian, or a teacher recording work handed in on paper). Learners have
 * no accounts, so `learnerId` is explicit rather than implied by the session.
 */
export const submissionCreateSchema = z
  .object({
    assignmentId: idSchema,
    learnerId: idSchema,
    note: z.string().trim().max(2000).optional().nullable(),
    fileId: idSchema.optional().nullable(),
    linkUrl: z.string().trim().url('Enter a full URL').max(500).optional().nullable().or(z.literal('')),
  })
  .refine((v) => !!(v.fileId || v.linkUrl || (v.note && v.note.trim().length >= 3)), {
    message: 'Attach a file, add a link, or write a note describing the work handed in',
    path: ['fileId'],
  });

export const submissionReviewSchema = z
  .object({
    status: z.enum(['REVIEWED', 'ACCEPTED', 'RETURNED']),
    score: z.coerce.number().min(0).max(1000).optional().nullable(),
    feedback: z.string().trim().max(2000).optional().nullable(),
    returnedReason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== 'RETURNED' || (v.returnedReason && v.returnedReason.length >= 3), {
    message: 'Tell the guardian what needs to be redone',
    path: ['returnedReason'],
  });

export const submissionQuerySchema = paginationSchema.extend({
  assignmentId: idSchema.optional(),
  learnerId: idSchema.optional(),
  classId: idSchema.optional(),
  status: z.enum(['SUBMITTED', 'LATE', 'RETURNED', 'REVIEWED', 'ACCEPTED']).optional(),
});

/* -------------------------- notification preferences ------------------- */

/**
 * The notification types the product can emit (mirrors the Prisma enum).
 *
 * Exported as a value so the screen that renders the mute switches and the schema
 * that validates them cannot drift apart: a typo now fails validation loudly
 * instead of silently muting nothing.
 */
export const NOTIFICATION_TYPE_VALUES = [
  'ASSESSMENT_PUBLISHED',
  'NEW_RESOURCE',
  'NEW_ASSIGNMENT',
  'ASSIGNMENT_SUBMITTED',
  'SUBMISSION_REVIEWED',
  'TEACHER_FEEDBACK',
  'TIMETABLE_PUBLISHED',
  'TIMETABLE_CHANGED',
  'SCHOOL_ANNOUNCEMENT',
  'ACCOUNT',
] as const;

export type NotificationTypeValue = (typeof NOTIFICATION_TYPE_VALUES)[number];

export const notificationPreferenceSchema = z.object({
  inAppEnabled: z.boolean().default(true),
  emailEnabled: z.boolean().default(false),
  emailAddress: z.string().trim().email('Enter a valid email address').max(160).optional().nullable().or(z.literal('')),
  mutedTypes: z
    .array(z.enum(NOTIFICATION_TYPE_VALUES, { errorMap: () => ({ message: 'Unknown notification type.' }) }))
    .max(40)
    .default([]),
});

/* -------------------- platform school administration ------------------ */

export const platformSchoolCreateSchema = z.object({
  school: z.object({
    name: z.string().trim().min(3).max(120),
    code: z.string().trim().max(32).regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, numbers or hyphens').optional().nullable().or(z.literal('')),
    addressLine: z.string().trim().max(240).optional().nullable(),
    county: z.string().trim().max(80).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
    website: z.string().trim().url().max(200).optional().nullable().or(z.literal('')),
    motto: z.string().trim().max(180).optional().nullable(),
    timezone: z.string().trim().min(3).max(64).default('Africa/Nairobi'),
  }),
  admin: z.object({ email: emailSchema, fullName: z.string().trim().min(2).max(120) }),
});

export const platformSchoolUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  code: z.string().trim().max(32).regex(/^[A-Z0-9-]+$/).optional().nullable().or(z.literal('')),
  addressLine: z.string().trim().max(240).optional().nullable(),
  county: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
  website: z.string().trim().url().max(200).optional().nullable().or(z.literal('')),
  motto: z.string().trim().max(180).optional().nullable(),
  timezone: z.string().trim().min(3).max(64).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

export const schoolStatusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  reason: z.string().trim().min(3).max(500),
});

/* ---------------------- class teacher workflows ----------------------- */

export const classTeacherAssignmentSchema = z.object({
  teacherId: idSchema,
  classId: idSchema,
  effectiveFrom: dateOnlySchema.optional(),
  changeReason: z.string().trim().max(500).optional().nullable(),
});

export const classTeacherInterventionSchema = z.object({
  learnerId: idSchema,
  classId: idSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ON_HOLD']).default('OPEN'),
  dueDate: dateOnlySchema.optional().nullable(),
});

export const classTeacherInterventionUpdateSchema = classTeacherInterventionSchema
  .omit({ learnerId: true, classId: true })
  .partial();

export const classReportNarrativeSchema = z.object({
  teacherComment: z.string().trim().max(2000).optional().nullable(),
  strengths: z.string().trim().max(1200).optional().nullable(),
  supportPlan: z.string().trim().max(1200).optional().nullable(),
});

/* ------------------------------ helper types --------------------------- */

export type LoginInput = z.infer<typeof loginSchema>;
export type SchoolProfileInput = z.infer<typeof schoolProfileSchema>;
export type ClassInput = z.infer<typeof classSchema>;
export type LearnerInput = z.infer<typeof learnerSchema>;
export type AssessmentInput = z.infer<typeof assessmentSchema>;
export type AssessmentUpdateInput = z.infer<typeof assessmentUpdateSchema>;
export type ResultEntryInput = z.infer<typeof resultEntrySchema>;
export type GenerateTimetableInput = z.infer<typeof generateTimetableSchema>;
export type SchoolRegistrationInput = z.infer<typeof schoolRegistrationSchema>;
export type ParentRegistrationInput = z.infer<typeof parentRegistrationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;

export * from './timetable-rules';
