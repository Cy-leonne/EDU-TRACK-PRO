/**
 * Timetable validation: turns a set of proposed entries into a list of
 * conflicts with severity, context and (where possible) a suggested fix.
 *
 * This module is pure: it receives plain data and returns plain data, which is
 * what makes it straightforward to unit-test and to reuse for the "validate
 * before publish" gate.
 */
import type { GeneratorDiagnostic } from './timetable-generator';

export type ConflictCode =
  | 'TEACHER_DOUBLE_BOOKED' | 'CLASS_DOUBLE_BOOKED' | 'ROOM_DOUBLE_BOOKED'
  | 'LESSON_IN_BREAK' | 'LESSON_OUTSIDE_SCHOOL_HOURS' | 'TEACHER_UNAVAILABLE'
  | 'TEACHER_WORKLOAD_DAILY_EXCEEDED' | 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED'
  | 'MISSING_TEACHER_ASSIGNMENT' | 'PERIODS_UNDER_ALLOCATED' | 'PERIODS_OVER_ALLOCATED'
  | 'INVALID_ENROLLMENT' | 'LEARNER_DOUBLE_BOOKED' | 'NO_FEASIBLE_SLOT'
  | 'UNASSIGNED_LEARNING_AREA' | 'ROOM_REQUIRED' | 'LOCKED_ENTRY_CONFLICT' | 'OTHER';

export interface ValidatorEntry {
  id: string;
  classId: string;
  className?: string;
  learningAreaId: string;
  learningAreaName?: string;
  teacherId: string | null;
  teacherName?: string | null;
  roomId: string | null;
  roomName?: string | null;
  periodId: string;
  dayOfWeek: number;
  sequence: number;
  periodLabel?: string;
  isLocked?: boolean;
}

export interface ValidatorPeriod {
  id: string;
  dayOfWeek: number;
  sequence: number;
  label: string;
  startTime: string;
  endTime: string;
  isTeaching: boolean;
  isBreak: boolean;
  isLunch: boolean;
}

export interface ValidatorConflict {
  code: ConflictCode;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  suggestion?: string;
  classId?: string;
  className?: string;
  learningAreaId?: string;
  learningAreaName?: string;
  teacherId?: string;
  teacherName?: string;
  roomId?: string;
  roomName?: string;
  periodId?: string;
  entryId?: string;
  dayOfWeek?: number;
  sequence?: number;
  metadata?: Record<string, unknown>;
}

export interface ValidationInput {
  entries: ValidatorEntry[];
  periods: ValidatorPeriod[];
  workingDays: number[];
  requirements: { classId: string; className?: string; learningAreaId: string; learningAreaName?: string; periodsPerWeek: number }[];
  teachers: { id: string; name: string; maxPeriodsPerDay: number | null; maxPeriodsPerWeek: number | null; unavailable: { dayOfWeek: number; periodIndex: number }[] }[];
  assignments: { classId: string; learningAreaId: string; teacherId: string }[];
  rooms?: { id: string; name: string; capacity?: number | null }[];
  enrollments?: { learnerId: string; learnerName?: string; classIds: string[] }[];
  /** School day window ("HH:MM"). When supplied, lessons outside it are flagged. */
  schoolOpenTime?: string;
  schoolCloseTime?: string;
}

const label = (day: number, sequence: number) => `day ${day}, period ${sequence}`;

