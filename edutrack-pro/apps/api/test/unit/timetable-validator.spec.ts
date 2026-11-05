import { validateTimetable, type ValidatorEntry } from '../../src/modules/timetables/timetable-validator';
import { assignmentsFor, periodsFor } from '../support/timetable-fixtures';

const periods = periodsFor([1, 2, 3]);
const requirements = [
  { classId: 'c1', learningAreaId: 'mat', periodsPerWeek: 4 },
  { classId: 'c1', learningAreaId: 'eng', periodsPerWeek: 3 },
  { classId: 'c2', learningAreaId: 'mat', periodsPerWeek: 4 },
  { classId: 'c2', learningAreaId: 'eng', periodsPerWeek: 3 },
  { classId: 'c2', learningAreaId: 'sci', periodsPerWeek: 2 },
];
const teachers = [
  { id: 't1', name: 'Amina Kiptoo', maxPeriodsPerDay: 5, maxPeriodsPerWeek: 30, unavailable: [] as { dayOfWeek: number; periodIndex: number }[] },
  { id: 't2', name: 'Brian Otieno', maxPeriodsPerDay: 5, maxPeriodsPerWeek: 30, unavailable: [] as { dayOfWeek: number; periodIndex: number }[] },
  { id: 't3', name: 'Chebet Kones', maxPeriodsPerDay: 5, maxPeriodsPerWeek: 30, unavailable: [] as { dayOfWeek: number; periodIndex: number }[] },
];

function entry(partial: Partial<ValidatorEntry> & { id: string; classId: string; periodId: string }): ValidatorEntry {
  const period = periods.find((p) => p.id === partial.periodId)!;
  return {
    learningAreaId: 'mat',
    teacherId: 't1',
    roomId: null,
    dayOfWeek: period.dayOfWeek,
    sequence: period.sequence,
    ...partial,
  };
}

function validate(entries: ValidatorEntry[], overrides: Partial<Parameters<typeof validateTimetable>[0]> = {}) {
  return validateTimetable({
    entries,
    periods,
    workingDays: [1, 2, 3],
    requirements,
    teachers,
    assignments: assignmentsFor(),
    rooms: [],
    ...overrides,
  });
}

