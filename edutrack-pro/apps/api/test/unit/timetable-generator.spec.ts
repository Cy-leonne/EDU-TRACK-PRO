import { TimetableGenerator } from '../../src/modules/timetables/timetable-generator';
import { assignmentsFor, configFor, periodsFor, requirementsFor, teachersFor } from '../support/timetable-fixtures';

/**
 * Hard constraints from the specification. The engine must never emit a
 * timetable that breaks one of these — a violation here is a bug, not a warning.
 */
function run(options: Parameters<typeof buildGenerator>[0] = {}) {
  return buildGenerator(options).run();
}

function buildGenerator(options: {
  days?: number[];
  requirements?: ReturnType<typeof requirementsFor>;
  assignments?: ReturnType<typeof assignmentsFor>;
  teachers?: ReturnType<typeof teachersFor>;
  config?: Parameters<typeof configFor>[0];
} = {}) {
  const periods = periodsFor(options.days ?? [1, 2, 3]);
  return new TimetableGenerator({
    periods,
    requirements: options.requirements ?? requirementsFor(),
    assignments: options.assignments ?? assignmentsFor(),
    teachers: options.teachers ?? teachersFor(),
    rooms: [],
    config: configFor(options.config),
  });
}

describe('TimetableGenerator — hard constraints (unit)', () => {
  it('places every required lesson when the configuration is feasible', () => {
    const result = run();
    expect(result.stats.lessonsRequired).toBe(16); // c1: 7, c2: 9
    expect(result.stats.lessonsUnplaced).toBe(0);
    expect(result.diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    expect(result.feasibility.feasible).toBe(true);
  });

  it('never double-books a class', () => {
    const slots = run().entries.map((e) => `${e.classId}|${e.periodId}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('never double-books a teacher', () => {
    const slots = run().entries.filter((e) => e.teacherId).map((e) => `${e.teacherId}|${e.periodId}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('never schedules a lesson in a break, lunch or non-teaching period', () => {
    const periods = periodsFor();
    const teachingIds = new Set(periods.filter((p) => p.isTeaching && !p.isBreak && !p.isLunch).map((p) => p.id));
    for (const entry of run().entries) expect(teachingIds.has(entry.periodId)).toBe(true);
  });

  it('keeps every lesson inside the configured school day', () => {
    const periods = periodsFor();
    const byId = new Map(periods.map((p) => [p.id, p]));
    for (const entry of run().entries) {
      const period = byId.get(entry.periodId)!;
      expect(period.startTime >= '07:30').toBe(true);
      expect(period.endTime <= '10:30').toBe(true);
    }
  });

  it('respects teacher availability windows', () => {
    const teachers = teachersFor([
      { id: 't1', unavailable: [{ dayOfWeek: 2, periodIndex: 1 }, { dayOfWeek: 2, periodIndex: 2 }] },
    ]);
    const result = run({ teachers });
    const offender = result.entries.find((e) => e.teacherId === 't1' && e.dayOfWeek === 2 && (e.sequence === 1 || e.sequence === 2));
    expect(offender).toBeUndefined();
  });

  it('respects the class daily lesson cap', () => {
    const result = run({ config: { maxPeriodsPerDayPerClass: 3 } });
    const perDay = new Map<string, number>();
    for (const entry of result.entries) {
      const key = `${entry.classId}|${entry.dayOfWeek}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
  });

  it('never exceeds a teacher’s weekly workload limit', () => {
    // t1 needs 8 periods but is capped at 4.
    const teachers = teachersFor([{ id: 't1', maxPeriodsPerWeek: 4 }]);
    const result = run({ teachers });
    const t1Count = result.entries.filter((e) => e.teacherId === 't1').length;
    expect(t1Count).toBeLessThanOrEqual(4);
    expect(result.stats.lessonsUnplaced).toBeGreaterThan(0);
  });

  it('never exceeds a teacher’s daily limit', () => {
    const teachers = teachersFor([{ id: 't2', maxPeriodsPerDay: 2 }]);
    const result = run({ teachers });
    const perDay = new Map<string, number>();
    for (const entry of result.entries.filter((e) => e.teacherId === 't2')) {
      perDay.set(`${entry.dayOfWeek}`, (perDay.get(`${entry.dayOfWeek}`) ?? 0) + 1);
    }
    for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(2);
  });

  it('reports actionable diagnostics when a lesson has no teacher assigned', () => {
    const assignments = assignmentsFor().filter((a) => !(a.classId === 'c2' && a.learningAreaId === 'sci'));
    const result = run({ assignments });
    const missing = result.diagnostics.find((d) => d.code === 'MISSING_TEACHER_ASSIGNMENT');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('ERROR');
    expect(missing!.suggestion).toBeTruthy();
    expect(result.entries.some((e) => e.learningAreaId === 'sci')).toBe(false);
  });

  it('explains why lessons could not be placed (never silently drops them)', () => {
    const teachers = teachersFor([{ id: 't1', maxPeriodsPerWeek: 0 }]);
    const result = run({ teachers });
    expect(result.stats.lessonsUnplaced).toBe(8); // all Mathematics lessons
    const codes = new Set(result.diagnostics.map((d) => d.code));
    expect(codes.has('NO_FEASIBLE_SLOT') || codes.has('TEACHER_WORKLOAD_WEEKLY_EXCEEDED')).toBe(true);
    for (const diagnostic of result.diagnostics) expect(diagnostic.suggestion).toBeTruthy();
  });

  it('is deterministic: the same configuration always produces the same timetable', () => {
    const first = run().entries.map((e) => `${e.classId}|${e.learningAreaId}|${e.periodId}`);
    const second = run().entries.map((e) => `${e.classId}|${e.learningAreaId}|${e.periodId}`);
    expect(second).toEqual(first);
  });

  it('produces a different arrangement when the tie-break seed changes', () => {
    const first = run({ config: { seed: 1 } }).entries.map((e) => `${e.classId}|${e.learningAreaId}|${e.periodId}`).join(',');
    const second = run({ config: { seed: 99, timeBudgetMs: 3000 } }).entries.map((e) => `${e.classId}|${e.learningAreaId}|${e.periodId}`).join(',');
    expect(second).not.toEqual(first);
  });

  it('spreads a learning area across different days instead of stacking it', () => {
    const result = run();
    const matDays = new Set(result.entries.filter((e) => e.classId === 'c1' && e.learningAreaId === 'mat').map((e) => e.dayOfWeek));
    expect(matDays.size).toBeGreaterThan(1);
  });
});
