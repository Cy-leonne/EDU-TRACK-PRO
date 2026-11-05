/**
 * Pure, dependency-free timetable rule helpers.
 * Shared by the server-side generator/validator and by the web UI so that the
 * grid can warn before a request is even sent. Unit-tested in the API test
 * suite (see apps/api/test/unit/timetable-rules.spec.ts).
 */
import { SCHEDULING_DEFAULTS } from '@edutrack/shared-config';

export interface PeriodLike {
  id: string;
  label?: string;
  dayOfWeek: number;
  sequence: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  isLunch: boolean;
  isTeaching: boolean;
}

export interface EntryLike {
  id: string;
  classId: string;
  learningAreaId: string;
  teacherId: string | null;
  roomId: string | null;
  periodId: string;
  dayOfWeek: number;
  sequence: number;
  isLocked?: boolean;
}

export interface AvailabilityLike {
  teacherId: string;
  dayOfWeek: number;
  periodIndex: number;
  isAvailable: boolean;
}

export interface SlotKey { classId: string; dayOfWeek: number; sequence: number }

export function slotKey(k: SlotKey): string {
  return `${k.classId}|${k.dayOfWeek}|${k.sequence}`;
}

export function isTeachingPeriod(period: PeriodLike): boolean {
  return period.isTeaching && !period.isBreak && !period.isLunch;
}

