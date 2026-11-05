/**
 * Constraint-aware timetable generator.
 *
 * Design goals
 *  * DETERMINISTIC: identical inputs + seed always produce the identical
 *    timetable. No randomness beyond a seeded PRNG used only for tie-breaks.
 *  * EXPLAINABLE: every unplaced lesson and every violated preference is
 *    reported with a human-readable reason and a suggested remedy.
 *  * HARD CONSTRAINTS ARE NEVER BROKEN: a teacher or class is never double
 *    booked, lessons never land in breaks/lunch, unavailable teacher slots are
 *    never used, and explicit daily/weekly workload caps are respected. If a
 *    lesson cannot be placed without breaking a hard rule it is left unplaced
 *    and reported instead.
 *
 * Algorithm (greedy + bounded repair + local search)
 *  1. Expand weekly requirements into individual lessons (grouping doubles).
 *  2. Order lessons by "most constrained first" (fewest feasible slots).
 *  3. Place each lesson in the feasible slot with the lowest soft-constraint
 *     penalty. Ties break on (day, sequence) so the result is reproducible.
 *  4. If a lesson cannot be placed, attempt a bounded repair: displace one
 *     lower-priority lesson from a candidate slot and re-place it.
 *  5. Run a hill-climbing pass that swaps lessons when the swap lowers the total
 *     soft penalty (bounded by time/iteration budget).
 */

export interface GeneratorPeriod {
  id: string;
  dayOfWeek: number;
  sequence: number;
  label?: string;
  startTime: string;
  endTime: string;
  isTeaching: boolean;
  isBreak: boolean;
  isLunch: boolean;
}

export interface GeneratorRequirement {
  classId: string;
  className: string;
  learningAreaId: string;
  learningAreaName: string;
  periodsPerWeek: number;
  preferDoubleLesson: boolean;
  preferMorning: boolean;
  requiredRoomId: string | null;
}

export interface GeneratorAssignment {
  classId: string;
  learningAreaId: string;
  teacherId: string;
  teacherName: string;
}

export interface GeneratorTeacher {
  id: string;
  name: string;
  maxPeriodsPerDay: number | null;
  maxPeriodsPerWeek: number | null;
  prefersFreeDays: number[];
  unavailable: { dayOfWeek: number; periodIndex: number }[];
  assignments: { classId: string; learningAreaId: string }[];
}

export interface GeneratorRoom {
  id: string;
  name: string;
  classIds: string[]; // classes that own this room (home rooms)
}

export interface GeneratorConfig {
  seed: number;
  maxConsecutiveSameArea: number;
  maxConsecutiveTeacherPeriods: number;
  maxPeriodsPerDayPerClass: number;
  respectTeacherFreeDays: boolean;
  useRooms: boolean;
  balanceDailyLoad: boolean;
  avoidTeacherGaps: boolean;
  preferDoubleLessons: boolean;
  teacherGapPenalty: number;
  classGapPenalty: number;
  sameSubjectSameDayPenalty: number;
  consecutiveSameSubjectPenalty: number;
  teacherConsecutivePenalty: number;
  balanceDailyLoadPenalty: number;
  moveStabilityBonus: number;
  timeBudgetMs: number;
}

export interface GeneratedEntry {
  classId: string;
  learningAreaId: string;
  teacherId: string | null;
  periodId: string;
  dayOfWeek: number;
  sequence: number;
  roomId: string | null;
  isDoubleLesson: boolean;
  doubleLessonGroupId: string | null;
}

export interface GeneratorDiagnostic {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  suggestion?: string;
  classId?: string;
  className?: string;
  teacherId?: string;
  teacherName?: string;
  learningAreaId?: string;
  learningAreaName?: string;
  required?: number;
  scheduled?: number;
  deficit?: number;
}

export interface GeneratorResult {
  entries: GeneratedEntry[];
  diagnostics: GeneratorDiagnostic[];
  stats: {
    lessonsRequired: number;
    lessonsPlaced: number;
    lessonsUnplaced: number;
    classesConsidered: number;
    teachersConsidered: number;
    slotsAvailable: number;
    softPenalty: number;
    repairsUsed: number;
    swapsImproved: number;
    score: number;
    iterations: number;
  };
  feasibility: {
    feasible: boolean;
    requiredCapacity: number;
    availableCapacity: number;
    perClass: { classId: string; className: string; required: number; available: number; feasible: boolean }[];
  };
}

interface Lesson {
  id: string;
  classId: string;
  className: string;
  learningAreaId: string;
  learningAreaName: string;
  teacherId: string | null;
  teacherName: string | null;
  doubleGroup: string | null;
  preferMorning: boolean;
  preferDouble: boolean;
  priority: number;
}

const dayOrder = (a: number, b: number) => a - b;

export class TimetableGenerator {
  private readonly periods: GeneratorPeriod[];
  private readonly slots: GeneratorPeriod[];
  private readonly config: GeneratorConfig;
  private readonly requirements: GeneratorRequirement[];
  private readonly teachersById = new Map<string, GeneratorTeacher>();
  private readonly assignmentKey = new Map<string, GeneratorAssignment>();
  private readonly roomsById = new Map<string, GeneratorRoom>();
  private readonly rand: () => number;

