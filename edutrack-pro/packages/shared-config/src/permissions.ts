/**
 * Timetable scheduling defaults + tunable soft-constraint weights.
 * Admin-editable per timetable via `config` JSON; these are the fallbacks.
 */
export const SCHEDULING_DEFAULTS = {
  maxConsecutivePeriodsPerLearningArea: 2,
  maxConsecutivePeriodsPerTeacher: 4,
  maxPeriodsPerDayPerClass: 8,
  minPeriodsBetweenRepeats: 1,
  teacherGapPenalty: 3,
  classGapPenalty: 5,
  sameSubjectSameDayPenalty: 8,
  consecutiveSameSubjectPenalty: 10,
  teacherConsecutivePenalty: 2,
  balanceDailyLoadPenalty: 4,
  moveStabilityBonus: 6,
  preferMorningWeight: 2,
  randomTieBreakSeedDefault: 20260101,
} as const;

export const TIMETABLE_HARD_CONSTRAINT_CODES = [
  'TEACHER_DOUBLE_BOOKED',
  'CLASS_DOUBLE_BOOKED',
  'ROOM_DOUBLE_BOOKED',
  'LESSON_IN_BREAK',
  'LESSON_OUTSIDE_SCHOOL_HOURS',
  'TEACHER_UNAVAILABLE',
  'TEACHER_WORKLOAD_DAILY_EXCEEDED',
  'TEACHER_WORKLOAD_WEEKLY_EXCEEDED',
  'MISSING_TEACHER_ASSIGNMENT',
  'INVALID_ENROLLMENT',
  'LEARNER_DOUBLE_BOOKED',
] as const;

export const TIMETABLE_SOFT_CONSTRAINT_CODES = [
  'PERIODS_UNDER_ALLOCATED',
  'PERIODS_OVER_ALLOCATED',
  'NO_FEASIBLE_SLOT',
] as const;

export type SchedulingDefaults = typeof SCHEDULING_DEFAULTS;
