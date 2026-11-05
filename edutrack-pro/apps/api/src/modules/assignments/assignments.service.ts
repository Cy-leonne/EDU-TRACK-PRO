import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { teacherAssignmentSchema, teacherAvailabilitySchema } from '@edutrack/validation';
import { isTeacherRole, SCHEDULING_DEFAULTS } from '@edutrack/shared-config';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantIsolationException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';

type AssignmentInput = z.infer<typeof teacherAssignmentSchema>;
type AvailabilityInput = z.infer<typeof teacherAvailabilitySchema>;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
  ) {}

  async list(user: AuthPrincipal, filters: { teacherId?: string; classId?: string; learningAreaId?: string } = {}) {
    const where: Record<string, unknown> = {
      schoolId: user.schoolId,
      isActive: true,
      ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.learningAreaId ? { learningAreaId: filters.learningAreaId } : {}),
    };
    if (isTeacherRole(user.role)) where['teacherId'] = await this.tenant.teacherProfileId(user);

    const rows = await this.prisma.teacherAssignment.findMany({
      where: where as never,
      orderBy: [{ class: { name: 'asc' } }, { learningArea: { order: 'asc' } }],
      include: {
        teacher: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        class: { include: { grade: { select: { level: true, name: true } } } },
        learningArea: { select: { id: true, name: true, code: true, colorHex: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      teacherId: a.teacherId,
      teacherName: a.teacher.user.fullName,
      teacherEmail: a.teacher.user.email,
      classId: a.classId,
      className: a.class.name,
      gradeLevel: a.class.grade.level,
      learningAreaId: a.learningAreaId,
      learningAreaName: a.learningArea.name,
      learningAreaColor: a.learningArea.colorHex,
      isPrimary: a.isPrimary,
      lessonsPerWeek: a.lessonsPerWeek,
    }));
  }

  /**
   * Creates or replaces the (single) teacher for a class + learning area.
   * The unique constraint on (classId, learningAreaId) guarantees a class never
   * has two teachers for the same learning area.
   */
  async upsert(user: AuthPrincipal, input: AssignmentInput) {
    const [teacher, klass, area] = await Promise.all([
      this.prisma.teacherProfile.findFirst({ where: { id: input.teacherId, schoolId: user.schoolId, isActive: true } }),
      this.prisma.class.findFirst({ where: { id: input.classId, schoolId: user.schoolId } }),
      this.prisma.learningArea.findFirst({ where: { id: input.learningAreaId, schoolId: user.schoolId, isActive: true } }),
    ]);
    if (!teacher) throw new BadRequestException('Select an active teacher.');
    if (!klass) throw new TenantIsolationException('Class');
    if (!area) throw new BadRequestException('Select an active learning area.');

    const requirement = await this.prisma.classLearningAreaRequirement.findUnique({
      where: { classId_learningAreaId: { classId: input.classId, learningAreaId: input.learningAreaId } },
    });
    const weeklyLoad = await this.weeklyLoad(input.teacherId);
    const requiredPeriods = requirement?.periodsPerWeek ?? 0;
    if (teacher.maxPeriodsPerWeek && weeklyLoad + requiredPeriods > teacher.maxPeriodsPerWeek) {
      throw new BadRequestException(
        `${teacher.staffNumber} already has ${weeklyLoad} periods/week and a weekly limit of ${teacher.maxPeriodsPerWeek}. ` +
          `Adding ${area.name} (${requiredPeriods} periods) would exceed it. Adjust the limit or reassign.`,
      );
    }

    const existing = await this.prisma.teacherAssignment.findUnique({
      where: { classId_learningAreaId: { classId: input.classId, learningAreaId: input.learningAreaId } },
    });
    if (existing && existing.teacherId !== input.teacherId) {
      // Handing a subject over: deactivate the old row, then create the new one.
      await this.prisma.teacherAssignment.update({ where: { id: existing.id }, data: { isActive: false, archivedAt: new Date() } });
    }

    const assignment = await this.prisma.teacherAssignment.upsert({
      where: { classId_learningAreaId: { classId: input.classId, learningAreaId: input.learningAreaId } },
      create: {
        schoolId: user.schoolId, teacherId: input.teacherId, classId: input.classId,
        learningAreaId: input.learningAreaId, isPrimary: input.isPrimary,
        lessonsPerWeek: input.lessonsPerWeek ?? null, notes: input.notes || null,
      },
      update: {
        teacherId: input.teacherId, isPrimary: input.isPrimary,
        lessonsPerWeek: input.lessonsPerWeek ?? null, notes: input.notes || null,
        isActive: true, archivedAt: null,
      },
      include: { teacher: { include: { user: { select: { fullName: true } } } }, class: true, learningArea: true },
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher-assignment.upserted',
      entityType: 'TeacherAssignment', entityId: assignment.id,
      after: { class: assignment.class.name, learningArea: assignment.learningArea.name, teacher: assignment.teacher.user.fullName },
    });
    return assignment;
  }

  async remove(user: AuthPrincipal, id: string) {
    const assignment = await this.prisma.teacherAssignment.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!assignment) throw new TenantIsolationException('Assignment');
    await this.prisma.teacherAssignment.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher-assignment.removed', entityType: 'TeacherAssignment', entityId: id });
    return { removed: true };
  }

  /** Weekly period load per teacher, derived from class requirements. */
  async weeklyLoad(teacherId: string): Promise<number> {
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { teacherId, isActive: true },
      include: { class: { include: { requirements: true } } },
    });
    let total = 0;
    for (const assignment of assignments) {
      const requirement = assignment.class.requirements.find((r) => r.learningAreaId === assignment.learningAreaId);
      total += requirement?.periodsPerWeek ?? assignment.lessonsPerWeek ?? 0;
    }
    return total;
  }

  /* --------------------------- availability ----------------------------- */

  async getAvailability(user: AuthPrincipal, teacherId: string) {
    const teacher = await this.prisma.teacherProfile.findFirst({ where: { id: teacherId, schoolId: user.schoolId }, select: { id: true } });
    if (!teacher) throw new TenantIsolationException('Teacher');
    const rows = await this.prisma.teacherAvailability.findMany({ where: { teacherId }, orderBy: [{ dayOfWeek: 'asc' }, { periodIndex: 'asc' }] });
    return rows.map((r) => ({ dayOfWeek: r.dayOfWeek, periodIndex: r.periodIndex, isAvailable: r.isAvailable, reason: r.reason }));
  }

  /**
   * Replaces the teacher's whole weekly availability grid. Rows are stored only
   * for unavailable slots, so "no row" means available (the default).
   */
  async setAvailability(user: AuthPrincipal, input: AvailabilityInput) {
    const teacher = await this.prisma.teacherProfile.findFirst({ where: { id: input.teacherId, schoolId: user.schoolId } });
    if (!teacher) throw new TenantIsolationException('Teacher');
    const context = await this.tenant.currentContext(user.schoolId);
    if (!context.school.currentAcademicYearId) throw new BadRequestException('Set the current academic year before configuring availability.');

    const periods = await this.prisma.timetablePeriod.findMany({
      where: { schoolId: user.schoolId, academicYearId: context.school.currentAcademicYearId },
      select: { dayOfWeek: true, sequence: true, isTeaching: true, isBreak: true, isLunch: true },
    });
    const teachingSlots = new Set(periods.filter((p) => p.isTeaching && !p.isBreak && !p.isLunch).map((p) => `${p.dayOfWeek}|${p.sequence}`));
    const invalid = input.unavailable.filter((slot) => teachingSlots.size > 0 && !teachingSlots.has(`${slot.dayOfWeek}|${slot.periodIndex}`));
    if (invalid.length) {
      throw new BadRequestException(
        `These slots are not teaching periods in the bell schedule: ${invalid.slice(0, 5).map((s) => `day ${s.dayOfWeek} period ${s.periodIndex}`).join(', ')}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.teacherAvailability.deleteMany({ where: { teacherId: input.teacherId } });
      if (input.unavailable.length) {
        await tx.teacherAvailability.createMany({
          data: Array.from(new Map(input.unavailable.map((s) => [`${s.dayOfWeek}|${s.periodIndex}`, s])).values()).map((slot) => ({
            schoolId: user.schoolId, teacherId: input.teacherId, dayOfWeek: slot.dayOfWeek,
            periodIndex: slot.periodIndex, isAvailable: false, reason: slot.reason || null,
          })),
        });
      }
      await this.audit.record({
        schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher.availability.updated',
        entityType: 'TeacherAvailability', entityId: input.teacherId,
        summary: `${input.unavailable.length} unavailable slot(s) recorded for ${teacher.staffNumber}`,
      });
      return { unavailable: input.unavailable.length };
    });
    return result;
  }

  /**
   * Checks that every class + learning-area requirement has an assigned teacher.
   * This is the first validation the timetable workflow runs.
   */
  async coverageCheck(user: AuthPrincipal, academicYearId: string) {
    const classes = await this.prisma.class.findMany({
      where: { schoolId: user.schoolId, academicYearId, isActive: true },
      include: {
        grade: { select: { level: true, name: true } },
        requirements: { include: { learningArea: { select: { id: true, name: true } } } },
        teacherAssignments: { where: { isActive: true }, include: { teacher: { include: { user: { select: { fullName: true } } } } } },
        enrollments: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
      orderBy: [{ grade: { level: 'asc' } }, { name: 'asc' }],
    });

    const missing = classes.flatMap((klass) =>
      klass.requirements
        .filter((req) => !klass.teacherAssignments.some((a) => a.learningAreaId === req.learningAreaId))
        .map((req) => ({
          classId: klass.id,
          className: klass.name,
          gradeName: klass.grade.name,
          learningAreaId: req.learningAreaId,
          learningAreaName: req.learningArea.name,
          periodsPerWeek: req.periodsPerWeek,
          message: `${klass.name} • ${req.learningArea.name} has ${req.periodsPerWeek} period(s)/week but no teacher assigned.`,
        })),
    );

    const classesWithoutRequirements = classes.filter((c) => c.requirements.length === 0).map((c) => ({
      classId: c.id, className: c.name, message: `${c.name} has no weekly period requirements configured.`,
    }));

    const emptyClasses = classes.filter((c) => c.enrollments.length === 0).map((c) => ({
      classId: c.id, className: c.name, message: `${c.name} has no active learners enrolled.`,
    }));

    const teacherLoad = await this.prisma.teacherProfile.findMany({
      where: { schoolId: user.schoolId, isActive: true },
      include: { user: { select: { fullName: true } } },
    });
    const workloads = await Promise.all(
      teacherLoad.map(async (t) => {
        const load = await this.weeklyLoad(t.id);
        return {
          teacherId: t.id, teacherName: t.user.fullName, staffNumber: t.staffNumber,
          weeklyPeriods: load, maxPeriodsPerWeek: t.maxPeriodsPerWeek,
          overLimit: !!t.maxPeriodsPerWeek && load > t.maxPeriodsPerWeek,
        };
      }),
    );

    return {
      academicYearId,
      classesChecked: classes.length,
      totalRequiredPeriods: classes.reduce((sum, c) => sum + c.requirements.reduce((s, r) => s + r.periodsPerWeek, 0), 0),
      missingTeacherAssignments: missing,
      classesWithoutRequirements,
      classesWithoutLearners: emptyClasses,
      teacherWorkloads: workloads.filter((w) => w.weeklyPeriods > 0),
      overloadedTeachers: workloads.filter((w) => w.overLimit),
      isReady: missing.length === 0 && classesWithoutRequirements.length === 0,
    };
  }

  /** Teacher's own assignment summary (used by the teacher dashboard). */
  async myTeachingProfile(user: AuthPrincipal) {
    const teacherId = await this.tenant.teacherProfileId(user);
    const [assignments, teacher] = await Promise.all([
      this.list(user, { teacherId }),
      this.prisma.teacherProfile.findUnique({
        where: { id: teacherId },
        include: { user: { select: { fullName: true, email: true } }, availability: { where: { isAvailable: false } } },
      }),
    ]);
    const weeklyPeriods = await this.weeklyLoad(teacherId);
    return {
      teacherId,
      fullName: teacher?.user.fullName,
      email: teacher?.user.email,
      staffNumber: teacher?.staffNumber,
      weeklyPeriods,
      maxPeriodsPerWeek: teacher?.maxPeriodsPerWeek ?? null,
      maxPeriodsPerDay: teacher?.maxPeriodsPerDay ?? null,
      unavailableSlots: teacher?.availability.length ?? 0,
      assignments,
      maxConsecutive: SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerTeacher,
    };
  }
}