describe('validateTimetable — hard constraint detection (unit)', () => {
  it('reports no conflicts for a clean timetable', () => {
    const clean = [
      entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', learningAreaId: 'mat', teacherId: 't1' }),
      entry({ id: 'e2', classId: 'c1', periodId: 'p1-2', learningAreaId: 'eng', teacherId: 't2' }),
      entry({ id: 'e3', classId: 'c2', periodId: 'p1-4', learningAreaId: 'mat', teacherId: 't1' }),
    ];
    const result = validate(clean, {
      requirements: [{ classId: 'c1', learningAreaId: 'mat', periodsPerWeek: 1 }, { classId: 'c1', learningAreaId: 'eng', periodsPerWeek: 1 }, { classId: 'c2', learningAreaId: 'mat', periodsPerWeek: 1 }],
      enrollments: [],
    });
    expect(result.conflicts).toEqual([]);
    expect(result.summary.errors).toBe(0);
  });

  it('detects a class double-booked in the same period', () => {
    const result = validate([
      entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', learningAreaId: 'mat', teacherId: 't1' }),
      entry({ id: 'e2', classId: 'c1', periodId: 'p1-1', learningAreaId: 'eng', teacherId: 't2' }),
    ]);
    expect(result.conflicts.some((c) => c.code === 'CLASS_DOUBLE_BOOKED')).toBe(true);
  });

  it('detects a teacher double-booked across classes', () => {
    const result = validate([
      entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', teacherId: 't1' }),
      entry({ id: 'e2', classId: 'c2', periodId: 'p1-1', teacherId: 't1' }),
    ]);
    expect(result.conflicts.some((c) => c.code === 'TEACHER_DOUBLE_BOOKED')).toBe(true);
  });

  it('detects a room double-booking when rooms are used', () => {
    const result = validate([
      entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', roomId: 'lab' }),
      entry({ id: 'e2', classId: 'c2', periodId: 'p1-1', roomId: 'lab' }),
    ]);
    expect(result.conflicts.some((c) => c.code === 'ROOM_DOUBLE_BOOKED')).toBe(true);
  });

  it('detects a lesson placed in a break period', () => {
    const result = validate([entry({ id: 'e1', classId: 'c1', periodId: 'p1-3' })]);
    const conflict = result.conflicts.find((c) => c.code === 'LESSON_IN_BREAK');
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe('ERROR');
    expect(conflict!.suggestion).toBeTruthy();
  });

  it('detects a lesson outside school hours', () => {
    const outside = [...periods.map((p) => ({ ...p }))];
    outside.push({ id: 'p1-99', dayOfWeek: 1, sequence: 9, label: 'After school', startTime: '18:00', endTime: '18:40', isTeaching: true, isBreak: false, isLunch: false });
    const result = validateTimetable({
      entries: [{ id: 'e1', classId: 'c1', learningAreaId: 'mat', teacherId: 't1', roomId: null, periodId: 'p1-99', dayOfWeek: 1, sequence: 9 }],
      periods: outside,
      workingDays: [1, 2, 3],
      requirements: [{ classId: 'c1', learningAreaId: 'mat', periodsPerWeek: 1 }],
      teachers,
      assignments: assignmentsFor(),
      rooms: [],
      // The school day runs 07:30–15:30; an 18:00 period is outside it.
      schoolOpenTime: '07:30',
      schoolCloseTime: '15:30',
    });
    expect(result.conflicts.some((c) => c.code === 'LESSON_OUTSIDE_SCHOOL_HOURS')).toBe(true);
  });

  it('detects a lesson on a day the school does not open', () => {
    const result = validate([entry({ id: 'e1', classId: 'c1', periodId: 'p1-1' })], {
      workingDays: [2, 3],
      requirements: [{ classId: 'c1', learningAreaId: 'mat', periodsPerWeek: 1 }],
    });
    expect(result.conflicts.some((c) => c.code === 'LESSON_OUTSIDE_SCHOOL_HOURS')).toBe(true);
  });

  it('detects a teacher scheduled when they are unavailable', () => {
    const result = validate(
      [entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', teacherId: 't1' })],
      { teachers: [{ ...teachers[0]!, unavailable: [{ dayOfWeek: 1, periodIndex: 1 }] }, teachers[1]!, teachers[2]!] },
    );
    const conflict = result.conflicts.find((c) => c.code === 'TEACHER_UNAVAILABLE');
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe('ERROR');
  });

  it('detects a weekly workload breach', () => {
    const entries = [
      entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', teacherId: 't1' }),
      entry({ id: 'e2', classId: 'c1', periodId: 'p1-2', teacherId: 't1' }),
      entry({ id: 'e3', classId: 'c1', periodId: 'p1-4', teacherId: 't1' }),
    ];
    const result = validate(entries, { teachers: [{ ...teachers[0]!, maxPeriodsPerWeek: 2 }, teachers[1]!, teachers[2]!] });
    expect(result.conflicts.some((c) => c.code === 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED')).toBe(true);
  });

  it('detects an under-allocated learning area', () => {
    const result = validateTimetable({
      entries: [entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', learningAreaId: 'mat', teacherId: 't1' })],
      periods,
      workingDays: [1, 2, 3],
      requirements: [
        { classId: 'c1', learningAreaId: 'mat', periodsPerWeek: 1 },
        { classId: 'c1', learningAreaId: 'eng', learningAreaName: 'English', periodsPerWeek: 3 },
      ],
      teachers,
      assignments: assignmentsFor(),
      rooms: [],
      enrollments: [],
    });
    const conflict = result.conflicts.find((c) => c.code === 'PERIODS_UNDER_ALLOCATED' && c.learningAreaId === 'eng');
    expect(conflict).toBeDefined();
    expect(conflict!.message).toContain('English');
  });

  it('detects a lesson whose teacher is not assigned to that class and area', () => {
    const result = validate([entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', learningAreaId: 'sci', teacherId: 't3' })]);
    expect(result.conflicts.some((c) => c.code === 'MISSING_TEACHER_ASSIGNMENT' || c.code === 'UNASSIGNED_LEARNING_AREA')).toBe(true);
  });

  it('flags a learner enrolled in two classes that are timetabled at the same time', () => {
    const result = validate(
      [
        entry({ id: 'e1', classId: 'c1', periodId: 'p1-1', learningAreaId: 'mat', teacherId: 't1' }),
        entry({ id: 'e2', classId: 'c2', periodId: 'p1-1', learningAreaId: 'mat', teacherId: 't2' }),
      ],
      { enrollments: [{ learnerId: 'l1', learnerName: 'Achieng O.', classIds: ['c1', 'c2'] }] },
    );
    expect(result.conflicts.some((c) => c.code === 'LEARNER_DOUBLE_BOOKED' || c.code === 'INVALID_ENROLLMENT')).toBe(true);
  });

  it('summarises conflicts by code and severity for the UI conflict panel', () => {
    const result = validate([entry({ id: 'e1', classId: 'c1', periodId: 'p1-3' })]);
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.summary.byCode.LESSON_IN_BREAK).toBeGreaterThan(0);
  });
});
