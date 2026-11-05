import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TimetableStatus } from '@prisma/client';
import type { z } from 'zod';
import type {
  generateTimetableSchema, roomSchema, timetableBellScheduleSchema, timetableEntryMoveSchema, timetableEntrySchema, timetablePublishSchema, timetableSchema,
} from '@edutrack/validation';
import { isTeacherRole, SCHEDULING_DEFAULTS } from '@edutrack/shared-config';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessRuleException, TenantIsolationException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { NotificationType } from '@prisma/client';
import { TimetableGenerator, type GeneratorConfig } from './timetable-generator';
import { validateTimetable } from './timetable-validator';

type BellScheduleInput = z.infer<typeof timetableBellScheduleSchema>;
type TimetableInput = z.infer<typeof timetableSchema>;
type GenerateInput = z.infer<typeof generateTimetableSchema>;
type EntryInput = z.infer<typeof timetableEntrySchema>;
type MoveInput = z.infer<typeof timetableEntryMoveSchema>;
type PublishInput = z.infer<typeof timetablePublishSchema>;
type RoomInput = z.infer<typeof roomSchema>;

@Injectable()
export class TimetablesService {
  private readonly logger = new Logger(TimetablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------- bell schedule --------------------------- */

  /** Builds the day-by-day period grid from the school profile (admin can then edit it). */
  async buildDefaultSchedule(user: AuthPrincipal, input: { academicYearId: string; termId?: string }) {
    const school = await this.prisma.school.findUnique({ where: { id: user.schoolId } });
    if (!school) throw new TenantIsolationException('School');
    const breaks = (school.breakConfig as unknown as { label: string; afterPeriod: number; minutes: number }[] | null) ?? [];
    const lunch = school.lunchConfig as unknown as { afterPeriod: number; minutes: number } | null;
    const [openH, openM] = school.schoolOpenTime.split(':').map(Number);
    const [closeH, closeM] = school.schoolCloseTime.split(':').map(Number);
    const closeMinutes = (closeH ?? 16) * 60 + (closeM ?? 0);
    const dayStart = Date.UTC(2026, 0, 1, openH ?? 8, openM ?? 0);
    const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const toMinutes = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };

    const rows: { dayOfWeek: number; sequence: number; label: string; startTime: string; endTime: string; isBreak: boolean; isLunch: boolean; isTeaching: boolean }[] = [];

    for (const day of school.workingDays.slice().sort((a, b) => a - b)) {
      let cursorMinutes = toMinutes(school.schoolOpenTime);
      let sequence = 1;
      let periodsPlaced = 0;
      while (periodsPlaced < school.maxPeriodsPerDay) {
        const end = cursorMinutes + school.defaultPeriodMinutes;
        rows.push({
          dayOfWeek: day, sequence, label: `Period ${periodsPlaced + 1}`,
          startTime: toTime(cursorMinutes), endTime: toTime(end),
          isBreak: false, isLunch: false, isTeaching: end <= closeMinutes,
        });
        cursorMinutes = end;
        periodsPlaced += 1;

        const breakAfter = breaks.find((b) => b.afterPeriod === periodsPlaced);
        if (breakAfter && cursorMinutes + breakAfter.minutes <= closeMinutes) {
          sequence += 1;
          rows.push({
            dayOfWeek: day, sequence, label: breakAfter.label || 'Break',
            startTime: toTime(cursorMinutes), endTime: toTime(cursorMinutes + breakAfter.minutes),
            isBreak: true, isLunch: false, isTeaching: false,
          });
          cursorMinutes += breakAfter.minutes;
        }
        if (lunch && lunch.afterPeriod === periodsPlaced && cursorMinutes + lunch.minutes <= closeMinutes) {
          sequence += 1;
          rows.push({
            dayOfWeek: day, sequence, label: 'Lunch',
            startTime: toTime(cursorMinutes), endTime: toTime(cursorMinutes + lunch.minutes),
            isBreak: false, isLunch: true, isTeaching: false,
          });
          cursorMinutes += lunch.minutes;
        }
        sequence += 1;
      }
    }
    void dayStart;
    return { academicYearId: input.academicYearId, termId: input.termId ?? null, periods: rows };
  }