  // Mutable scheduling state
  private readonly classSlot = new Map<string, GeneratedEntry>();
  private readonly teacherSlot = new Map<string, GeneratedEntry>();
  private readonly roomSlot = new Map<string, GeneratedEntry>();
  private readonly teacherDayCount = new Map<string, number>();
  private readonly teacherWeekCount = new Map<string, number>();
  private readonly classDayCount = new Map<string, number>();
  private readonly classAreaDayCount = new Map<string, number>();
  private readonly result: GeneratedEntry[] = [];
  private readonly diagnostics: GeneratorDiagnostic[] = [];
  private repairsUsed = 0;
  private softPenalty = 0;
  private iterations = 0;

  constructor(params: {
    periods: GeneratorPeriod[];
    requirements: GeneratorRequirement[];
    assignments: GeneratorAssignment[];
    teachers: GeneratorTeacher[];
    rooms: GeneratorRoom[];
    config: GeneratorConfig;
    lockedEntries?: { classId: string; learningAreaId: string; teacherId: string | null; periodId: string }[];
  }) {
    this.periods = params.periods;
    this.slots = params.periods.filter((p) => p.isTeaching && !p.isBreak && !p.isLunch).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.sequence - b.sequence);
    this.requirements = params.requirements;
    this.config = params.config;
    for (const teacher of params.teachers) this.teachersById.set(teacher.id, teacher);
    for (const assignment of params.assignments) this.assignmentKey.set(`${assignment.classId}|${assignment.learningAreaId}`, assignment);
    for (const room of params.rooms) this.roomsById.set(room.id, room);
    this.rand = createSeededRandom(params.config.seed);

