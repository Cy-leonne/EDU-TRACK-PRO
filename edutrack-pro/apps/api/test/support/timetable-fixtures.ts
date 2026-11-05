import type {
  GeneratorAssignment, GeneratorConfig, GeneratorPeriod, GeneratorRequirement, GeneratorTeacher,
} from '../../src/modules/timetables/timetable-generator';
import { SCHEDULING_DEFAULTS } from '@edutrack/shared-config';

/**
 * A deliberately small but complete school used by the scheduling tests:
 * 3 working days x 4 teaching periods (with a break in the middle), 2 classes,
 * 3 learning areas and 3 teachers.
 */
export interface FixtureOptions {
  days?: number[];
  teacherOverrides?: Partial<GeneratorTeacher>[];
  requirementOverrides?: Partial<GeneratorRequirement>[];
}

export function periodsFor(days: number[] = [1, 2, 3]): (GeneratorPeriod & { label: string })[] {
  const grid = [
    { sequence: 1, label: 'Period 1', start: '07:30', end: '08:10', teaching: true },
    { sequence: 2, label: 'Period 2', start: '08:10', end: '08:50', teaching: true },
    { sequence: 3, label: 'Break', start: '08:50', end: '09:10', teaching: false },
    { sequence: 4, label: 'Period 3', start: '09:10', end: '09:50', teaching: true },
    { sequence: 5, label: 'Period 4', start: '09:50', end: '10:30', teaching: true },
  ];
  const periods: (GeneratorPeriod & { label: string })[] = [];
  for (const day of days) {
    for (const slot of grid) {
      periods.push({
        id: `p${day}-${slot.sequence}`,
        dayOfWeek: day,
        sequence: slot.sequence,
        label: slot.label,
        startTime: slot.start,
        endTime: slot.end,
        isTeaching: slot.teaching,
        isBreak: !slot.teaching,
        isLunch: false,
      });
    }
  }
  return periods;
}

export function requirementsFor(overrides: Partial<GeneratorRequirement>[] = []): GeneratorRequirement[] {
  const base: GeneratorRequirement[] = [
    { classId: 'c1', className: 'Grade 7 A', learningAreaId: 'mat', learningAreaName: 'Mathematics', periodsPerWeek: 4, preferDoubleLesson: false, preferMorning: true, requiredRoomId: null },
    { classId: 'c1', className: 'Grade 7 A', learningAreaId: 'eng', learningAreaName: 'English', periodsPerWeek: 3, preferDoubleLesson: false, preferMorning: true, requiredRoomId: null },
    { classId: 'c2', className: 'Grade 7 B', learningAreaId: 'mat', learningAreaName: 'Mathematics', periodsPerWeek: 4, preferDoubleLesson: false, preferMorning: true, requiredRoomId: null },
    { classId: 'c2', className: 'Grade 7 B', learningAreaId: 'eng', learningAreaName: 'English', periodsPerWeek: 3, preferDoubleLesson: false, preferMorning: true, requiredRoomId: null },
    { classId: 'c2', className: 'Grade 7 B', learningAreaId: 'sci', learningAreaName: 'Integrated Science', periodsPerWeek: 2, preferDoubleLesson: false, preferMorning: false, requiredRoomId: null },
  ];
  return base.map((row) => ({ ...row, ...(overrides.find((o) => o.classId === row.classId && o.learningAreaId === row.learningAreaId) ?? {}) }));
}

export function assignmentsFor(): GeneratorAssignment[] {
  return [
    { classId: 'c1', learningAreaId: 'mat', teacherId: 't1', teacherName: 'Amina Kiptoo' },
    { classId: 'c1', learningAreaId: 'eng', teacherId: 't2', teacherName: 'Brian Otieno' },
    { classId: 'c2', learningAreaId: 'mat', teacherId: 't1', teacherName: 'Amina Kiptoo' },
    { classId: 'c2', learningAreaId: 'eng', teacherId: 't2', teacherName: 'Brian Otieno' },
    { classId: 'c2', learningAreaId: 'sci', teacherId: 't3', teacherName: 'Chebet Kones' },
  ];
}

export function teachersFor(overrides: Partial<GeneratorTeacher>[] = []): GeneratorTeacher[] {
  const assignments = assignmentsFor();
  const base: GeneratorTeacher[] = [
    { id: 't1', name: 'Amina Kiptoo', maxPeriodsPerDay: 5, maxPeriodsPerWeek: 30, prefersFreeDays: [], unavailable: [], assignments: [] },
    { id: 't2', name: 'Brian Otieno', maxPeriodsPerDay: 5, maxPeriodsPerWeek: 30, prefersFreeDays: [], unavailable: [], assignments: [] },
    { id: 't3', name: 'Chebet Kones', maxPeriodsPerDay: 5, maxPeriodsPerWeek: 30, prefersFreeDays: [], unavailable: [], assignments: [] },
  ];
  return base.map((teacher) => ({
    ...teacher,
    assignments: assignments.filter((a) => a.teacherId === teacher.id).map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId })),
    ...(overrides.find((o) => o.id === teacher.id) ?? {}),
  }));
}

export function configFor(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    seed: SCHEDULING_DEFAULTS.randomTieBreakSeedDefault,
    maxConsecutiveSameArea: SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerLearningArea,
    maxConsecutiveTeacherPeriods: SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerTeacher,
    maxPeriodsPerDayPerClass: 4,
    respectTeacherFreeDays: true,
    useRooms: false,
    balanceDailyLoad: true,
    avoidTeacherGaps: true,
    preferDoubleLessons: false,
    teacherGapPenalty: SCHEDULING_DEFAULTS.teacherGapPenalty,
    classGapPenalty: SCHEDULING_DEFAULTS.classGapPenalty,
    sameSubjectSameDayPenalty: SCHEDULING_DEFAULTS.sameSubjectSameDayPenalty,
    consecutiveSameSubjectPenalty: SCHEDULING_DEFAULTS.consecutiveSameSubjectPenalty,
    teacherConsecutivePenalty: SCHEDULING_DEFAULTS.teacherConsecutivePenalty,
    balanceDailyLoadPenalty: SCHEDULING_DEFAULTS.balanceDailyLoadPenalty,
    moveStabilityBonus: SCHEDULING_DEFAULTS.moveStabilityBonus,
    timeBudgetMs: 3000,
    ...overrides,
  };
}