  async saveBellSchedule(user: AuthPrincipal, input: BellScheduleInput) {
    const year = await this.prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: user.schoolId } });
    if (!year) throw new TenantIsolationException('Academic year');
    if (year.isLocked) throw new BusinessRuleException('The academic year is locked. Unlock it before changing the bell schedule.');

    const overlapping = findOverlaps(input.periods);
    if (overlapping.length) {
      throw new BadRequestException(
        `Periods overlap on day ${overlapping[0]?.dayOfWeek} (${overlapping[0]?.a} and ${overlapping[0]?.b}). Fix the times before saving.`,
      );
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const published = await tx.timetableVersion.count({
        where: { schoolId: user.schoolId, status: 'PUBLISHED', timetable: { academicYearId: input.academicYearId } },
      });
      if (published > 0) {
        throw new BusinessRuleException('A published timetable exists for this academic year. Withdraw it before rebuilding the bell schedule.');
      }
      await tx.timetablePeriod.deleteMany({ where: { schoolId: user.schoolId, academicYearId: input.academicYearId } });
      await tx.timetablePeriod.createMany({
        data: input.periods.map((period) => ({
          schoolId: user.schoolId, academicYearId: input.academicYearId, termId: input.termId || null,
          dayOfWeek: period.dayOfWeek, sequence: period.sequence, label: period.label,
          startTime: period.startTime, endTime: period.endTime,
          isBreak: period.isBreak, isLunch: period.isLunch, isTeaching: !period.isBreak && !period.isLunch,
        })),
      });
      await this.audit.record({
        schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.bell_schedule.saved',
        entityType: 'TimetablePeriod', entityId: input.academicYearId,
        summary: `${input.periods.length} period(s) defined across ${new Set(input.periods.map((p) => p.dayOfWeek)).size} day(s)`,
      });
      return tx.timetablePeriod.count({ where: { schoolId: user.schoolId, academicYearId: input.academicYearId } });
    });
    return { periods: saved };
  }

  async listPeriods(user: AuthPrincipal, academicYearId: string) {
    const periods = await this.prisma.timetablePeriod.findMany({
      where: { schoolId: user.schoolId, academicYearId },
      orderBy: [{ dayOfWeek: 'asc' }, { sequence: 'asc' }],
    });
    return periods.map((p) => ({
      id: p.id, dayOfWeek: p.dayOfWeek, sequence: p.sequence, label: p.label,
      startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak, isLunch: p.isLunch, isTeaching: p.isTeaching,
    }));
  }

  /* -------------------------------- rooms ------------------------------- */

  async listRooms(user: AuthPrincipal) {
    return this.prisma.room.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' }, include: { _count: { select: { classes: true } } } });
  }

  async upsertRoom(user: AuthPrincipal, input: RoomInput & { id?: string }) {
    const room = input.id
      ? await this.prisma.room.findFirst({ where: { id: input.id, schoolId: user.schoolId } })
      : null;
    if (input.id && !room) throw new TenantIsolationException('Room');
    const saved = room
      ? await this.prisma.room.update({
          where: { id: room.id },
          data: { name: input.name, code: input.code ?? null, kind: input.kind, capacity: input.capacity ?? null, isActive: input.isActive },
        })
      : await this.prisma.room.create({
          data: { schoolId: user.schoolId, name: input.name, code: input.code ?? null, kind: input.kind, capacity: input.capacity ?? null, isActive: input.isActive },
        });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'room.upserted', entityType: 'Room', entityId: saved.id, after: { name: saved.name, kind: saved.kind } });
    return saved;
  }

  /* ----------------------------- timetables ----------------------------- */

  async list(user: AuthPrincipal, filters: { academicYearId?: string; termId?: string; status?: string } = {}) {
    const timetables = await this.prisma.timetable.findMany({
      where: {
        schoolId: user.schoolId,
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
        ...(filters.termId ? { termId: filters.termId } : {}),
        ...(filters.status ? { status: filters.status as TimetableStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        academicYear: { select: { id: true, name: true } },
        term: { select: { id: true, name: true } },
        createdBy: { select: { fullName: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: { publishedBy: { select: { fullName: true } }, _count: { select: { entries: true, conflicts: true } } },
        },
      },
    });

    return timetables.map((timetable) => {
      const current = timetable.versions.find((v) => v.isCurrent) ?? timetable.versions[0] ?? null;
      return {
        id: timetable.id, name: timetable.name, description: timetable.description,
        academicYearId: timetable.academicYearId, academicYearName: timetable.academicYear.name,
        termId: timetable.termId, termName: timetable.term.name, scope: timetable.scope, status: timetable.status,
        currentVersionId: timetable.currentVersionId, publishedAt: timetable.publishedAt?.toISOString() ?? null,
        createdAt: timetable.createdAt.toISOString(), createdByName: timetable.createdBy.fullName,
        versions: timetable.versions.map((v) => ({
          id: v.id, timetableId: v.timetableId, versionNumber: v.versionNumber, status: v.status, notes: v.notes,
          generatedAt: v.generatedAt?.toISOString() ?? null, publishedAt: v.publishedAt?.toISOString() ?? null,
          publishedByName: v.publishedBy?.fullName ?? null, supersededAt: v.supersededAt?.toISOString() ?? null,
          entryCount: v._count.entries, isCurrent: v.isCurrent, conflictSummary: (v.validationSummary as unknown) ?? null,
        })),
        currentVersion: current
          ? { id: current.id, versionNumber: current.versionNumber, status: current.status, entryCount: current._count.entries, conflictCount: current._count.conflicts, isCurrent: current.isCurrent }
          : null,
      };
    });
  }

  async create(user: AuthPrincipal, input: TimetableInput) {
    const [year, term] = await Promise.all([
      this.prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: user.schoolId } }),
      this.prisma.term.findFirst({ where: { id: input.termId, schoolId: user.schoolId } }),
    ]);
    if (!year) throw new TenantIsolationException('Academic year');
    if (!term) throw new TenantIsolationException('Term');
    if (term.academicYearId !== year.id) throw new BusinessRuleException('The selected term does not belong to the selected academic year.');

    const timetable = await this.prisma.timetable.create({
      data: {
        schoolId: user.schoolId, academicYearId: input.academicYearId, termId: input.termId,
        name: input.name, description: input.description ?? null, scope: input.scope,
        gradeId: input.gradeId || null, createdById: user.userId, status: 'DRAFT', config: input.config as never,
      },
    });
    const version = await this.prisma.timetableVersion.create({
      data: { timetableId: timetable.id, schoolId: user.schoolId, versionNumber: 1, status: 'DRAFT', notes: 'Initial draft', isCurrent: true },
    });
    await this.prisma.timetable.update({ where: { id: timetable.id }, data: { currentVersionId: version.id } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.created', entityType: 'Timetable', entityId: timetable.id, after: { name: input.name, term: term.name } });
    return { ...timetable, currentVersionId: version.id };
  }

  /* --------------------------- generation flow -------------------------- */

  /** Step 1 of the admin workflow: show what the generator will use and what blocks it. */
  async preflight(user: AuthPrincipal, params: { academicYearId: string; termId?: string; classIds?: string[] }) {
    const [periods, classes, requirements, assignments, teachers, access] = await Promise.all([
      this.prisma.timetablePeriod.findMany({ where: { schoolId: user.schoolId, academicYearId: params.academicYearId }, orderBy: [{ dayOfWeek: 'asc' }, { sequence: 'asc' }] }),
      this.prisma.class.findMany({
        where: { schoolId: user.schoolId, academicYearId: params.academicYearId, isActive: true, ...(params.classIds?.length ? { id: { in: params.classIds } } : {}) },
        include: { grade: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      }),
      this.prisma.classLearningAreaRequirement.findMany({
        where: { schoolId: user.schoolId, class: { academicYearId: params.academicYearId, ...(params.classIds?.length ? { id: { in: params.classIds } } : {}) } },
        include: { learningArea: { select: { id: true, name: true } } },
      }),
      this.prisma.teacherAssignment.findMany({ where: { schoolId: user.schoolId, isActive: true }, include: { teacher: { include: { user: { select: { fullName: true } } } } } }),
      this.prisma.teacherProfile.findMany({ where: { schoolId: user.schoolId, isActive: true }, include: { availability: true, user: { select: { fullName: true } } } }),
      this.tenant.currentContext(user.schoolId),
    ]);

    const teachingSlots = periods.filter((p) => p.isTeaching && !p.isBreak && !p.isLunch);
    const issues: { code: string; severity: 'ERROR' | 'WARNING'; message: string; suggestion?: string }[] = [];

    if (!periods.length) issues.push({ code: 'NO_BELL_SCHEDULE', severity: 'ERROR', message: 'No school periods are defined for this academic year.', suggestion: 'Configure the bell schedule (days, periods, breaks and lunch) first.' });
    if (!classes.length) issues.push({ code: 'NO_CLASSES', severity: 'ERROR', message: 'No active classes were found for this academic year.' });
    if (!requirements.length) issues.push({ code: 'NO_REQUIREMENTS', severity: 'ERROR', message: 'No weekly period requirements are configured for the selected classes.', suggestion: 'Set periods per week for each class and learning area.' });

    const assignmentKey = new Set(assignments.map((a) => `${a.classId}|${a.learningAreaId}`));
    const missing = requirements.filter((r) => !assignmentKey.has(`${r.classId}|${r.learningAreaId}`));
    if (missing.length) {
      issues.push({
        code: 'MISSING_TEACHER_ASSIGNMENT', severity: 'ERROR',
        message: `${missing.length} class/learning-area allocation(s) have no teacher assigned.`,
        suggestion: 'Assign teachers under Teacher Assignments before generating.',
      });
    }

    const emptyClasses = classes.filter((c) => c._count.enrollments === 0);
    if (emptyClasses.length) {
      issues.push({ code: 'CLASS_WITHOUT_LEARNERS', severity: 'WARNING', message: `${emptyClasses.length} class(es) have no active learners: ${emptyClasses.map((c) => c.name).join(', ')}.` });
    }

    const perClass = classes.map((klass) => {
      const classRequirements = requirements.filter((r) => r.classId === klass.id);
      const required = classRequirements.reduce((sum, r) => sum + r.periodsPerWeek, 0);
      return {
        classId: klass.id, className: klass.name, gradeName: klass.grade.name,
        learners: klass._count.enrollments, requiredPeriods: required, capacity: teachingSlots.length,
        learningAreas: classRequirements.map((r) => ({ learningAreaId: r.learningAreaId, name: r.learningArea.name, periodsPerWeek: r.periodsPerWeek })),
        feasible: required <= teachingSlots.length,
      };
    });
    for (const row of perClass.filter((c) => !c.feasible)) {
      issues.push({
        code: 'INSUFFICIENT_CAPACITY', severity: 'ERROR',
        message: `${row.className} requires ${row.requiredPeriods} periods but only ${row.capacity} teaching slots exist.`,
        suggestion: 'Reduce weekly requirements, add teaching periods, or extend the school day.',
      });
    }

    return {
      academicYearId: params.academicYearId, termId: params.termId ?? null,
      school: { workingDays: access.school.workingDays, maxPeriodsPerDay: access.school.maxPeriodsPerDay, timezone: access.school.timezone },
      periods: periods.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek, sequence: p.sequence, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak, isLunch: p.isLunch, isTeaching: p.isTeaching })),
      teachingSlotCount: teachingSlots.length,
      classes: perClass,
      teachers: teachers.map((t) => ({
        id: t.id, name: t.user.fullName, staffNumber: t.staffNumber,
        maxPeriodsPerDay: t.maxPeriodsPerDay, maxPeriodsPerWeek: t.maxPeriodsPerWeek,
        unavailableSlots: t.availability.length, assignments: assignments.filter((a) => a.teacherId === t.id).length,
      })),
      assignments: assignments.map((a) => ({
        assignmentId: a.id, teacherId: a.teacherId, teacherName: a.teacher.user.fullName,
        classId: a.classId, learningAreaId: a.learningAreaId,
        weeklyLimit: a.teacher.maxPeriodsPerWeek, dailyLimit: a.teacher.maxPeriodsPerDay,
      })),
      issues,
      ready: issues.filter((i) => i.severity === 'ERROR').length === 0,
      blockingIssueCount: issues.filter((i) => i.severity === 'ERROR').length,
      warningCount: issues.filter((i) => i.severity === 'WARNING').length,
    };
  }

  /** Step 2: run the generator and persist the result as a new draft version. */
  async generate(user: AuthPrincipal, input: GenerateInput) {
    const preflight = await this.preflight(user, { academicYearId: input.academicYearId, termId: input.termId, classIds: input.classIds });
    if (!preflight.ready) {
      return {
        jobId: 'not-started', status: 'FAILED' as const, assigned: 0, unplaced: 0,
        conflicts: [], diagnostics: preflight.issues.filter((i) => i.severity === 'ERROR').map((i) => ({ code: i.code, severity: i.severity, message: i.message, suggestion: i.suggestion })),
        stats: {
          classesConsidered: preflight.classes.length, lessonsRequired: 0, lessonsPlaced: 0, lessonsUnplaced: 0,
          slotsAvailable: preflight.teachingSlotCount, teachersConsidered: preflight.teachers.length,
          hardConflicts: 0, softViolations: 0, score: 0, attempts: 0,
        },
        durationMs: 0,
        message: 'Generation was not started because blocking setup problems were found. Resolve the listed issues and try again.',
      };
    }

    const started = Date.now();
    const [periods, classes, requirements, assignments, teachers, rooms, access, lockedEntries] = await Promise.all([
      this.prisma.timetablePeriod.findMany({ where: { schoolId: user.schoolId, academicYearId: input.academicYearId }, orderBy: [{ dayOfWeek: 'asc' }, { sequence: 'asc' }] }),
      this.prisma.class.findMany({ where: { schoolId: user.schoolId, id: { in: input.classIds } }, select: { id: true, name: true, roomId: true } }),
      this.prisma.classLearningAreaRequirement.findMany({ where: { classId: { in: input.classIds } }, include: { learningArea: { select: { name: true } } } }),
      this.prisma.teacherAssignment.findMany({ where: { schoolId: user.schoolId, isActive: true, classId: { in: input.classIds } }, include: { teacher: { include: { user: { select: { fullName: true } } } } } }),
      this.prisma.teacherProfile.findMany({ where: { schoolId: user.schoolId, isActive: true }, include: { availability: true, user: { select: { fullName: true } } } }),
      this.prisma.room.findMany({ where: { schoolId: user.schoolId, isActive: true }, include: { classes: { select: { id: true } } } }),
      this.tenant.currentContext(user.schoolId),
      input.keepLockedEntries && input.basedOnVersionId
        ? this.prisma.timetableEntry.findMany({ where: { versionId: input.basedOnVersionId, isLocked: true, schoolId: user.schoolId } })
        : Promise.resolve([] as { classId: string; learningAreaId: string; teacherId: string | null; periodId: string }[]),
    ]);

    const config: GeneratorConfig = {
      seed: input.config?.seed ?? SCHEDULING_DEFAULTS.randomTieBreakSeedDefault,
      maxConsecutiveSameArea: input.config?.maxConsecutiveSameArea ?? SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerLearningArea,
      maxConsecutiveTeacherPeriods: input.config?.maxConsecutiveTeacherPeriods ?? SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerTeacher,
      maxPeriodsPerDayPerClass: input.config?.maxPeriodsPerDayPerClass ?? Math.min(SCHEDULING_DEFAULTS.maxPeriodsPerDayPerClass, access.school.maxPeriodsPerDay),
      respectTeacherFreeDays: input.config?.respectTeacherFreeDays ?? true,
      useRooms: input.config?.useRooms ?? false,
      balanceDailyLoad: input.config?.balanceDailyLoad ?? true,
      avoidTeacherGaps: input.config?.avoidTeacherGaps ?? true,
      preferDoubleLessons: input.config?.preferDoubleLessons ?? false,
      teacherGapPenalty: input.config?.teacherGapPenalty ?? SCHEDULING_DEFAULTS.teacherGapPenalty,
      classGapPenalty: input.config?.classGapPenalty ?? SCHEDULING_DEFAULTS.classGapPenalty,
      sameSubjectSameDayPenalty: input.config?.sameSubjectSameDayPenalty ?? SCHEDULING_DEFAULTS.sameSubjectSameDayPenalty,
      consecutiveSameSubjectPenalty: input.config?.consecutiveSameSubjectPenalty ?? SCHEDULING_DEFAULTS.consecutiveSameSubjectPenalty,
      teacherConsecutivePenalty: input.config?.teacherConsecutivePenalty ?? SCHEDULING_DEFAULTS.teacherConsecutivePenalty,
      balanceDailyLoadPenalty: input.config?.balanceDailyLoadPenalty ?? SCHEDULING_DEFAULTS.balanceDailyLoadPenalty,
      moveStabilityBonus: SCHEDULING_DEFAULTS.moveStabilityBonus,
      timeBudgetMs: input.config?.timeLimitMs ?? 12000,
    };

    const generator = new TimetableGenerator({
      periods: periods.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek, sequence: p.sequence, startTime: p.startTime, endTime: p.endTime, isTeaching: p.isTeaching, isBreak: p.isBreak, isLunch: p.isLunch })),
      requirements: requirements.map((r) => ({
        classId: r.classId, className: classes.find((c) => c.id === r.classId)?.name ?? r.classId,
        learningAreaId: r.learningAreaId, learningAreaName: r.learningArea.name, periodsPerWeek: r.periodsPerWeek,
        preferDoubleLesson: r.preferDoubleLesson, preferMorning: r.preferMorning, requiredRoomId: r.requiredRoomId,
      })),
      assignments: assignments.map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId, teacherId: a.teacherId, teacherName: a.teacher.user.fullName })),
      teachers: teachers.map((t) => ({
        id: t.id, name: t.user.fullName, maxPeriodsPerDay: t.maxPeriodsPerDay, maxPeriodsPerWeek: t.maxPeriodsPerWeek,
        prefersFreeDays: t.prefersFreeDays,
        unavailable: t.availability.filter((a) => !a.isAvailable).map((a) => ({ dayOfWeek: a.dayOfWeek, periodIndex: a.periodIndex })),
        assignments: assignments.filter((a) => a.teacherId === t.id).map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId })),
      })),
      rooms: config.useRooms ? rooms.map((r) => ({ id: r.id, name: r.name, classIds: r.classes.map((c) => c.id) })) : [],
      config,
      lockedEntries: lockedEntries.map((e) => ({ classId: e.classId, learningAreaId: e.learningAreaId, teacherId: e.teacherId, periodId: e.periodId })),
    });

    const result = generator.run();

    const { timetableId, versionId, versionNumber } = await this.prisma.$transaction(async (tx) => {
      let timetable = input.timetableId ? await tx.timetable.findFirst({ where: { id: input.timetableId, schoolId: user.schoolId } }) : null;
      if (input.timetableId && !timetable) throw new TenantIsolationException('Timetable');
      if (!timetable) {
        timetable = await tx.timetable.create({
          data: {
            schoolId: user.schoolId, academicYearId: input.academicYearId, termId: input.termId,
            name: input.name ?? `Timetable ${new Date().toISOString().slice(0, 10)}`,
            scope: 'WHOLE_SCHOOL', createdById: user.userId, status: 'DRAFT', config: config as never,
          },
        });
      }
      const lastVersion = await tx.timetableVersion.findFirst({ where: { timetableId: timetable.id }, orderBy: { versionNumber: 'desc' } });
      const nextNumber = (lastVersion?.versionNumber ?? 0) + 1;
      await tx.timetableVersion.updateMany({ where: { timetableId: timetable.id, status: 'DRAFT' }, data: { isCurrent: false } });
      const version = await tx.timetableVersion.create({
        data: {
          timetableId: timetable.id, schoolId: user.schoolId, versionNumber: nextNumber, status: 'DRAFT',
          notes: `Generated from configuration (seed ${config.seed})`, generatedAt: new Date(), generatedById: user.userId,
          isCurrent: true, entryCount: result.entries.length,
          validationSummary: { stats: result.stats, diagnostics: result.diagnostics.slice(0, 50) } as never,
        },
      });
      if (result.entries.length) {
        const assignmentMap = new Map(assignments.map((a) => [`${a.classId}|${a.learningAreaId}`, a.id]));
        await tx.timetableEntry.createMany({
          data: result.entries.map((entry) => ({
            versionId: version.id, schoolId: user.schoolId, classId: entry.classId, learningAreaId: entry.learningAreaId,
            teacherId: entry.teacherId, teacherAssignmentId: assignmentMap.get(`${entry.classId}|${entry.learningAreaId}`) ?? null,
            periodId: entry.periodId, dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, roomId: entry.roomId,
            isDoubleLesson: entry.isDoubleLesson, doubleLessonGroupId: entry.doubleLessonGroupId, createdById: user.userId,
          })),
        });
      }
      await tx.timetable.update({ where: { id: timetable.id }, data: { currentVersionId: version.id, status: 'DRAFT' } });
      return { timetableId: timetable.id, versionId: version.id, versionNumber: nextNumber };
    });

    const validation = await this.validateVersion(user, versionId, { persist: true });
    const job = await this.prisma.timetableGenerationJob.create({
      data: {
        schoolId: user.schoolId, timetableId, requestedById: user.userId, status: 'COMPLETED',
        params: { ...input, config } as never, diagnostics: result.diagnostics as never, stats: result.stats as never,
        startedAt: new Date(started), finishedAt: new Date(),
      },
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.generated', entityType: 'TimetableVersion', entityId: versionId,
      summary: `Version ${versionNumber}: ${result.stats.lessonsPlaced}/${result.stats.lessonsRequired} lesson(s) placed, ${validation.summary.errors} hard conflict(s), ${result.stats.repairsUsed} repair(s)`,
      after: { stats: result.stats, conflicts: validation.summary },
    });

    return {
      jobId: job.id, status: 'COMPLETED' as const, timetableId, versionId, versionNumber,
      assigned: result.stats.lessonsPlaced, unplaced: result.stats.lessonsUnplaced,
      conflicts: validation.conflicts, diagnostics: result.diagnostics,
      stats: { ...result.stats, hardConflicts: validation.summary.errors, softViolations: validation.summary.warnings },
      feasibility: result.feasibility,
      durationMs: Date.now() - started,
      message:
        result.stats.lessonsUnplaced === 0 && validation.summary.errors === 0
          ? `Timetable generated: all ${result.stats.lessonsPlaced} lesson(s) placed with no hard conflicts. Review and publish when ready.`
          : `Timetable generated with ${result.stats.lessonsUnplaced} unplaced lesson(s) and ${validation.summary.errors} hard conflict(s). Review the diagnostics below.`,
    };
  }

  /* ------------------------------ validation ---------------------------- */

  async validateVersion(user: AuthPrincipal, versionId: string, opts: { persist?: boolean } = {}) {
    const version = await this.prisma.timetableVersion.findFirst({ where: { id: versionId, schoolId: user.schoolId }, include: { timetable: true } });
    if (!version) throw new TenantIsolationException('Timetable version');

    const [entries, periods, requirements, teachers, assignments, rooms, enrollments, school] = await Promise.all([
      this.prisma.timetableEntry.findMany({
        where: { versionId },
        include: {
          class: { select: { id: true, name: true } }, learningArea: { select: { id: true, name: true } },
          teacher: { include: { user: { select: { fullName: true } } } }, room: { select: { id: true, name: true } }, period: true,
        },
      }),
      this.prisma.timetablePeriod.findMany({ where: { schoolId: user.schoolId, academicYearId: version.timetable.academicYearId } }),
      this.prisma.classLearningAreaRequirement.findMany({
        where: { schoolId: user.schoolId, class: { academicYearId: version.timetable.academicYearId } },
        include: { class: { select: { name: true } }, learningArea: { select: { name: true } } },
      }),
      this.prisma.teacherProfile.findMany({ where: { schoolId: user.schoolId, isActive: true }, include: { availability: true, user: { select: { fullName: true } } } }),
      this.prisma.teacherAssignment.findMany({ where: { schoolId: user.schoolId, isActive: true } }),
      this.prisma.room.findMany({ where: { schoolId: user.schoolId } }),
      this.prisma.classEnrollment.findMany({
        where: { schoolId: user.schoolId, academicYearId: version.timetable.academicYearId, status: 'ACTIVE' },
        select: { learnerId: true, classId: true, learner: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.school.findUnique({ where: { id: user.schoolId }, select: { workingDays: true, schoolOpenTime: true, schoolCloseTime: true } }),
    ]);

    const enrollmentsByLearner = new Map<string, { learnerId: string; learnerName: string; classIds: string[] }>();
    for (const enrollment of enrollments) {
      const current = enrollmentsByLearner.get(enrollment.learnerId) ?? {
        learnerId: enrollment.learnerId, learnerName: `${enrollment.learner.firstName} ${enrollment.learner.lastName}`, classIds: [],
      };
      current.classIds.push(enrollment.classId);
      enrollmentsByLearner.set(enrollment.learnerId, current);
    }

    const { conflicts, summary } = validateTimetable({
      entries: entries.map((entry) => ({
        id: entry.id, classId: entry.classId, className: entry.class.name,
        learningAreaId: entry.learningAreaId, learningAreaName: entry.learningArea.name,
        teacherId: entry.teacherId, teacherName: entry.teacher?.user.fullName ?? null,
        roomId: entry.roomId, roomName: entry.room?.name ?? null,
        periodId: entry.periodId, dayOfWeek: entry.dayOfWeek, sequence: entry.sequence,
        periodLabel: entry.period.label, isLocked: entry.isLocked,
      })),
      periods: periods.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek, sequence: p.sequence, label: p.label, startTime: p.startTime, endTime: p.endTime, isTeaching: p.isTeaching, isBreak: p.isBreak, isLunch: p.isLunch })),
      workingDays: school?.workingDays ?? [1, 2, 3, 4, 5],
      requirements: requirements.map((r) => ({ classId: r.classId, className: r.class.name, learningAreaId: r.learningAreaId, learningAreaName: r.learningArea.name, periodsPerWeek: r.periodsPerWeek })),
      teachers: teachers.map((t) => ({
        id: t.id, name: t.user.fullName, maxPeriodsPerDay: t.maxPeriodsPerDay, maxPeriodsPerWeek: t.maxPeriodsPerWeek,
        unavailable: t.availability.filter((a) => !a.isAvailable).map((a) => ({ dayOfWeek: a.dayOfWeek, periodIndex: a.periodIndex })),
      })),
      assignments: assignments.map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId, teacherId: a.teacherId })),
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
      enrollments: [...enrollmentsByLearner.values()],
      // The school's own opening hours: lessons must sit inside them.
      schoolOpenTime: school?.schoolOpenTime ?? undefined,
      schoolCloseTime: school?.schoolCloseTime ?? undefined,
    });

    if (opts.persist) {
      const hasErrors = summary.errors > 0;
      await this.prisma.$transaction(async (tx) => {
        await tx.timetableConflict.deleteMany({ where: { versionId } });
        if (conflicts.length) {
          await tx.timetableConflict.createMany({
            data: conflicts.slice(0, 500).map((conflict) => ({
              versionId, schoolId: user.schoolId, severity: conflict.severity, code: conflict.code as never,
              message: conflict.message, suggestion: conflict.suggestion ?? null,
              classId: conflict.classId ?? null, teacherId: conflict.teacherId ?? null, roomId: conflict.roomId ?? null,
              periodId: conflict.periodId ?? null, entryId: conflict.entryId ?? null,
              dayOfWeek: conflict.dayOfWeek ?? null, sequence: conflict.sequence ?? null,
              metadata: (conflict.metadata ?? {}) as never,
            })),
          });
        }
        await tx.timetableVersion.update({ where: { id: versionId }, data: { validationSummary: summary as never } });
        // A changed grid can never stay VALIDATED/PUBLISHED: errors push it back to DRAFT.
        if (version.status === 'PUBLISHED' || version.status === 'VALIDATED' || version.status === 'DRAFT') {
          await tx.timetableVersion.update({ where: { id: versionId }, data: { status: hasErrors ? 'DRAFT' : 'VALIDATED' } });
        }
        if (hasErrors && version.timetable.status === 'PUBLISHED') {
          await tx.timetable.update({ where: { id: version.timetableId }, data: { status: 'DRAFT' } });
        }
      });
    }

    return { versionId, conflicts, summary, validated: summary.errors === 0 };
  }

  /* --------------------------------- views ------------------------------ */

  async getVersionView(user: AuthPrincipal, versionId: string, view: { classId?: string; teacherId?: string; roomId?: string } = {}) {
    const version = await this.prisma.timetableVersion.findFirst({ where: { id: versionId, schoolId: user.schoolId }, include: { timetable: true } });
    if (!version) throw new TenantIsolationException('Timetable version');

    // Role scoping: teachers see their own grid and their classes; parents see
    // published versions only, for a class their linked learner is enrolled in.
    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      if (view.teacherId && view.teacherId !== teacherId) throw new TenantIsolationException('Teacher timetable');
      if (view.classId) await this.tenant.assertClassAccess(user, view.classId);
    }
    if (user.role === 'PARENT') {
      if (!['PUBLISHED', 'SUPERSEDED'].includes(version.status)) throw new TenantIsolationException('Timetable');
      if (!view.classId) throw new BadRequestException('Select a linked learner to view their class timetable.');
      await this.tenant.assertClassAccess(user, view.classId);
    }

    const [entries, periods, versions, classes] = await Promise.all([
      this.prisma.timetableEntry.findMany({
        where: {
          versionId,
          ...(view.classId ? { classId: view.classId } : {}),
          ...(view.teacherId ? { teacherId: view.teacherId } : {}),
          ...(view.roomId ? { roomId: view.roomId } : {}),
        },
        orderBy: [{ dayOfWeek: 'asc' }, { sequence: 'asc' }],
        include: {
          class: { select: { id: true, name: true } },
          learningArea: { select: { id: true, name: true, shortName: true, colorHex: true } },
          teacher: { include: { user: { select: { fullName: true } } } },
          room: { select: { id: true, name: true } },
          period: { select: { id: true, label: true, startTime: true, endTime: true, isBreak: true, isLunch: true, isTeaching: true } },
        },
      }),
      this.prisma.timetablePeriod.findMany({ where: { schoolId: user.schoolId, academicYearId: version.timetable.academicYearId }, orderBy: [{ dayOfWeek: 'asc' }, { sequence: 'asc' }] }),
      this.prisma.timetableVersion.findMany({ where: { timetableId: version.timetableId }, orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, status: true, publishedAt: true, isCurrent: true, entryCount: true } }),
      this.prisma.class.findMany({
        where: { schoolId: user.schoolId, academicYearId: version.timetable.academicYearId, isActive: true },
        orderBy: [{ grade: { level: 'asc' } }, { name: 'asc' }],
        select: { id: true, name: true, grade: { select: { level: true, name: true } } },
      }),
    ]);

    const conflictContext = await this.conflictContext(user, versionId);

    return {
      version: {
        id: version.id, versionNumber: version.versionNumber, status: version.status, notes: version.notes,
        generatedAt: version.generatedAt?.toISOString() ?? null, publishedAt: version.publishedAt?.toISOString() ?? null,
        isCurrent: version.isCurrent, entryCount: entries.length, validationSummary: version.validationSummary,
      },
      timetable: { id: version.timetable.id, name: version.timetable.name, academicYearId: version.timetable.academicYearId, termId: version.timetable.termId, status: version.timetable.status },
      periods: periods.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek, sequence: p.sequence, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak, isLunch: p.isLunch, isTeaching: p.isTeaching })),
      entries: entries.map((entry) => ({
        id: entry.id, dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, periodId: entry.periodId,
        classId: entry.classId, className: entry.class.name,
        learningAreaId: entry.learningAreaId, learningAreaName: entry.learningArea.name, learningAreaColor: entry.learningArea.colorHex,
        teacherId: entry.teacherId, teacherName: entry.teacher?.user.fullName ?? null,
        roomId: entry.roomId, roomName: entry.room?.name ?? null,
        isDoubleLesson: entry.isDoubleLesson, isLocked: entry.isLocked, note: entry.note,
        startTime: entry.period.startTime, endTime: entry.period.endTime, periodLabel: entry.period.label,
      })),
      conflicts: conflictContext,
      versions,
      classes: classes.map((c) => ({ id: c.id, name: c.name, gradeName: c.grade.name, gradeLevel: c.grade.level })),
      editable: user.role === 'ADMIN' && ['DRAFT', 'VALIDATED'].includes(version.status),
    };
  }

  /** Teacher's own weekly grid. */
  async myTimetable(user: AuthPrincipal, opts: { academicYearId?: string; termId?: string } = {}) {
    if (user.role === 'PARENT') throw new BusinessRuleException('Parents should use the learner timetable endpoint.');
    const teacherId = await this.tenant.teacherProfileId(user);
    const version = await this.findRelevantVersion(user, { academicYearId: opts.academicYearId, termId: opts.termId, preferPublished: isTeacherRole(user.role) });
    if (!version) return { published: false, lessons: [], periods: [], versionNumber: null, publishedAt: null };

    const view = await this.getVersionView(user, version.id, { teacherId });
    const lessons = view.entries
      .map((entry) => ({
        dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, startTime: entry.startTime, endTime: entry.endTime,
        learningAreaName: entry.learningAreaName, learningAreaColor: entry.learningAreaColor,
        className: entry.className, roomName: entry.roomName, periodLabel: entry.periodLabel,
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.sequence - b.sequence);

    return {
      published: version.status === 'PUBLISHED' || version.status === 'SUPERSEDED',
      versionId: version.id, versionNumber: version.versionNumber,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      periods: view.periods, lessons,
      conflictCount: view.conflicts.filter((c) => c.severity === 'ERROR').length,
    };
  }

  /** Class timetable for a learner's guardian (published versions only). */
  async learnerTimetable(user: AuthPrincipal, learnerId: string, opts: { academicYearId?: string; termId?: string } = {}) {
    const learner = await this.tenant.assertLearnerAccess(user, learnerId);
    if (!learner.currentClassId) {
      return { published: false, className: null, classId: null, lessons: [], periods: [], versionNumber: null, publishedAt: null };
    }
    await this.tenant.assertClassAccess(user, learner.currentClassId);

    const version = await this.findRelevantVersion(user, { academicYearId: opts.academicYearId, termId: opts.termId, preferPublished: true });
    if (!version) {
      return { published: false, className: null, classId: learner.currentClassId, lessons: [], periods: [], versionNumber: null, publishedAt: null };
    }

    const view = await this.getVersionView(user, version.id, { classId: learner.currentClassId });
    const klass = view.classes.find((c) => c.id === learner.currentClassId);
    return {
      published: version.status === 'PUBLISHED' || version.status === 'SUPERSEDED',
      versionId: version.id, versionNumber: version.versionNumber,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      className: klass?.name ?? null, classId: learner.currentClassId,
      periods: view.periods,
      lessons: view.entries.map((entry) => ({
        dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, startTime: entry.startTime, endTime: entry.endTime,
        learningAreaName: entry.learningAreaName, learningAreaColor: entry.learningAreaColor,
        teacherName: entry.teacherName, className: entry.className, roomName: entry.roomName, periodLabel: entry.periodLabel,
      })),
    };
  }

  private async findRelevantVersion(user: AuthPrincipal, opts: { academicYearId?: string; termId?: string; preferPublished: boolean }) {
    const context = await this.tenant.currentContext(user.schoolId);
    const academicYearId = opts.academicYearId ?? context.school.currentAcademicYearId ?? undefined;
    const termId = opts.termId ?? context.school.currentTermId ?? undefined;

    const versions = await this.prisma.timetableVersion.findMany({
      where: {
        schoolId: user.schoolId,
        ...(opts.preferPublished ? { status: { in: ['PUBLISHED', 'SUPERSEDED'] } } : {}),
        timetable: { ...(academicYearId ? { academicYearId } : {}), ...(termId ? { termId } : {}), archivedAt: null },
      },
      orderBy: { versionNumber: 'desc' },
    });
    if (!versions.length) return null;
    return versions.find((v) => v.status === 'PUBLISHED' && v.isCurrent) ?? versions.find((v) => v.status === 'PUBLISHED') ?? versions[0] ?? null;
  }

  /* ---------------------------- manual editing -------------------------- */

  /**
   * Moves or reassigns a single lesson. The change is validated immediately, so
   * the administrator always sees the consequence of the edit.
   */
  async moveEntry(user: AuthPrincipal, input: MoveInput) {
    const entry = await this.prisma.timetableEntry.findFirst({
      where: { id: input.entryId, versionId: input.versionId, schoolId: user.schoolId },
      include: { version: { include: { timetable: true } } },
    });
    if (!entry) throw new TenantIsolationException('Timetable entry');
    if (entry.version.status === 'PUBLISHED' || entry.version.status === 'SUPERSEDED') {
      throw new BusinessRuleException('A published timetable is read-only. Create a new draft version to make changes.');
    }

    let targetPeriodId = input.targetPeriodId;
    if (!targetPeriodId && input.targetDayOfWeek && input.targetSequence) {
      const period = await this.prisma.timetablePeriod.findFirst({
        where: { schoolId: user.schoolId, academicYearId: entry.version.timetable.academicYearId, dayOfWeek: input.targetDayOfWeek, sequence: input.targetSequence },
      });
      if (!period) throw new BadRequestException('That day and period do not exist in the bell schedule.');
      targetPeriodId = period.id;
    }
    if (!targetPeriodId) throw new BadRequestException('Select a target period for the lesson.');

    const target = await this.prisma.timetablePeriod.findFirst({ where: { id: targetPeriodId, schoolId: user.schoolId } });
    if (!target) throw new TenantIsolationException('Period');
    if (target.isBreak || target.isLunch || !target.isTeaching) {
      throw new BusinessRuleException(`Period "${target.label}" is not a teaching period, so a lesson cannot be moved there.`);
    }

    let teacherId = entry.teacherId;
    if (input.teacherId !== undefined && input.teacherId !== null) {
      const assignment = await this.prisma.teacherAssignment.findFirst({
        where: { classId: entry.classId, learningAreaId: entry.learningAreaId, teacherId: input.teacherId, isActive: true },
      });
      if (!assignment) throw new BusinessRuleException('You can only assign a teacher who is assigned to this class and learning area.');
      teacherId = input.teacherId;
    }

    const clash = await this.prisma.timetableEntry.findFirst({
      where: {
        versionId: input.versionId, periodId: target.id, NOT: { id: entry.id },
        OR: [{ classId: entry.classId }, ...(teacherId ? [{ teacherId }] : [])],
      },
      include: { class: { select: { name: true } }, learningArea: { select: { name: true } }, teacher: { include: { user: { select: { fullName: true } } } } },
    });
    if (clash) {
      const reason =
        clash.classId === entry.classId
          ? `${clash.class.name} already has ${clash.learningArea.name} in that period.`
          : `${clash.teacher?.user.fullName ?? 'That teacher'} is already teaching ${clash.class.name} in that period.`;
      throw new BadRequestException(`${reason} Choose a free period or swap the two lessons.`);
    }

    const blockedSlot = teacherId
      ? await this.prisma.teacherAvailability.findFirst({ where: { teacherId, dayOfWeek: target.dayOfWeek, periodIndex: target.sequence, isAvailable: false } })
      : null;
    if (blockedSlot) {
      throw new BadRequestException(
        `The teacher is marked unavailable at ${target.label} on day ${target.dayOfWeek}. Choose another period or update their availability.`,
      );
    }

    const before = { periodId: entry.periodId, dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, teacherId: entry.teacherId, roomId: entry.roomId };

    const updated = await this.prisma.$transaction(async (tx) => {
      const assignment = teacherId
        ? await tx.teacherAssignment.findFirst({ where: { classId: entry.classId, learningAreaId: entry.learningAreaId, teacherId, isActive: true }, select: { id: true } })
        : null;
      const next = await tx.timetableEntry.update({
        where: { id: entry.id },
        data: {
          periodId: target.id, dayOfWeek: target.dayOfWeek, sequence: target.sequence,
          teacherId, teacherAssignmentId: assignment?.id ?? entry.teacherAssignmentId,
          ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
        },
      });
      await tx.timetableVersion.update({ where: { id: input.versionId }, data: { status: 'DRAFT', isCurrent: true } });
      await tx.timetable.update({ where: { id: entry.version.timetableId }, data: { status: 'DRAFT' } });
      return next;
    });

    const validation = await this.validateVersion(user, input.versionId, { persist: true });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.entry.moved', entityType: 'TimetableEntry', entityId: entry.id,
      summary: `Lesson moved to day ${target.dayOfWeek} ${target.label}${input.reason ? ` — ${input.reason}` : ''}`,
      before, after: { periodId: target.id, dayOfWeek: target.dayOfWeek, teacherId },
    });

    return {
      entry: updated, conflicts: validation.conflicts, summary: validation.summary,
      hardConflictsRemaining: validation.summary.errors, revalidated: true,
    };
  }

  async addEntry(user: AuthPrincipal, versionId: string, input: EntryInput) {
    const version = await this.prisma.timetableVersion.findFirst({ where: { id: versionId, schoolId: user.schoolId } });
    if (!version) throw new TenantIsolationException('Timetable version');
    if (version.status === 'PUBLISHED') throw new BusinessRuleException('Published timetables are read-only.');

    const period = await this.prisma.timetablePeriod.findFirst({ where: { id: input.periodId, schoolId: user.schoolId } });
    if (!period) throw new TenantIsolationException('Period');
    if (!period.isTeaching || period.isBreak || period.isLunch) throw new BusinessRuleException('Lessons can only be placed in teaching periods.');

    const assignment = await this.prisma.teacherAssignment.findFirst({
      where: { classId: input.classId, learningAreaId: input.learningAreaId, isActive: true },
      select: { id: true, teacherId: true },
    });
    if (!assignment) throw new BusinessRuleException('No teacher is assigned to this class and learning area. Assign one first.');

    const teacherId = input.teacherId ?? assignment.teacherId;
    const clash = await this.prisma.timetableEntry.findFirst({
      where: { versionId, periodId: input.periodId, OR: [{ classId: input.classId }, { teacherId }] },
    });
    if (clash) throw new BadRequestException('That period is already taken for this class or teacher.');

    const entry = await this.prisma.timetableEntry.create({
      data: {
        versionId, schoolId: user.schoolId, classId: input.classId, learningAreaId: input.learningAreaId,
        teacherId, teacherAssignmentId: assignment.id,
        periodId: period.id, dayOfWeek: period.dayOfWeek, sequence: period.sequence, roomId: input.roomId ?? null,
        isDoubleLesson: input.isDoubleLesson, isLocked: input.isLocked, note: input.note ?? null, createdById: user.userId,
      },
    });
    await this.prisma.timetableVersion.update({ where: { id: versionId }, data: { status: 'DRAFT' } });
    const validation = await this.validateVersion(user, versionId, { persist: true });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.entry.added', entityType: 'TimetableEntry', entityId: entry.id, after: { classId: input.classId, learningAreaId: input.learningAreaId, periodId: period.id } });
    return { entry, summary: validation.summary, conflicts: validation.conflicts };
  }

  async deleteEntry(user: AuthPrincipal, entryId: string) {
    const entry = await this.prisma.timetableEntry.findFirst({ where: { id: entryId, schoolId: user.schoolId }, include: { version: true } });
    if (!entry) throw new TenantIsolationException('Timetable entry');
    if (entry.version.status === 'PUBLISHED') throw new BusinessRuleException('Published timetables are read-only.');
    await this.prisma.timetableEntry.delete({ where: { id: entryId } });
    await this.prisma.timetableVersion.update({ where: { id: entry.versionId }, data: { status: 'DRAFT' } });
    const validation = await this.validateVersion(user, entry.versionId, { persist: true });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.entry.deleted', entityType: 'TimetableEntry', entityId: entryId, before: { classId: entry.classId, periodId: entry.periodId } });
    return { deleted: true, summary: validation.summary };
  }

  async toggleLock(user: AuthPrincipal, entryId: string, isLocked: boolean) {
    const entry = await this.prisma.timetableEntry.findFirst({ where: { id: entryId, schoolId: user.schoolId } });
    if (!entry) throw new TenantIsolationException('Timetable entry');
    const updated = await this.prisma.timetableEntry.update({ where: { id: entryId }, data: { isLocked } });
    return { id: updated.id, isLocked: updated.isLocked };
  }

  /* --------------------------- publication ------------------------------ */

  /**
   * Publishes a version.
   * The validation gate is enforced here (not only in the UI): a grid with hard
   * conflicts can never be published, even with `force`. `force` is only ever
   * able to bypass soft warnings, and those are recorded in the audit trail.
   */
  async publish(user: AuthPrincipal, input: PublishInput) {
    const version = await this.prisma.timetableVersion.findFirst({
      where: { id: input.versionId, schoolId: user.schoolId },
      include: { timetable: { include: { term: true } } },
    });
    if (!version) throw new TenantIsolationException('Timetable version');
    if (version.status === 'PUBLISHED') throw new BusinessRuleException('This version is already published.');
    if (!version.entryCount && (await this.prisma.timetableEntry.count({ where: { versionId: version.id } })) === 0) {
      throw new BusinessRuleException('This version has no lessons to publish.');
    }

    const validation = await this.validateVersion(user, input.versionId, { persist: true });
    if (validation.summary.errors > 0) {
      throw new BusinessRuleException(
        `This timetable has ${validation.summary.errors} hard conflict(s) and cannot be published. ` +
          'Hard conflicts (teacher/class double booking, lessons in breaks/lunch, unavailable teachers, workload overruns) must be resolved first.',
      );
    }

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.timetableVersion.updateMany({
        where: { timetableId: version.timetableId, status: 'PUBLISHED' },
        data: { status: 'SUPERSEDED', supersededAt: new Date(), isCurrent: false },
      });
      const next = await tx.timetableVersion.update({
        where: { id: input.versionId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: user.userId, isCurrent: true, notes: input.notes ?? version.notes },
      });
      await tx.timetable.update({ where: { id: version.timetableId }, data: { status: 'PUBLISHED', publishedAt: new Date(), currentVersionId: next.id } });
      return next;
    });

    let notifiedTeachers = 0;
    let notifiedParents = 0;
    if (input.notify) {
      const entries = await this.prisma.timetableEntry.findMany({ where: { versionId: published.id }, select: { teacherId: true, classId: true } });
      const teacherIds = [...new Set(entries.map((e) => e.teacherId).filter((id): id is string => !!id))];
      const teachers = await this.prisma.teacherProfile.findMany({ where: { id: { in: teacherIds } }, select: { userId: true } });
      notifiedTeachers = await this.notifications.notify({
        schoolId: user.schoolId,
        userIds: teachers.map((t) => t.userId),
        type: NotificationType.TIMETABLE_PUBLISHED,
        title: 'A new class timetable has been published',
        body: `Version ${published.versionNumber} for ${version.timetable.term.name} is available. Open "My Timetable" to review your teaching schedule.`,
        link: '/teacher/timetable',
        entityType: 'TimetableVersion',
        entityId: published.id,
      });

      const classIds = [...new Set(entries.map((e) => e.classId))];
      const links = await this.prisma.parentLearnerLink.findMany({
        where: { isVerified: true, revokedAt: null, learner: { enrollments: { some: { classId: { in: classIds }, status: 'ACTIVE' } } } },
        select: { parentProfile: { select: { userId: true } } },
      });
      notifiedParents = await this.notifications.notify({
        schoolId: user.schoolId,
        userIds: links.map((l) => l.parentProfile.userId),
        type: NotificationType.TIMETABLE_PUBLISHED,
        title: 'Class timetable available',
        body: `The timetable for ${version.timetable.term.name} has been published. You can now view your child's lesson schedule.`,
        link: '/parent/timetable',
        entityType: 'TimetableVersion',
        entityId: published.id,
      });
    }

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role, action: 'timetable.published',
      entityType: 'TimetableVersion', entityId: published.id,
      summary: `Version ${published.versionNumber} published${input.notes ? ` — ${input.notes}` : ''}`,
      after: { versionNumber: published.versionNumber, warnings: validation.summary.warnings, notifiedTeachers, notifiedParents },
    });

    return { versionId: published.id, versionNumber: published.versionNumber, publishedAt: published.publishedAt, summary: validation.summary, notifiedTeachers, notifiedParents };
  }

  async unpublish(user: AuthPrincipal, versionId: string, reason: string) {
    const version = await this.prisma.timetableVersion.findFirst({ where: { id: versionId, schoolId: user.schoolId }, include: { timetable: true } });
    if (!version) throw new TenantIsolationException('Timetable version');
    if (version.status !== 'PUBLISHED') throw new BusinessRuleException('Only a published version can be withdrawn.');

    await this.prisma.$transaction(async (tx) => {
      await tx.timetableVersion.update({ where: { id: versionId }, data: { status: 'DRAFT', isCurrent: true, publishedAt: null, publishedById: null } });
      await tx.timetable.update({ where: { id: version.timetableId }, data: { status: 'DRAFT', publishedAt: null } });
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.unpublished', entityType: 'TimetableVersion',
      entityId: versionId, summary: `Version ${version.versionNumber} withdrawn — ${reason}`,
    });

    const entries = await this.prisma.timetableEntry.findMany({ where: { versionId }, select: { teacherId: true } });
    const teachers = await this.prisma.teacherProfile.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.teacherId).filter((id): id is string => !!id))] } },
      select: { userId: true },
    });
    await this.notifications.notify({
      schoolId: user.schoolId,
      userIds: teachers.map((t) => t.userId),
      type: NotificationType.TIMETABLE_CHANGED,
      title: 'Timetable withdrawn for revision',
      body: `The published timetable is being revised and is temporarily unavailable. Reason: ${reason}`,
      link: '/teacher/timetable',
    });
    return { withdrawn: true };
  }

  /** Duplicates any version (typically a previous published one) into a new draft. */
  async duplicateVersion(user: AuthPrincipal, versionId: string, notes?: string) {
    const version = await this.prisma.timetableVersion.findFirst({ where: { id: versionId, schoolId: user.schoolId } });
    if (!version) throw new TenantIsolationException('Timetable version');
    const entries = await this.prisma.timetableEntry.findMany({ where: { versionId } });

    const result = await this.prisma.$transaction(async (tx) => {
      const last = await tx.timetableVersion.findFirst({ where: { timetableId: version.timetableId }, orderBy: { versionNumber: 'desc' } });
      const nextNumber = (last?.versionNumber ?? 0) + 1;
      await tx.timetableVersion.updateMany({ where: { timetableId: version.timetableId, status: 'DRAFT' }, data: { isCurrent: false } });
      const created = await tx.timetableVersion.create({
        data: {
          timetableId: version.timetableId, schoolId: user.schoolId, versionNumber: nextNumber, status: 'DRAFT',
          notes: notes ?? `Copied from version ${version.versionNumber}`, generatedById: user.userId, isCurrent: true, entryCount: entries.length,
        },
      });
      if (entries.length) {
        await tx.timetableEntry.createMany({
          data: entries.map((entry) => ({
            versionId: created.id, schoolId: user.schoolId, classId: entry.classId, learningAreaId: entry.learningAreaId,
            teacherId: entry.teacherId, teacherAssignmentId: entry.teacherAssignmentId, periodId: entry.periodId,
            dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, roomId: entry.roomId,
            isDoubleLesson: entry.isDoubleLesson, doubleLessonGroupId: entry.doubleLessonGroupId, isLocked: entry.isLocked,
            note: entry.note, createdById: user.userId,
          })),
        });
      }
      await tx.timetable.update({ where: { id: version.timetableId }, data: { currentVersionId: created.id, status: 'DRAFT' } });
      return created;
    });

    // A copy is always re-validated from scratch against the current school data.
    const validation = await this.validateVersion(user, result.id, { persist: true });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.version.duplicated', entityType: 'TimetableVersion',
      entityId: result.id, summary: `Duplicated version ${version.versionNumber} as version ${result.versionNumber}; revalidated with ${validation.summary.errors} error(s)`,
    });
    return { versionId: result.id, versionNumber: result.versionNumber, summary: validation.summary };
  }

  async archive(user: AuthPrincipal, timetableId: string, reason?: string) {
    const timetable = await this.prisma.timetable.findFirst({ where: { id: timetableId, schoolId: user.schoolId } });
    if (!timetable) throw new TenantIsolationException('Timetable');
    if (timetable.status === 'PUBLISHED') throw new BusinessRuleException('Withdraw the published timetable before archiving it.');
    await this.prisma.timetable.update({ where: { id: timetableId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'timetable.archived', entityType: 'Timetable', entityId: timetableId, summary: reason ?? 'Archived by administrator' });
    return { archived: true };
  }

  async versionHistory(user: AuthPrincipal, timetableId: string) {
    const timetable = await this.prisma.timetable.findFirst({ where: { id: timetableId, schoolId: user.schoolId } });
    if (!timetable) throw new TenantIsolationException('Timetable');
    const versions = await this.prisma.timetableVersion.findMany({
      where: { timetableId, schoolId: user.schoolId },
      orderBy: { versionNumber: 'desc' },
      include: { publishedBy: { select: { fullName: true } }, _count: { select: { entries: true, conflicts: true } } },
    });
    const audits = await this.prisma.auditLog.findMany({
      where: { schoolId: user.schoolId, OR: [{ entityId: { in: versions.map((v) => v.id) } }, { entityId: timetableId }], entityType: { in: ['TimetableVersion', 'Timetable', 'TimetableEntry'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { fullName: true } } },
    });
    return {
      versions: versions.map((v) => ({
        id: v.id, versionNumber: v.versionNumber, status: v.status, notes: v.notes,
        generatedAt: v.generatedAt?.toISOString() ?? null, publishedAt: v.publishedAt?.toISOString() ?? null,
        publishedByName: v.publishedBy?.fullName ?? null, supersededAt: v.supersededAt?.toISOString() ?? null,
        entryCount: v._count.entries, conflictCount: v._count.conflicts, isCurrent: v.isCurrent, validation: v.validationSummary,
      })),
      auditTrail: audits.map((a) => ({ id: a.id, action: a.action, summary: a.summary, actorName: a.actor?.fullName ?? 'System', createdAt: a.createdAt })),
    };
  }

  /** Whole-school grid: every class with its weekly lessons (admin overview). */
  async schoolGrid(user: AuthPrincipal, versionId: string) {
    const view = await this.getVersionView(user, versionId);
    return {
      version: view.version,
      periods: view.periods,
      classes: view.classes.map((klass) => ({
        classId: klass.id, className: klass.name, gradeName: klass.gradeName,
        lessons: view.entries
          .filter((entry) => entry.classId === klass.id)
          .map((entry) => ({
            dayOfWeek: entry.dayOfWeek, sequence: entry.sequence, learningAreaName: entry.learningAreaName,
            learningAreaColor: entry.learningAreaColor, teacherName: entry.teacherName, roomName: entry.roomName,
          })),
        weeklyPeriods: view.entries.filter((entry) => entry.classId === klass.id).length,
      })),
      conflicts: view.conflicts,
    };
  }

  /** Resolves names for the conflict panel (which shows human-readable context). */
  async conflictContext(user: AuthPrincipal, versionId: string) {
    const conflicts = await this.prisma.timetableConflict.findMany({
      where: { versionId, schoolId: user.schoolId },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    });
    const teacherIds = [...new Set(conflicts.map((c) => c.teacherId).filter((id): id is string => !!id))];
    const classIds = [...new Set(conflicts.map((c) => c.classId).filter((id): id is string => !!id))];
    const periodIds = [...new Set(conflicts.map((c) => c.periodId).filter((id): id is string => !!id))];
    const [teachers, classes, periods] = await Promise.all([
      teacherIds.length ? this.prisma.teacherProfile.findMany({ where: { id: { in: teacherIds } }, include: { user: { select: { fullName: true } } } }) : [],
      classIds.length ? this.prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } }) : [],
      periodIds.length ? this.prisma.timetablePeriod.findMany({ where: { id: { in: periodIds }, schoolId: user.schoolId } }) : [],
    ]);
    return conflicts.map((conflict) => {
      const period = periods.find((p) => p.id === conflict.periodId);
      return {
        id: conflict.id, severity: conflict.severity, code: conflict.code, message: conflict.message, suggestion: conflict.suggestion,
        classId: conflict.classId, className: classes.find((c) => c.id === conflict.classId)?.name ?? null,
        teacherId: conflict.teacherId, teacherName: teachers.find((t) => t.id === conflict.teacherId)?.user.fullName ?? null,
        roomId: conflict.roomId, periodId: conflict.periodId,
        period: period ? { label: period.label, startTime: period.startTime, endTime: period.endTime } : null,
        entryId: conflict.entryId, dayOfWeek: conflict.dayOfWeek, sequence: conflict.sequence, metadata: conflict.metadata,
      };
    });
  }
}

function findOverlaps(periods: { dayOfWeek: number; startTime: string; endTime: string }[]): { dayOfWeek: number; a: string; b: string }[] {
  const out: { dayOfWeek: number; a: string; b: string }[] = [];
  const toMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const byDay = new Map<number, { startTime: string; endTime: string }[]>();
  for (const period of periods) byDay.set(period.dayOfWeek, [...(byDay.get(period.dayOfWeek) ?? []), period]);
  for (const [day, slots] of byDay) {
    const sorted = [...slots].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1] as { startTime: string; endTime: string };
      const current = sorted[i] as { startTime: string; endTime: string };
      if (toMinutes(current.startTime) < toMinutes(previous.endTime)) {
        out.push({ dayOfWeek: day, a: `${previous.startTime}-${previous.endTime}`, b: `${current.startTime}-${current.endTime}` });
      }
    }
  }
  return out;
}