export function validateTimetable(input: ValidationInput): { conflicts: ValidatorConflict[]; summary: { errors: number; warnings: number; infos: number; byCode: Record<string, number> } } {
  const conflicts: ValidatorConflict[] = [];
  const periodById = new Map(input.periods.map((p) => [p.id, p]));
  const teacherById = new Map(input.teachers.map((t) => [t.id, t]));
  const assignmentSet = new Set(input.assignments.map((a) => `${a.classId}|${a.learningAreaId}`));
  const assignmentTeacher = new Map(input.assignments.map((a) => [`${a.classId}|${a.learningAreaId}`, a.teacherId]));

  /* ------------------------- hard: class conflicts ---------------------- */
  const byClassSlot = new Map<string, ValidatorEntry[]>();
  const byTeacherSlot = new Map<string, ValidatorEntry[]>();
  const byRoomSlot = new Map<string, ValidatorEntry[]>();

  for (const entry of input.entries) {
    byClassSlot.set(`${entry.classId}|${entry.dayOfWeek}|${entry.sequence}`, [...(byClassSlot.get(`${entry.classId}|${entry.dayOfWeek}|${entry.sequence}`) ?? []), entry]);
    if (entry.teacherId) {
      byTeacherSlot.set(`${entry.teacherId}|${entry.dayOfWeek}|${entry.sequence}`, [...(byTeacherSlot.get(`${entry.teacherId}|${entry.dayOfWeek}|${entry.sequence}`) ?? []), entry]);
    }
    if (entry.roomId) {
      byRoomSlot.set(`${entry.roomId}|${entry.dayOfWeek}|${entry.sequence}`, [...(byRoomSlot.get(`${entry.roomId}|${entry.dayOfWeek}|${entry.sequence}`) ?? []), entry]);
    }
  }

  for (const [key, list] of byClassSlot) {
    if (list.length < 2) continue;
    const [classId, day, sequence] = key.split('|');
    const first = list[0] as ValidatorEntry;
    conflicts.push({
      code: 'CLASS_DOUBLE_BOOKED',
      severity: 'ERROR',
      message: `${first.className ?? classId} has ${list.length} lessons in the same period (${label(Number(day), Number(sequence))}).`,
      suggestion: 'Move one of the lessons to a free period for the class.',
      classId,
      className: first.className,
      dayOfWeek: Number(day),
      sequence: Number(sequence),
      entryId: first.id,
      metadata: { entries: list.map((e) => ({ id: e.id, learningAreaName: e.learningAreaName, teacherName: e.teacherName })) },
    });
  }

  for (const [key, list] of byTeacherSlot) {
    if (list.length < 2) continue;
    const [teacherId, day, sequence] = key.split('|');
    const first = list[0] as ValidatorEntry;
    const teacher = teacherById.get(teacherId as string);
    conflicts.push({
      code: 'TEACHER_DOUBLE_BOOKED',
      severity: 'ERROR',
      message: `${teacher?.name ?? first.teacherName ?? teacherId} is booked for ${list.length} classes at the same time (${label(Number(day), Number(sequence))}): ${list.map((e) => e.className ?? e.classId).join(', ')}.`,
      suggestion: 'Move one of the lessons, or assign a different qualified teacher to one class.',
      teacherId: teacherId as string,
      teacherName: teacher?.name ?? first.teacherName ?? undefined,
      dayOfWeek: Number(day),
      sequence: Number(sequence),
      entryId: first.id,
    });
  }

  for (const [key, list] of byRoomSlot) {
    if (list.length < 2) continue;
    const [roomId, day, sequence] = key.split('|');
    const first = list[0] as ValidatorEntry;
    conflicts.push({
      code: 'ROOM_DOUBLE_BOOKED',
      severity: 'ERROR',
      message: `${first.roomName ?? roomId} is booked for ${list.length} lessons at the same time (${label(Number(day), Number(sequence))}).`,
      suggestion: 'Release the room in one of the lessons or assign another room.',
      roomId: roomId as string,
      roomName: first.roomName ?? undefined,
      dayOfWeek: Number(day),
      sequence: Number(sequence),
      entryId: first.id,
    });
  }

  /* ------------------------ hard: period integrity ---------------------- */
  for (const entry of input.entries) {
    const period = periodById.get(entry.periodId);
    if (!period) {
      conflicts.push({
        code: 'OTHER',
        severity: 'ERROR',
        message: 'A lesson references a period that no longer exists in the bell schedule.',
        suggestion: 'Re-link the lesson to a current period, or regenerate the timetable.',
        entryId: entry.id,
        classId: entry.classId,
        className: entry.className,
      });
      continue;
    }
    if (period.isBreak) {
      conflicts.push({ code: 'LESSON_IN_BREAK', severity: 'ERROR', message: `A lesson is scheduled during ${period.label}.`, suggestion: 'Move the lesson to a teaching period.', entryId: entry.id, classId: entry.classId, className: entry.className, periodId: period.id, dayOfWeek: period.dayOfWeek, sequence: period.sequence });
    }
    if (period.isLunch) {
      conflicts.push({ code: 'LESSON_IN_BREAK', severity: 'ERROR', message: 'A lesson is scheduled during the lunch break.', suggestion: 'Move the lesson to a teaching period.', entryId: entry.id, classId: entry.classId, className: entry.className, periodId: period.id, dayOfWeek: period.dayOfWeek, sequence: period.sequence });
    }
    if (!period.isTeaching && !period.isBreak && !period.isLunch) {
      conflicts.push({ code: 'LESSON_OUTSIDE_SCHOOL_HOURS', severity: 'ERROR', message: `A lesson is scheduled in a non-teaching slot (${period.label}).`, entryId: entry.id, classId: entry.classId, className: entry.className, periodId: period.id, dayOfWeek: period.dayOfWeek, sequence: period.sequence });
    }
    // Hard: lessons must sit inside the school's own opening hours.
    if (input.schoolOpenTime && input.schoolCloseTime
      && (period.startTime < input.schoolOpenTime || period.endTime > input.schoolCloseTime)) {
      conflicts.push({
        code: 'LESSON_OUTSIDE_SCHOOL_HOURS', severity: 'ERROR',
        message: `A lesson is scheduled at ${period.startTime}–${period.endTime}, outside the school day (${input.schoolOpenTime}–${input.schoolCloseTime}).`,
        suggestion: 'Move the lesson into the school day or adjust the school hours in the school profile.',
        entryId: entry.id, classId: entry.classId, className: entry.className,
        periodId: period.id, dayOfWeek: period.dayOfWeek, sequence: period.sequence,
      });
    }
    if (!input.workingDays.includes(period.dayOfWeek)) {
      conflicts.push({ code: 'LESSON_OUTSIDE_SCHOOL_HOURS', severity: 'ERROR', message: `A lesson is scheduled on a non-school day (day ${period.dayOfWeek}).`, suggestion: 'Remove the lesson or add this day to the school week.', entryId: entry.id, classId: entry.classId, className: entry.className, periodId: period.id, dayOfWeek: period.dayOfWeek, sequence: period.sequence });
    }
  }

  /* ---------------------- hard: teacher availability -------------------- */
  const blockedSet = new Set<string>();
  for (const teacher of input.teachers) for (const slot of teacher.unavailable) blockedSet.add(`${teacher.id}|${slot.dayOfWeek}|${slot.periodIndex}`);
  for (const entry of input.entries) {
    if (!entry.teacherId) continue;
    if (blockedSet.has(`${entry.teacherId}|${entry.dayOfWeek}|${entry.sequence}`)) {
      const teacher = teacherById.get(entry.teacherId);
      conflicts.push({
        code: 'TEACHER_UNAVAILABLE',
        severity: 'ERROR',
        message: `${teacher?.name ?? entry.teacherName} is marked unavailable at ${label(entry.dayOfWeek, entry.sequence)} but is scheduled for ${entry.className ?? entry.classId}.`,
        suggestion: 'Move the lesson to a period the teacher is available for, or update their availability.',
        entryId: entry.id,
        teacherId: entry.teacherId,
        teacherName: teacher?.name ?? entry.teacherName ?? undefined,
        classId: entry.classId,
        className: entry.className,
        dayOfWeek: entry.dayOfWeek,
        sequence: entry.sequence,
      });
    }
  }

  /* ------------------------- hard: teacher workload --------------------- */
  for (const teacher of input.teachers) {
    const mine = input.entries.filter((e) => e.teacherId === teacher.id);
    if (teacher.maxPeriodsPerWeek != null && mine.length > teacher.maxPeriodsPerWeek) {
      conflicts.push({
        code: 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED',
        severity: 'ERROR',
        message: `${teacher.name} has ${mine.length} periods this week, above the limit of ${teacher.maxPeriodsPerWeek}.`,
        suggestion: 'Redistribute lessons or raise the weekly limit.',
        teacherId: teacher.id,
        teacherName: teacher.name,
        metadata: { actual: mine.length, limit: teacher.maxPeriodsPerWeek },
      });
    }
    const perDay = new Map<number, number>();
    for (const entry of mine) perDay.set(entry.dayOfWeek, (perDay.get(entry.dayOfWeek) ?? 0) + 1);
    for (const [day, count] of perDay) {
      if (teacher.maxPeriodsPerDay != null && count > teacher.maxPeriodsPerDay) {
        conflicts.push({
          code: 'TEACHER_WORKLOAD_DAILY_EXCEEDED',
          severity: 'ERROR',
          message: `${teacher.name} has ${count} periods on day ${day}, above the daily limit of ${teacher.maxPeriodsPerDay}.`,
          suggestion: 'Spread the lessons over more days.',
          teacherId: teacher.id,
          teacherName: teacher.name,
          dayOfWeek: day,
          metadata: { actual: count, limit: teacher.maxPeriodsPerDay },
        });
      }
    }
  }

  /* ------------------ hard: assignment integrity ------------------------ */
  for (const entry of input.entries) {
    if (!assignmentSet.has(`${entry.classId}|${entry.learningAreaId}`)) {
      conflicts.push({
        code: 'MISSING_TEACHER_ASSIGNMENT',
        severity: 'ERROR',
        message: `${entry.className ?? entry.classId} has a ${entry.learningAreaName ?? 'learning area'} lesson without an assigned teacher.`,
        suggestion: 'Assign a teacher to this class and learning area.',
        entryId: entry.id,
        classId: entry.classId,
        className: entry.className,
      });
      continue;
    }
    if (!entry.teacherId) {
      conflicts.push({
        code: 'MISSING_TEACHER_ASSIGNMENT',
        severity: 'ERROR',
        message: `${entry.className ?? entry.classId} • ${entry.learningAreaName ?? 'learning area'} has no teacher on the lesson.`,
        suggestion: 'Set the teacher for this lesson.',
        entryId: entry.id,
        classId: entry.classId,
        className: entry.className,
      });
      continue;
    }
    const expected = assignmentTeacher.get(`${entry.classId}|${entry.learningAreaId}`);
    if (expected && expected !== entry.teacherId) {
      conflicts.push({
        code: 'UNASSIGNED_LEARNING_AREA',
        severity: 'ERROR',
        message: `${entry.teacherName ?? 'The assigned teacher'} is not the teacher assigned to ${entry.className ?? entry.classId} for ${entry.learningAreaName ?? 'this learning area'}.`,
        suggestion: 'Use the assigned teacher, or change the teacher assignment for that class and learning area.',
        entryId: entry.id,
        teacherId: entry.teacherId,
        teacherName: entry.teacherName ?? undefined,
        classId: entry.classId,
        className: entry.className,
      });
    }
  }

  /* ---------------- informational: allocation coverage ------------------ */
  for (const requirement of input.requirements) {
    const scheduled = input.entries.filter((e) => e.classId === requirement.classId && e.learningAreaId === requirement.learningAreaId).length;
    if (scheduled < requirement.periodsPerWeek) {
      conflicts.push({
        code: 'PERIODS_UNDER_ALLOCATED',
        severity: 'WARNING',
        message: `${requirement.className ?? requirement.classId} • ${requirement.learningAreaName ?? requirement.learningAreaId}: only ${scheduled} of ${requirement.periodsPerWeek} required period(s) are scheduled.`,
        suggestion: 'Generate again after resolving constraints, or reduce the weekly requirement.',
        classId: requirement.classId,
        className: requirement.className,
        learningAreaId: requirement.learningAreaId,
        learningAreaName: requirement.learningAreaName,
        metadata: { required: requirement.periodsPerWeek, scheduled, deficit: requirement.periodsPerWeek - scheduled },
      });
    } else if (scheduled > requirement.periodsPerWeek) {
      conflicts.push({
        code: 'PERIODS_OVER_ALLOCATED',
        severity: 'WARNING',
        message: `${requirement.className ?? requirement.classId} • ${requirement.learningAreaName ?? requirement.learningAreaId}: ${scheduled} period(s) scheduled against a requirement of ${requirement.periodsPerWeek}.`,
        suggestion: 'Confirm the extra lesson is intentional, then publish.',
        classId: requirement.classId,
        className: requirement.className,
        learningAreaId: requirement.learningAreaId,
        learningAreaName: requirement.learningAreaName,
        metadata: { required: requirement.periodsPerWeek, scheduled },
      });
    }
  }

  /* ------------- informational: learner double booking ------------------ */
  if (input.enrollments?.length) {
    const slotByClass = new Map<string, ValidatorEntry>();
    for (const entry of input.entries) slotByClass.set(`${entry.classId}|${entry.dayOfWeek}|${entry.sequence}`, entry);
    const seenLearnerSlots = new Set<string>();
    for (const enrollment of input.enrollments) {
      if (enrollment.classIds.length < 2) continue;
      for (const classId of enrollment.classIds) {
        for (const entry of input.entries.filter((e) => e.classId === classId)) {
          const key = `${enrollment.learnerId}|${entry.dayOfWeek}|${entry.sequence}`;
          if (seenLearnerSlots.has(key)) {
            conflicts.push({
              code: 'LEARNER_DOUBLE_BOOKED',
              severity: 'ERROR',
              message: `${enrollment.learnerName ?? 'A learner'} is enrolled in more than one class with lessons at ${label(entry.dayOfWeek, entry.sequence)}.`,
              suggestion: 'Correct the enrolment so each learner belongs to one class per academic year.',
              classId,
              dayOfWeek: entry.dayOfWeek,
              sequence: entry.sequence,
              metadata: { learnerId: enrollment.learnerId },
            });
          }
          seenLearnerSlots.add(key);
        }
      }
    }
  }

  const byCode: Record<string, number> = {};
  for (const conflict of conflicts) byCode[conflict.code] = (byCode[conflict.code] ?? 0) + 1;

  return {
    conflicts,
    summary: {
      errors: conflicts.filter((c) => c.severity === 'ERROR').length,
      warnings: conflicts.filter((c) => c.severity === 'WARNING').length,
      infos: conflicts.filter((c) => c.severity === 'INFO').length,
      byCode,
    },
  };
}

export function diagnosticsToConflicts(diagnostics: GeneratorDiagnostic[]): ValidatorConflict[] {
  return diagnostics.map((d) => ({
    code: d.code as ConflictCode,
    severity: d.severity,
    message: d.message,
    suggestion: d.suggestion,
    classId: d.classId,
    className: d.className,
    teacherId: d.teacherId,
    teacherName: d.teacherName,
    metadata: {
      learningAreaId: d.learningAreaId,
      learningAreaName: d.learningAreaName,
      required: d.required,
      scheduled: d.scheduled,
      deficit: d.deficit,
    },
  }));
}