    // Pre-seed locked entries so the generator works around them.
    for (const locked of params.lockedEntries ?? []) {
      const period = this.slots.find((p) => p.id === locked.periodId);
      if (!period) continue;
      const entry: GeneratedEntry = {
        classId: locked.classId,
        learningAreaId: locked.learningAreaId,
        teacherId: locked.teacherId,
        periodId: period.id,
        dayOfWeek: period.dayOfWeek,
        sequence: period.sequence,
        roomId: null,
        isDoubleLesson: false,
        doubleLessonGroupId: null,
      };
      this.commit(entry);
    }
  }

  /* ------------------------------ feasibility ---------------------------- */

  /** Static feasibility: does each class have enough free slots for its allocation? */
  static feasibility(periods: GeneratorPeriod[], requirements: GeneratorRequirement[], config: { maxPeriodsPerDayPerClass: number }, workingDays: number[]) {
    const slots = periods.filter((p) => p.isTeaching && !p.isBreak && !p.isLunch && workingDays.includes(p.dayOfWeek));
    const perDay = new Map<number, number>();
    for (const slot of slots) perDay.set(slot.dayOfWeek, (perDay.get(slot.dayOfWeek) ?? 0) + 1);
    const classrooms = new Map<string, GeneratorRequirement[]>();
    for (const req of requirements) classrooms.set(req.classId, [...(classrooms.get(req.classId) ?? []), req]);

    const perClass = [...classrooms.entries()].map(([classId, reqs]) => {
      const required = reqs.reduce((sum, r) => sum + r.periodsPerWeek, 0);
      // Capacity is limited per day by the school's own cap, so sum over days.
      const available = [...perDay.values()].reduce((sum, count) => sum + Math.min(count, config.maxPeriodsPerDayPerClass), 0);
      return { classId, className: reqs[0]?.className ?? classId, required, available, feasible: required <= available };
    });

    return {
      feasible: perClass.every((c) => c.feasible),
      requiredCapacity: perClass.reduce((sum, c) => sum + c.required, 0),
      availableCapacity: perClass.reduce((sum, c) => sum + c.available, 0),
      perClass,
    };
  }

  /* --------------------------------- main -------------------------------- */

  run(): GeneratorResult {
    const lessons = this.expandLessons();
    const started = Date.now();

    // 1. Validate that every required lesson has an assignable teacher.
    for (const lesson of lessons) {
      if (!lesson.teacherId) {
        this.diagnostics.push({
          code: 'MISSING_TEACHER_ASSIGNMENT',
          severity: 'ERROR',
          message: `${lesson.className} • ${lesson.learningAreaName} has no teacher assigned, so its lessons were not scheduled.`,
          suggestion: 'Assign a teacher to this class and learning area, then regenerate.',
          classId: lesson.classId,
          className: lesson.className,
          learningAreaId: lesson.learningAreaId,
          learningAreaName: lesson.learningAreaName,
        });
      }
    }

    const schedulable = lessons.filter((l) => l.teacherId);

    // 2. Most-constrained-first ordering (deterministic).
    for (const lesson of schedulable) lesson.priority = this.computePriority(lesson);
    schedulable.sort((a, b) => a.priority - b.priority || a.className.localeCompare(b.className) || a.learningAreaName.localeCompare(b.learningAreaName) || a.id.localeCompare(b.id));

    const unplaced: Lesson[] = [];
    for (const lesson of schedulable) {
      if (Date.now() - started > this.config.timeBudgetMs) {
        unplaced.push(lesson);
        continue;
      }
      const placed = this.placeLesson(lesson, 0, new Set<string>());
      if (!placed) {
        unplaced.push(lesson);
        this.reportUnplaced(lesson);
      }
    }
    void unplaced;

    // 3. Local search: pairwise swaps that reduce the soft penalty.
    this.localSearch(started);

    // 4. Allocation summary per class + learning area.
    this.reportAllocation();

    const lessonsRequired = lessons.length;
    const lessonsPlaced = this.result.length;

    return {
      entries: this.result,
      diagnostics: this.diagnostics,
      stats: {
        lessonsRequired,
        lessonsPlaced,
        lessonsUnplaced: lessonsRequired - lessonsPlaced,
        classesConsidered: new Set(lessons.map((l) => l.classId)).size,
        teachersConsidered: this.teachersById.size,
        slotsAvailable: this.slots.length,
        softPenalty: this.softPenalty,
        repairsUsed: this.repairsUsed,
        swapsImproved: this.iterations,
        score: this.softPenalty,
        iterations: this.iterations,
      },
      feasibility: TimetableGenerator.feasibility(this.periods, this.requirements, this.config, [...new Set(this.slots.map((s) => s.dayOfWeek))].sort(dayOrder)),
    };
  }

  /* ------------------------------- lessons ------------------------------- */

  private expandLessons(): Lesson[] {
    const lessons: Lesson[] = [];
    for (const requirement of this.requirements) {
      const assignment = this.assignmentKey.get(`${requirement.classId}|${requirement.learningAreaId}`);
      const wantsDouble = requirement.preferDoubleLesson || this.config.preferDoubleLessons;
      const total = requirement.periodsPerWeek;
      const doubleGroups = wantsDouble ? Math.floor(total / 2) : 0;
      let remaining = total;
      for (let i = 0; i < doubleGroups; i += 1) {
        const groupId = `${requirement.classId}|${requirement.learningAreaId}|d${i}`;
        lessons.push(this.makeLesson(requirement, assignment, groupId, true, `${groupId}-a`));
        lessons.push(this.makeLesson(requirement, assignment, groupId, true, `${groupId}-b`));
        remaining -= 2;
      }
      for (let i = 0; i < remaining; i += 1) {
        lessons.push(this.makeLesson(requirement, assignment, null, false, `${requirement.classId}|${requirement.learningAreaId}|s${i}`));
      }
    }
    return lessons;
  }

  private makeLesson(
    requirement: GeneratorRequirement,
    assignment: GeneratorAssignment | undefined,
    doubleGroup: string | null,
    preferDouble: boolean,
    id: string,
  ): Lesson {
    return {
      id,
      classId: requirement.classId,
      className: requirement.className,
      learningAreaId: requirement.learningAreaId,
      learningAreaName: requirement.learningAreaName,
      teacherId: assignment?.teacherId ?? null,
      teacherName: assignment?.teacherName ?? null,
      doubleGroup,
      preferMorning: requirement.preferMorning,
      preferDouble,
      priority: 0,
    };
  }

  /** Lower priority value = scheduled earlier (more constrained lessons first). */
  private computePriority(lesson: Lesson): number {
    const teacherFree = lesson.teacherId ? this.feasibleSlotsFor(lesson, lesson.teacherId).length : 0;
    const classLoad = this.requirements.filter((r) => r.classId === lesson.classId).reduce((sum, r) => sum + r.periodsPerWeek, 0);
    const areaLoad = this.requirements.find((r) => r.classId === lesson.classId && r.learningAreaId === lesson.learningAreaId)?.periodsPerWeek ?? 1;
    // Prefer lessons with a scarce teacher and high weekly demand.
    return teacherFree - classLoad - areaLoad * 0.5;
  }

  /* ------------------------------ placement ------------------------------ */

  private feasibleSlotsFor(lesson: Lesson, teacherId: string): GeneratorPeriod[] {
    const teacher = this.teachersById.get(teacherId);
    const blocked = new Set((teacher?.unavailable ?? []).map((u) => `${u.dayOfWeek}|${u.periodIndex}`));
    const result: GeneratorPeriod[] = [];
    for (const slot of this.slots) {
      if (this.classSlot.has(`${lesson.classId}|${slot.id}`)) continue;
      if (this.teacherSlot.has(`${teacherId}|${slot.id}`)) continue;
      if (blocked.has(`${slot.dayOfWeek}|${slot.sequence}`)) continue;
      // NOTE: the ?? fallback must be parenthesised — `??` binds looser than `>=`.
      if ((this.classDayCount.get(`${lesson.classId}|${slot.dayOfWeek}`) ?? 0) >= this.config.maxPeriodsPerDayPerClass) continue;
      result.push(slot);
    }
    return result;
  }

  private slotPenalty(lesson: Lesson, slot: GeneratorPeriod): number {
    const teacherId = lesson.teacherId as string;
    let penalty = 0;
    const cKey = `${lesson.classId}|${slot.dayOfWeek}`;
    const areaDayKey = `${lesson.classId}|${lesson.learningAreaId}|${slot.dayOfWeek}`;

    // Prefer spreading a learning area across the week.
    if ((this.classAreaDayCount.get(areaDayKey) ?? 0) > 0) penalty += this.config.sameSubjectSameDayPenalty;

    // Discourage long runs of the same learning area.
    const before = this.classSlot.get(`${lesson.classId}|${this.periodAt(slot.dayOfWeek, slot.sequence - 1)?.id ?? ''}`);
    const after = this.classSlot.get(`${lesson.classId}|${this.periodAt(slot.dayOfWeek, slot.sequence + 1)?.id ?? ''}`);
    if (before?.learningAreaId === lesson.learningAreaId || after?.learningAreaId === lesson.learningAreaId) {
      const run = this.consecutiveRunLength(lesson.classId, lesson.learningAreaId, slot);
      penalty += run >= this.config.maxConsecutiveSameArea ? this.config.consecutiveSameSubjectPenalty * 2 : this.config.consecutiveSameSubjectPenalty;
    }

    // Balance the daily lesson load for the class.
    if (this.config.balanceDailyLoad) penalty += (this.classDayCount.get(cKey) ?? 0) * this.config.balanceDailyLoadPenalty;

    // Teacher gaps and consecutive load.
    if (this.config.avoidTeacherGaps) {
      const hasEarlier = this.teacherHasLessonOnDay(teacherId, slot.dayOfWeek, slot.sequence, -1);
      const hasLater = this.teacherHasLessonOnDay(teacherId, slot.dayOfWeek, slot.sequence, 1);
      if (hasEarlier && hasLater && !this.teacherAdjacent(teacherId, slot)) penalty += this.config.teacherGapPenalty * 2;
      else if ((hasEarlier || hasLater) && !this.teacherAdjacent(teacherId, slot)) penalty += this.config.teacherGapPenalty;
    }
    const teacherRun = this.teacherConsecutiveRun(teacherId, slot);
    if (teacherRun >= this.config.maxConsecutiveTeacherPeriods) penalty += this.config.teacherConsecutivePenalty * 2;

    const teacher = this.teachersById.get(teacherId);
    if (this.config.respectTeacherFreeDays && teacher?.prefersFreeDays?.includes(slot.dayOfWeek)) penalty += 8;

    // Morning preference for demanding learning areas.
    if (lesson.preferMorning && slot.sequence > Math.ceil(this.slotsPerDay(slot.dayOfWeek) / 2)) penalty += 4;

    // Double lessons want to be adjacent.
    if (lesson.preferDouble) {
      const adjacentSame = [before, after].some((entry) => entry && entry.learningAreaId === lesson.learningAreaId);
      if (!adjacentSame && lesson.doubleGroup) penalty += 6;
    }

    // Deterministic tie-break jitter (< 1) so ordering never depends on Map order.
    penalty += this.rand() * 0.5;
    return penalty;
  }

  private placeLesson(lesson: Lesson, depth: number, protectedIds: Set<string>): boolean {
    if (!lesson.teacherId) return false;
    const teacherId = lesson.teacherId;

    const teacher = this.teachersById.get(teacherId);
    const weekKey = teacherId;
    const currentWeek = this.teacherWeekCount.get(weekKey) ?? 0;
    if (teacher?.maxPeriodsPerWeek != null && currentWeek + 1 > teacher.maxPeriodsPerWeek) {
      this.diagnostics.push({
        code: 'TEACHER_WORKLOAD_WEEKLY_EXCEEDED',
        severity: 'ERROR',
        message: `${lesson.className} • ${lesson.learningAreaName}: ${lesson.teacherName} would exceed the weekly limit of ${teacher.maxPeriodsPerWeek} periods.`,
        suggestion: 'Raise the teacher’s weekly limit, redistribute subjects to another teacher, or reduce the class allocation.',
        classId: lesson.classId,
        className: lesson.className,
        teacherId,
        teacherName: lesson.teacherName ?? undefined,
        learningAreaId: lesson.learningAreaId,
        learningAreaName: lesson.learningAreaName,
      });
      return false;
    }

    const dayLimit = teacher?.maxPeriodsPerDay ?? Number.MAX_SAFE_INTEGER;
    const candidates = this.feasibleSlotsFor(lesson, teacherId)
      .filter((slot) => (this.teacherDayCount.get(`${teacherId}|${slot.dayOfWeek}`) ?? 0) < dayLimit);

    if (!candidates.length) {
      // Bounded repair: try to displace a less constrained lesson from any slot
      // the class has free (ignoring teacher conflicts), then re-place it.
      if (depth < 2) {
        const fallbackSlots = this.slots.filter((slot) => !this.classSlot.has(`${lesson.classId}|${slot.id}`));
        for (const slot of fallbackSlots) {
          const blocking = this.teacherSlot.get(`${teacherId}|${slot.id}`);
          if (!blocking) continue;
          if (protectedIds.has(`${blocking.classId}|${blocking.learningAreaId}|${blocking.periodId}`)) continue;
          const blockingLesson: Lesson = {
            id: `${blocking.classId}|${blocking.learningAreaId}|${blocking.periodId}`,
            classId: blocking.classId,
            className: this.requirements.find((r) => r.classId === blocking.classId)?.className ?? blocking.classId,
            learningAreaId: blocking.learningAreaId,
            learningAreaName: this.requirements.find((r) => r.learningAreaId === blocking.learningAreaId)?.learningAreaName ?? blocking.learningAreaId,
            teacherId: blocking.teacherId,
            teacherName: blocking.teacherId ? this.teachersById.get(blocking.teacherId)?.name ?? null : null,
            doubleGroup: blocking.doubleLessonGroupId,
            preferMorning: false,
            preferDouble: false,
            priority: 0,
          };
          this.removeEntry(blocking);
          const nextProtected = new Set(protectedIds);
          nextProtected.add(`${lesson.classId}|${lesson.learningAreaId}|${slot.id}`);
          if (this.placeLesson(lesson, depth + 1, nextProtected)) {
            this.repairsUsed += 1;
            if (!this.placeLesson(blockingLesson, depth + 1, nextProtected)) {
              // Could not relocate the displaced lesson: put it back and revert.
              this.removeEntry(this.result[this.result.length - 1] as GeneratedEntry);
              this.commit({ ...blocking });
              continue;
            }
            return true;
          }
          this.commit({ ...blocking });
        }
      }
      return false;
    }

    // Choose the feasible slot with the lowest soft penalty (deterministic).
    let best: { slot: GeneratorPeriod; penalty: number } | null = null;
    for (const slot of candidates) {
      const penalty = this.slotPenalty(lesson, slot);
      if (!best || penalty < best.penalty || (penalty === best.penalty && this.isEarlier(slot, best.slot))) {
        best = { slot, penalty };
      }
    }
    if (!best) return false;

    const room = this.pickRoom(lesson, best.slot);
    const entry: GeneratedEntry = {
      classId: lesson.classId,
      learningAreaId: lesson.learningAreaId,
      teacherId,
      periodId: best.slot.id,
      dayOfWeek: best.slot.dayOfWeek,
      sequence: best.slot.sequence,
      roomId: room,
      isDoubleLesson: lesson.preferDouble,
      doubleLessonGroupId: lesson.doubleGroup,
    };
    this.commit(entry, best.penalty);
    return true;
  }

  private isEarlier(a: GeneratorPeriod, b: GeneratorPeriod): boolean {
    return a.dayOfWeek < b.dayOfWeek || (a.dayOfWeek === b.dayOfWeek && a.sequence < b.sequence);
  }

  private pickRoom(lesson: Lesson, slot: GeneratorPeriod): string | null {
    if (!this.config.useRooms) return null;
    const requirement = this.requirements.find((r) => r.classId === lesson.classId && r.learningAreaId === lesson.learningAreaId);
    if (requirement?.requiredRoomId) {
      const key = `${requirement.requiredRoomId}|${slot.id}`;
      if (!this.roomSlot.has(key)) return requirement.requiredRoomId;
      return null;
    }
    for (const room of this.roomsById.values()) {
      if (room.classIds.includes(lesson.classId) && !this.roomSlot.has(`${room.id}|${slot.id}`)) return room.id;
    }
    return null;
  }

  /* ------------------------------- state -------------------------------- */

  private commit(entry: GeneratedEntry, penalty = 0): void {
    this.result.push(entry);
    this.classSlot.set(`${entry.classId}|${entry.periodId}`, entry);
    if (entry.teacherId) {
      this.teacherSlot.set(`${entry.teacherId}|${entry.periodId}`, entry);
      this.teacherDayCount.set(`${entry.teacherId}|${entry.dayOfWeek}`, (this.teacherDayCount.get(`${entry.teacherId}|${entry.dayOfWeek}`) ?? 0) + 1);
      this.teacherWeekCount.set(entry.teacherId, (this.teacherWeekCount.get(entry.teacherId) ?? 0) + 1);
    }
    if (entry.roomId) this.roomSlot.set(`${entry.roomId}|${entry.periodId}`, entry);
    this.classDayCount.set(`${entry.classId}|${entry.dayOfWeek}`, (this.classDayCount.get(`${entry.classId}|${entry.dayOfWeek}`) ?? 0) + 1);
    this.classAreaDayCount.set(`${entry.classId}|${entry.learningAreaId}|${entry.dayOfWeek}`, (this.classAreaDayCount.get(`${entry.classId}|${entry.learningAreaId}|${entry.dayOfWeek}`) ?? 0) + 1);
    this.softPenalty += penalty;
  }

  private removeEntry(entry: GeneratedEntry): void {
    const index = this.result.indexOf(entry);
    if (index >= 0) this.result.splice(index, 1);
    this.classSlot.delete(`${entry.classId}|${entry.periodId}`);
    if (entry.teacherId) {
      this.teacherSlot.delete(`${entry.teacherId}|${entry.periodId}`);
      this.teacherDayCount.set(`${entry.teacherId}|${entry.dayOfWeek}`, Math.max(0, (this.teacherDayCount.get(`${entry.teacherId}|${entry.dayOfWeek}`) ?? 1) - 1));
      this.teacherWeekCount.set(entry.teacherId, Math.max(0, (this.teacherWeekCount.get(entry.teacherId) ?? 1) - 1));
    }
    if (entry.roomId) this.roomSlot.delete(`${entry.roomId}|${entry.periodId}`);
    this.classDayCount.set(`${entry.classId}|${entry.dayOfWeek}`, Math.max(0, (this.classDayCount.get(`${entry.classId}|${entry.dayOfWeek}`) ?? 1) - 1));
    const areaKey = `${entry.classId}|${entry.learningAreaId}|${entry.dayOfWeek}`;
    this.classAreaDayCount.set(areaKey, Math.max(0, (this.classAreaDayCount.get(areaKey) ?? 1) - 1));
  }

  private periodAt(dayOfWeek: number, sequence: number): GeneratorPeriod | undefined {
    return this.slots.find((p) => p.dayOfWeek === dayOfWeek && p.sequence === sequence);
  }

  private slotsPerDay(dayOfWeek: number): number {
    return this.slots.filter((p) => p.dayOfWeek === dayOfWeek).length;
  }

  private teacherHasLessonOnDay(teacherId: string, dayOfWeek: number, sequence: number, direction: -1 | 1): boolean {
    let cursor = sequence + direction;
    while (cursor >= 1 && cursor <= 20) {
      const period = this.periodAt(dayOfWeek, cursor);
      if (period && this.teacherSlot.has(`${teacherId}|${period.id}`)) return true;
      cursor += direction;
    }
    return false;
  }

  private teacherAdjacent(teacherId: string, slot: GeneratorPeriod): boolean {
    const prev = this.periodAt(slot.dayOfWeek, slot.sequence - 1);
    const next = this.periodAt(slot.dayOfWeek, slot.sequence + 1);
    return Boolean((prev && this.teacherSlot.has(`${teacherId}|${prev.id}`)) || (next && this.teacherSlot.has(`${teacherId}|${next.id}`)));
  }

  private teacherConsecutiveRun(teacherId: string, slot: GeneratorPeriod): number {
    let run = 1;
    let cursor = slot.sequence - 1;
    while (cursor >= 1) {
      const period = this.periodAt(slot.dayOfWeek, cursor);
      if (!period || !this.teacherSlot.has(`${teacherId}|${period.id}`)) break;
      run += 1;
      cursor -= 1;
    }
    cursor = slot.sequence + 1;
    while (cursor <= 20) {
      const period = this.periodAt(slot.dayOfWeek, cursor);
      if (!period || !this.teacherSlot.has(`${teacherId}|${period.id}`)) break;
      run += 1;
      cursor += 1;
    }
    return run;
  }

  private consecutiveRunLength(classId: string, learningAreaId: string, slot: GeneratorPeriod): number {
    let run = 1;
    let cursor = slot.sequence - 1;
    while (cursor >= 1) {
      const period = this.periodAt(slot.dayOfWeek, cursor);
      const entry = period ? this.classSlot.get(`${classId}|${period.id}`) : undefined;
      if (!entry || entry.learningAreaId !== learningAreaId) break;
      run += 1;
      cursor -= 1;
    }
    cursor = slot.sequence + 1;
    while (cursor <= 20) {
      const period = this.periodAt(slot.dayOfWeek, cursor);
      const entry = period ? this.classSlot.get(`${classId}|${period.id}`) : undefined;
      if (!entry || entry.learningAreaId !== learningAreaId) break;
      run += 1;
      cursor += 1;
    }
    return run;
  }

  /* ----------------------------- local search ---------------------------- */

  /** Hill climbing over same-class swaps. Bounded by the time budget. */
  private localSearch(startedAt: number): void {
    const maxIterations = 4000;
    let improved = true;
    while (improved && this.iterations < maxIterations && Date.now() - startedAt < this.config.timeBudgetMs) {
      improved = false;
      for (let i = 0; i < this.result.length; i += 1) {
        for (let j = i + 1; j < this.result.length; j += 1) {
          this.iterations += 1;
          if (this.iterations > maxIterations || Date.now() - startedAt > this.config.timeBudgetMs) return;
          const a = this.result[i] as GeneratedEntry;
          const b = this.result[j] as GeneratedEntry;
          if (a.classId !== b.classId) continue;
          if (!this.swapIsLegal(a, b)) continue;
          const delta = this.slotPenaltyAfterSwap(a, b);
          if (delta < -0.0001) {
            this.applySwap(a, b);
            this.softPenalty += delta;
            improved = true;
          }
        }
      }
    }
  }

  private swapIsLegal(a: GeneratedEntry, b: GeneratedEntry): boolean {
    if (a.dayOfWeek === b.dayOfWeek && a.sequence === b.sequence) return false;
    // Teacher conflicts introduced by the swap?
    if (a.teacherId && this.teacherSlot.get(`${a.teacherId}|${b.periodId}`) && this.teacherSlot.get(`${a.teacherId}|${b.periodId}`) !== a) {
      const occupant = this.teacherSlot.get(`${a.teacherId}|${b.periodId}`) as GeneratedEntry;
      if (occupant !== b) return false;
    }
    if (b.teacherId && this.teacherSlot.get(`${b.teacherId}|${a.periodId}`) && this.teacherSlot.get(`${b.teacherId}|${a.periodId}`) !== b) {
      const occupant = this.teacherSlot.get(`${b.teacherId}|${a.periodId}`) as GeneratedEntry;
      if (occupant !== a) return false;
    }
    // Teacher availability and per-day workload limits must still hold after the swap.
    for (const [entry, target] of [[a, b], [b, a]] as [GeneratedEntry, GeneratedEntry][]) {
      if (!entry.teacherId) continue;
      const teacher = this.teachersById.get(entry.teacherId);
      const blocked = (teacher?.unavailable ?? []).some((u) => u.dayOfWeek === target.dayOfWeek && u.periodIndex === target.sequence);
      if (blocked) return false;

      if (entry.dayOfWeek !== target.dayOfWeek) {
        // The teacher picks up a lesson on the target day (and gives one up on the old day).
        const perDayLimit = teacher?.maxPeriodsPerDay ?? Number.MAX_SAFE_INTEGER;
        const onTargetDay = this.teacherDayCount.get(`${entry.teacherId}|${target.dayOfWeek}`) ?? 0;
        if (onTargetDay + 1 > perDayLimit) return false;
      }
    }

    // Class-level daily cap: a same-class swap keeps the class day totals unchanged,
    // but this guard keeps the function correct if it is ever reused across classes.
    if (a.classId !== b.classId && a.dayOfWeek !== b.dayOfWeek) {
      const classALimit = this.config.maxPeriodsPerDayPerClass;
      const classBOnA = this.classDayCount.get(`${b.classId}|${a.dayOfWeek}`) ?? 0;
      const classAOnB = this.classDayCount.get(`${a.classId}|${b.dayOfWeek}`) ?? 0;
      if (classBOnA + 1 > classALimit || classAOnB + 1 > classALimit) return false;
    }
    return true;
  }

  /** Keeps the day-level counters accurate after a swap, so later estimates stay correct. */
  private shiftDayCounters(entry: GeneratedEntry, fromDay: number, toDay: number): void {
    if (fromDay === toDay) return;
    if (entry.teacherId) {
      const fromKey = `${entry.teacherId}|${fromDay}`;
      const toKey = `${entry.teacherId}|${toDay}`;
      this.teacherDayCount.set(fromKey, Math.max(0, (this.teacherDayCount.get(fromKey) ?? 1) - 1));
      this.teacherDayCount.set(toKey, (this.teacherDayCount.get(toKey) ?? 0) + 1);
    }
    const classFrom = `${entry.classId}|${fromDay}`;
    const classTo = `${entry.classId}|${toDay}`;
    this.classDayCount.set(classFrom, Math.max(0, (this.classDayCount.get(classFrom) ?? 1) - 1));
    this.classDayCount.set(classTo, (this.classDayCount.get(classTo) ?? 0) + 1);
    const areaFrom = `${entry.classId}|${entry.learningAreaId}|${fromDay}`;
    const areaTo = `${entry.classId}|${entry.learningAreaId}|${toDay}`;
    this.classAreaDayCount.set(areaFrom, Math.max(0, (this.classAreaDayCount.get(areaFrom) ?? 1) - 1));
    this.classAreaDayCount.set(areaTo, (this.classAreaDayCount.get(areaTo) ?? 0) + 1);
  }

  /**
   * Delta of the total soft penalty if the two entries swap slots.
   * Negative delta = improvement. Only same-class swaps are considered, so the
   * swap can never break a class-level hard constraint.
   */
  private slotPenaltyAfterSwap(a: GeneratedEntry, b: GeneratedEntry): number {
    const lessonOf = (entry: GeneratedEntry): Lesson => ({
      id: entry.periodId,
      classId: entry.classId,
      className: '',
      learningAreaId: entry.learningAreaId,
      learningAreaName: '',
      teacherId: entry.teacherId,
      teacherName: null,
      doubleGroup: entry.doubleLessonGroupId,
      preferMorning: this.requirements.find((r) => r.classId === entry.classId && r.learningAreaId === entry.learningAreaId)?.preferMorning ?? false,
      preferDouble: this.requirements.find((r) => r.classId === entry.classId && r.learningAreaId === entry.learningAreaId)?.preferDoubleLesson ?? false,
      priority: 0,
    });
    const slotA = this.slots.find((s) => s.id === a.periodId) as GeneratorPeriod;
    const slotB = this.slots.find((s) => s.id === b.periodId) as GeneratorPeriod;
    const selfCost = this.estimateAt(a, lessonOf(a), slotA) + this.estimateAt(b, lessonOf(b), slotB);
    const swappedCost = this.estimateAt(a, lessonOf(a), slotB) + this.estimateAt(b, lessonOf(b), slotA);
    return swappedCost - selfCost;
  }

  private estimateAt(entry: GeneratedEntry, lesson: Lesson, slot: GeneratorPeriod): number {
    const removedFrom = `${entry.classId}|${entry.periodId}`;
    const storedClass = this.classSlot.get(removedFrom);
    const storedTeacher = entry.teacherId ? this.teacherSlot.get(`${entry.teacherId}|${entry.periodId}`) : undefined;
    this.classSlot.delete(removedFrom);
    if (entry.teacherId) this.teacherSlot.delete(`${entry.teacherId}|${entry.periodId}`);
    const penalty = this.slotPenalty(lesson, slot);
    if (storedClass) this.classSlot.set(removedFrom, storedClass);
    if (entry.teacherId && storedTeacher) this.teacherSlot.set(`${entry.teacherId}|${entry.periodId}`, storedTeacher);
    return penalty;
  }

  private applySwap(a: GeneratedEntry, b: GeneratedEntry): void {
    const periodA = a.periodId;
    const periodB = b.periodId;
    const dayA = a.dayOfWeek;
    const seqA = a.sequence;
    const dayB = b.dayOfWeek;
    const seqB = b.sequence;

    this.classSlot.delete(`${a.classId}|${periodA}`);
    this.classSlot.delete(`${b.classId}|${periodB}`);
    if (a.teacherId) this.teacherSlot.delete(`${a.teacherId}|${periodA}`);
    if (b.teacherId) this.teacherSlot.delete(`${b.teacherId}|${periodB}`);

    a.periodId = periodB; a.dayOfWeek = dayB; a.sequence = seqB;
    b.periodId = periodA; b.dayOfWeek = dayA; b.sequence = seqA;

    this.classSlot.set(`${a.classId}|${a.periodId}`, a);
    this.classSlot.set(`${b.classId}|${b.periodId}`, b);
    if (a.teacherId) this.teacherSlot.set(`${a.teacherId}|${a.periodId}`, a);
    if (b.teacherId) this.teacherSlot.set(`${b.teacherId}|${b.periodId}`, b);

    // Swapping slots across days changes per-day load, so the counters must move with the lessons.
    this.shiftDayCounters(a, dayA, dayB);
    this.shiftDayCounters(b, dayB, dayA);
  }

  /* ------------------------------ reporting ------------------------------ */

  private reportUnplaced(lesson: Lesson): void {
    const teacher = lesson.teacherId ? this.teachersById.get(lesson.teacherId) : undefined;
    const classSlots = this.slots.filter((slot) => !this.classSlot.has(`${lesson.classId}|${slot.id}`));
    const reasons: string[] = [];
    if (!teacher) reasons.push('no teacher assigned');
    else {
      const blockedCount = teacher.unavailable.length;
      if (blockedCount) reasons.push(`${blockedCount} unavailable period(s)`);
      if (teacher.maxPeriodsPerWeek != null) reasons.push(`weekly limit ${teacher.maxPeriodsPerWeek}`);
      const weekly = this.teacherWeekCount.get(teacher.id) ?? 0;
      reasons.push(`currently ${weekly} period(s) scheduled`);
    }
    reasons.push(`${classSlots.length} free slot(s) remain in the class week`);
    this.diagnostics.push({
      code: 'NO_FEASIBLE_SLOT',
      severity: 'ERROR',
      message: `${lesson.className} • ${lesson.learningAreaName} could not be placed (${reasons.join('; ')}).`,
      suggestion:
        'Add teaching periods, reduce the weekly requirement, relax teacher availability, raise the teacher’s workload limit, or assign an additional teacher.',
      classId: lesson.classId,
      className: lesson.className,
      teacherId: lesson.teacherId ?? undefined,
      teacherName: lesson.teacherName ?? undefined,
      learningAreaId: lesson.learningAreaId,
      learningAreaName: lesson.learningAreaName,
    });
  }

  private reportAllocation(): void {
    for (const requirement of this.requirements) {
      const scheduled = this.result.filter((e) => e.classId === requirement.classId && e.learningAreaId === requirement.learningAreaId).length;
      if (scheduled < requirement.periodsPerWeek) {
        this.diagnostics.push({
          code: 'PERIODS_UNDER_ALLOCATED',
          severity: 'ERROR',
          message: `${requirement.className} • ${requirement.learningAreaName}: ${scheduled} of ${requirement.periodsPerWeek} required period(s) were scheduled.`,
          suggestion: 'Review teacher availability, weekly requirements and the number of teaching periods per day.',
          classId: requirement.classId,
          className: requirement.className,
          learningAreaId: requirement.learningAreaId,
          learningAreaName: requirement.learningAreaName,
          required: requirement.periodsPerWeek,
          scheduled,
          deficit: requirement.periodsPerWeek - scheduled,
        });
      } else if (scheduled > requirement.periodsPerWeek) {
        this.diagnostics.push({
          code: 'PERIODS_OVER_ALLOCATED',
          severity: 'WARNING',
          message: `${requirement.className} • ${requirement.learningAreaName}: ${scheduled} period(s) scheduled against a requirement of ${requirement.periodsPerWeek}.`,
          suggestion: 'Check the class requirements; the grid has more lessons than the configured allocation.',
          classId: requirement.classId,
          className: requirement.className,
          learningAreaId: requirement.learningAreaId,
          learningAreaName: requirement.learningAreaName,
          required: requirement.periodsPerWeek,
          scheduled,
        });
      }
    }
  }
}

/** Deterministic Mulberry32 PRNG (identical output for identical seeds). */
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