/** Hard rule: a teacher may hold at most one lesson per (day, sequence). */
export function findTeacherClashes(entries: EntryLike[]): { teacherId: string; dayOfWeek: number; sequence: number; entryIds: string[] }[] {
  const map = new Map<string, EntryLike[]>();
  for (const e of entries) {
    if (!e.teacherId) continue;
    const key = `${e.teacherId}|${e.dayOfWeek}|${e.sequence}`;
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  const out: { teacherId: string; dayOfWeek: number; sequence: number; entryIds: string[] }[] = [];
  for (const [key, list] of map) {
    if (list.length > 1) {
      const [teacherId, day, seq] = key.split('|');
      out.push({
        teacherId: teacherId as string,
        dayOfWeek: Number(day),
        sequence: Number(seq),
        entryIds: list.map((e) => e.id),
      });
    }
  }
  return out;
}

/** Hard rule: a class may hold at most one lesson per (day, sequence). */
export function findClassClashes(entries: EntryLike[]): { classId: string; dayOfWeek: number; sequence: number; entryIds: string[] }[] {
  const map = new Map<string, EntryLike[]>();
  for (const e of entries) {
    const key = `${e.classId}|${e.dayOfWeek}|${e.sequence}`;
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  const out: { classId: string; dayOfWeek: number; sequence: number; entryIds: string[] }[] = [];
  for (const [key, list] of map) {
    if (list.length > 1) {
      const [classId, day, seq] = key.split('|');
      out.push({ classId: classId as string, dayOfWeek: Number(day), sequence: Number(seq), entryIds: list.map((e) => e.id) });
    }
  }
  return out;
}

/** Hard rule: rooms cannot be double-booked when room scheduling is enabled. */
export function findRoomClashes(entries: EntryLike[]): { roomId: string; dayOfWeek: number; sequence: number; entryIds: string[] }[] {
  const map = new Map<string, EntryLike[]>();
  for (const e of entries) {
    if (!e.roomId) continue;
    const key = `${e.roomId}|${e.dayOfWeek}|${e.sequence}`;
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  const out: { roomId: string; dayOfWeek: number; sequence: number; entryIds: string[] }[] = [];
  for (const [key, list] of map) {
    if (list.length > 1) {
      const [roomId, day, seq] = key.split('|');
      out.push({ roomId: roomId as string, dayOfWeek: Number(day), sequence: Number(seq), entryIds: list.map((e) => e.id) });
    }
  }
  return out;
}

/** Hard rule: no lesson during break/lunch or outside the teaching grid. */
export function findPeriodViolations(
  entries: EntryLike[],
  periods: PeriodLike[],
  teachingDays: number[],
): { entryId: string; reason: string }[] {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const out: { entryId: string; reason: string }[] = [];
  for (const e of entries) {
    const period = byId.get(e.periodId);
    if (!period) {
      out.push({ entryId: e.id, reason: 'Lesson references a period that no longer exists in the bell schedule.' });
      continue;
    }
    if (period.isBreak) out.push({ entryId: e.id, reason: `Lesson is scheduled during break (${period.label}).` });
    else if (period.isLunch) out.push({ entryId: e.id, reason: 'Lesson is scheduled during lunch.' });
    else if (!period.isTeaching) out.push({ entryId: e.id, reason: `Lesson is scheduled in a non-teaching slot (${period.label}).` });
    if (!teachingDays.includes(period.dayOfWeek)) {
      out.push({ entryId: e.id, reason: `Lesson is scheduled on a non-school day (day ${period.dayOfWeek}).` });
    }
  }
  return out;
}

/** Hard rule: teacher availability. */
export function findAvailabilityViolations(
  entries: EntryLike[],
  periods: PeriodLike[],
  availability: AvailabilityLike[],
): { entryId: string; teacherId: string; dayOfWeek: number; sequence: number }[] {
  const seqByPeriod = new Map(periods.map((p) => [p.id, p]));
  const blocked = new Set(
    availability.filter((a) => !a.isAvailable).map((a) => `${a.teacherId}|${a.dayOfWeek}|${a.periodIndex}`),
  );
  const out: { entryId: string; teacherId: string; dayOfWeek: number; sequence: number }[] = [];
  for (const e of entries) {
    if (!e.teacherId) continue;
    const period = seqByPeriod.get(e.periodId);
    const sequence = period?.sequence ?? e.sequence;
    const day = period?.dayOfWeek ?? e.dayOfWeek;
    if (blocked.has(`${e.teacherId}|${day}|${sequence}`)) {
      out.push({ entryId: e.id, teacherId: e.teacherId, dayOfWeek: day, sequence });
    }
  }
  return out;
}

/** Hard rule: explicit daily/weekly workload caps. */
export function findWorkloadViolations(
  entries: EntryLike[],
  limits: { teacherId: string; maxPerDay: number | null; maxPerWeek: number | null }[],
): { teacherId: string; code: 'TEACHER_WORKLOAD_DAILY_EXCEEDED' | 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED'; actual: number; limit: number }[] {
  const out: { teacherId: string; code: 'TEACHER_WORKLOAD_DAILY_EXCEEDED' | 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED'; actual: number; limit: number }[] = [];
  for (const limit of limits) {
    const mine = entries.filter((e) => e.teacherId === limit.teacherId);
    if (limit.maxPerWeek != null && mine.length > limit.maxPerWeek) {
      out.push({ teacherId: limit.teacherId, code: 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED', actual: mine.length, limit: limit.maxPerWeek });
    }
    const byDay = new Map<number, number>();
    for (const e of mine) byDay.set(e.dayOfWeek, (byDay.get(e.dayOfWeek) ?? 0) + 1);
    for (const [day, count] of byDay) {
      if (limit.maxPerDay != null && count > limit.maxPerDay) {
        out.push({ teacherId: limit.teacherId, code: 'TEACHER_WORKLOAD_DAILY_EXCEEDED', actual: count, limit: limit.maxPerDay });
        void day;
      }
    }
  }
  return out;
}

/**
 * Course-granularity allocation check: compares required weekly periods against
 * scheduled periods per (class, learning area).
 */
export function compareAllocation(
  requirements: { classId: string; learningAreaId: string; periodsPerWeek: number }[],
  entries: EntryLike[],
): { classId: string; learningAreaId: string; required: number; scheduled: number; deficit: number; surplus: number }[] {
  return requirements.map((req) => {
    const scheduled = entries.filter((e) => e.classId === req.classId && e.learningAreaId === req.learningAreaId).length;
    return {
      classId: req.classId,
      learningAreaId: req.learningAreaId,
      required: req.periodsPerWeek,
      scheduled,
      deficit: Math.max(0, req.periodsPerWeek - scheduled),
      surplus: Math.max(0, scheduled - req.periodsPerWeek),
    };
  });
}

/* --------------------------- soft constraints --------------------------- */

export function countConsecutiveRuns(sequences: number[]): number {
  const sorted = [...new Set(sequences)].sort((a, b) => a - b);
  let runs = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i === 0 || sorted[i] !== (sorted[i - 1] as number) + 1) runs += 1;
  }
  return runs;
}

export interface SoftScoreInput {
  entries: EntryLike[];
  periods: PeriodLike[];
  requirements: { classId: string; learningAreaId: string; periodsPerWeek: number }[];
  weights?: Partial<typeof SCHEDULING_DEFAULTS>;
}

export interface SoftScoreBreakdown {
  score: number;
  sameSubjectSameDay: number;
  consecutiveSameSubject: number;
  teacherGaps: number;
  teacherConsecutive: number;
  dailyLoadImbalance: number;
  details: { code: string; dimension: string; count: number; penalty: number }[];
}

/**
 * Lower score is better. Deterministic - identical input always scores the
 * same, which keeps generation / regeneration explainable.
 */
export function scoreSoftConstraints(input: SoftScoreInput): SoftScoreBreakdown {
  const w = { ...SCHEDULING_DEFAULTS, ...(input.weights ?? {}) };
  const { entries } = input;
  const details: SoftScoreBreakdown['details'] = [];

  // (a) same learning area repeated more than once in a class's day
  const perClassAreaDay = new Map<string, number>();
  for (const e of entries) {
    const k = `${e.classId}|${e.learningAreaId}|${e.dayOfWeek}`;
    perClassAreaDay.set(k, (perClassAreaDay.get(k) ?? 0) + 1);
  }
  let sameSubjectSameDay = 0;
  for (const count of perClassAreaDay.values()) if (count > 1) sameSubjectSameDay += count - 1;
  details.push({ code: 'SAME_SUBJECT_SAME_DAY', dimension: 'class', count: sameSubjectSameDay, penalty: sameSubjectSameDay * w.sameSubjectSameDayPenalty });

  // (b) long consecutive runs of the same learning area for a class
  const runsByClassAreaDay = new Map<string, number[]>();
  for (const e of entries) {
    const k = `${e.classId}|${e.learningAreaId}|${e.dayOfWeek}`;
    runsByClassAreaDay.set(k, [...(runsByClassAreaDay.get(k) ?? []), e.sequence]);
  }
  let consecutiveSameSubject = 0;
  for (const sequences of runsByClassAreaDay.values()) {
    consecutiveSameSubject += Math.max(0, sequences.length - countConsecutiveRuns(sequences));
  }
  details.push({ code: 'CONSECUTIVE_SAME_SUBJECT', dimension: 'class', count: consecutiveSameSubject, penalty: consecutiveSameSubject * w.consecutiveSameSubjectPenalty });

  // (c) teacher gaps: free teaching periods between two lessons on the same day
  const teacherDaySeq = new Map<string, number[]>();
  for (const e of entries) {
    if (!e.teacherId) continue;
    const k = `${e.teacherId}|${e.dayOfWeek}`;
    teacherDaySeq.set(k, [...(teacherDaySeq.get(k) ?? []), e.sequence]);
  }
  let teacherGaps = 0;
  let teacherConsecutive = 0;
  for (const seqs of teacherDaySeq.values()) {
    const sorted = [...new Set(seqs)].sort((a, b) => a - b);
    if (sorted.length > 1) {
      teacherGaps += (sorted[sorted.length - 1] as number) - (sorted[0] as number) + 1 - sorted.length;
    }
    const runCount = countConsecutiveRuns(sorted);
    const longest = longestRun(sorted);
    if (longest > w.maxConsecutivePeriodsPerTeacher) teacherConsecutive += longest - w.maxConsecutivePeriodsPerTeacher;
    void runCount;
  }
  details.push({ code: 'TEACHER_GAPS', dimension: 'teacher', count: teacherGaps, penalty: teacherGaps * w.teacherGapPenalty });
  details.push({ code: 'TEACHER_CONSECUTIVE', dimension: 'teacher', count: teacherConsecutive, penalty: teacherConsecutive * w.teacherConsecutivePenalty });

  // (d) uneven daily load per class
  const classDay = new Map<string, Map<number, number>>();
  for (const e of entries) {
    const m = classDay.get(e.classId) ?? new Map<number, number>();
    m.set(e.dayOfWeek, (m.get(e.dayOfWeek) ?? 0) + 1);
    classDay.set(e.classId, m);
  }
  let imbalance = 0;
  for (const m of classDay.values()) {
    const counts = [...m.values()];
    if (counts.length < 2) continue;
    imbalance += Math.max(...counts) - Math.min(...counts);
  }
  details.push({ code: 'DAILY_LOAD_IMBALANCE', dimension: 'class', count: imbalance, penalty: imbalance * w.balanceDailyLoadPenalty });

  const score = details.reduce((sum, d) => sum + d.penalty, 0);
  return { score, sameSubjectSameDay, consecutiveSameSubject, teacherGaps, teacherConsecutive, dailyLoadImbalance: imbalance, details };
}

function longestRun(sortedSeq: number[]): number {
  let best = 0;
  let current = 0;
  for (let i = 0; i < sortedSeq.length; i += 1) {
    if (i > 0 && sortedSeq[i] === (sortedSeq[i - 1] as number) + 1) current += 1;
    else current = 1;
    best = Math.max(best, current);
  }
  return best;
}

/** Deterministic Mulberry32 PRNG so seeded runs are reproducible. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
