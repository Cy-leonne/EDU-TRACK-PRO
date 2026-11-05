import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { isTeacherRole } from '@edutrack/shared-config';
import type { bulkEnrollmentSchema, classSchema, enrollmentSchema } from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantIsolationException, ResourceAccessDeniedException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';

type ClassInput = z.infer<typeof classSchema>;
type EnrollmentInput = z.infer<typeof enrollmentSchema>;
type BulkEnrollmentInput = z.infer<typeof bulkEnrollmentSchema>;

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * Lists classes. Admins see the whole school; teachers see the classes they
   * teach; parents see the classes of their linked learners.
   */
  async list(user: AuthPrincipal, filters: { academicYearId?: string; gradeId?: string; includeInactive?: boolean; search?: string } = {}) {
    const where: Record<string, unknown> = {
      schoolId: user.schoolId,
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      ...(filters.gradeId ? { gradeId: filters.gradeId } : {}),
      ...(filters.includeInactive ? {} : { isActive: true }),
      ...(filters.search ? { name: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const now = new Date();
      where['OR'] = [
        { teacherAssignments: { some: { teacherId, isActive: true } } },
        { classTeacherId: teacherId },
        { classTeacherAssignments: { some: { teacherId, revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } } },
      ];
    } else if (user.role === 'PARENT') {
      const parentId = await this.tenant.parentProfileId(user);
      where['enrollments'] = {
        some: { status: 'ACTIVE', learner: { parentLinks: { some: { parentProfileId: parentId, isVerified: true, revokedAt: null } } } },
      };
    }

    const classes = await this.prisma.class.findMany({
      where: where as never,
      orderBy: [{ grade: { level: 'asc' } }, { name: 'asc' }],
      include: {
        grade: { select: { id: true, level: true, name: true } },
        academicYear: { select: { id: true, name: true } },
        classTeacher: { select: { id: true, user: { select: { fullName: true } } } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } }, teacherAssignments: true } },
      },
    });

    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      stream: c.stream,
      capacity: c.capacity,
      gradeId: c.gradeId,
      gradeName: c.grade.name,
      gradeLevel: c.grade.level,
      academicYearId: c.academicYearId,
      academicYearName: c.academicYear.name,
      classTeacherId: c.classTeacherId,
      classTeacherName: c.classTeacher?.user.fullName ?? null,
      learnerCount: c._count.enrollments,
      assignmentCount: c._count.teacherAssignments,
      isActive: c.isActive,
    }));
  }

  async get(user: AuthPrincipal, id: string) {
    await this.tenant.assertClassAccess(user, id);
    const klass = await this.prisma.class.findUnique({
      where: { id },
      include: {
        grade: true,
        academicYear: true,
        classTeacher: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        teacherAssignments: {
          where: { isActive: true },
          include: {
            teacher: { include: { user: { select: { id: true, fullName: true, email: true } } } },
            learningArea: { select: { id: true, name: true, code: true, colorHex: true } },
          },
        },
        requirements: { include: { learningArea: { select: { id: true, name: true, colorHex: true } } } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!klass) throw new TenantIsolationException('Class');
    return {
      id: klass.id, name: klass.name, stream: klass.stream, capacity: klass.capacity,
      isActive: klass.isActive, notes: klass.notes,
      grade: { id: klass.grade.id, level: klass.grade.level, name: klass.grade.name },
      academicYear: { id: klass.academicYear.id, name: klass.academicYear.name },
      classTeacher: klass.classTeacher ? { id: klass.classTeacher.id, fullName: klass.classTeacher.user.fullName, email: klass.classTeacher.user.email } : null,
      learnerCount: klass._count.enrollments,
      assignments: klass.teacherAssignments.map((a) => ({
        id: a.id, teacherId: a.teacherId, teacherName: a.teacher.user.fullName,
        learningAreaId: a.learningAreaId, learningAreaName: a.learningArea.name, learningAreaColor: a.learningArea.colorHex,
        isPrimary: a.isPrimary, lessonsPerWeek: a.lessonsPerWeek,
      })),
      requirements: klass.requirements.map((r) => ({
        id: r.id, learningAreaId: r.learningAreaId, learningAreaName: r.learningArea.name,
        learningAreaColor: r.learningArea.colorHex, periodsPerWeek: r.periodsPerWeek,
        preferDoubleLesson: r.preferDoubleLesson, preferMorning: r.preferMorning,
      })),
    };
  }

  async create(user: AuthPrincipal, input: ClassInput) {
    const [grade, year] = await Promise.all([
      this.prisma.grade.findFirst({ where: { id: input.gradeId, schoolId: user.schoolId } }),
      this.prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: user.schoolId } }),
    ]);
    if (!grade) throw new TenantIsolationException('Grade');
    if (!year) throw new TenantIsolationException('Academic year');

    if (input.classTeacherId) {
      const teacher = await this.prisma.teacherProfile.findFirst({ where: { id: input.classTeacherId, schoolId: user.schoolId, isActive: true } });
      if (!teacher) throw new BadRequestException('The selected class teacher is not an active teacher in this school.');
    }

    const klass = await this.prisma.class.create({
      data: {
        schoolId: user.schoolId,
        academicYearId: input.academicYearId,
        gradeId: input.gradeId,
        name: input.name,
        stream: input.stream || null,
        classTeacherId: input.classTeacherId || null,
        roomId: input.roomId || null,
        capacity: input.capacity ?? null,
        isActive: input.isActive,
        notes: input.notes || null,
      },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'class.created', entityType: 'Class', entityId: klass.id, after: klass });
    return klass;
  }

  async update(user: AuthPrincipal, id: string, input: Partial<ClassInput>) {
    const existing = await this.prisma.class.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Class');
    if (input.classTeacherId) {
      const teacher = await this.prisma.teacherProfile.findFirst({ where: { id: input.classTeacherId, schoolId: user.schoolId, isActive: true } });
      if (!teacher) throw new BadRequestException('The selected class teacher is not an active teacher in this school.');
    }
    if (input.capacity) {
      const enrolled = await this.prisma.classEnrollment.count({ where: { classId: id, status: 'ACTIVE' } });
      if (enrolled > input.capacity) {
        throw new BadRequestException(`Capacity (${input.capacity}) is lower than the ${enrolled} learners already enrolled. Move learners first.`);
      }
    }
    const updated = await this.prisma.class.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.stream !== undefined ? { stream: input.stream || null } : {}),
        ...(input.gradeId ? { gradeId: input.gradeId } : {}),
        ...(input.academicYearId ? { academicYearId: input.academicYearId } : {}),
        ...(input.classTeacherId !== undefined ? { classTeacherId: input.classTeacherId || null } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId || null } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'class.updated', entityType: 'Class', entityId: id, before: existing, after: updated });
    return updated;
  }

  async archive(user: AuthPrincipal, id: string) {
    const existing = await this.prisma.class.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Class');
    const active = await this.prisma.classEnrollment.count({ where: { classId: id, status: 'ACTIVE' } });
    if (active > 0) throw new BadRequestException(`This class still has ${active} active learner(s). Transfer or withdraw them first.`);
    return this.prisma.class.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } });
  }

  /* ----------------------------- enrolment ------------------------------ */

  async listEnrollments(user: AuthPrincipal, classId: string) {
    await this.tenant.assertClassAccess(user, classId);
    const rows = await this.prisma.classEnrollment.findMany({
      where: { classId, status: 'ACTIVE' },
      orderBy: [{ learner: { lastName: 'asc' } }, { learner: { firstName: 'asc' } }],
      include: { learner: true },
    });
    return rows.map((row) => ({
      id: row.id,
      learnerId: row.learnerId,
      learnerName: `${row.learner.firstName} ${row.learner.lastName}`,
      admissionNumber: row.learner.admissionNumber,
      assessmentNumber: row.learner.assessmentNumber,
      gender: row.learner.gender,
      status: row.learner.status,
      enrolledAt: row.enrolledAt,
    }));
  }

  /**
   * Enrols a learner. Runs inside a transaction and updates the learner's
   * current class pointer atomically. Duplicate active enrolments are rejected.
   */
  async enroll(user: AuthPrincipal, input: EnrollmentInput) {
    const [klass, learner] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: input.classId, schoolId: user.schoolId } }),
      this.prisma.learner.findFirst({ where: { id: input.learnerId, schoolId: user.schoolId } }),
    ]);
    if (!klass) throw new TenantIsolationException('Class');
    if (!learner) throw new TenantIsolationException('Learner');
    if (klass.capacity) {
      const count = await this.prisma.classEnrollment.count({ where: { classId: klass.id, status: 'ACTIVE' } });
      if (count >= klass.capacity) throw new BadRequestException(`This class is full (capacity ${klass.capacity}).`);
    }
    const duplicate = await this.prisma.classEnrollment.findFirst({
      where: { learnerId: input.learnerId, classId: input.classId, academicYearId: klass.academicYearId, status: 'ACTIVE' },
    });
    if (duplicate) throw new BadRequestException(`${`${learner.firstName} ${learner.lastName}`} is already enrolled in ${klass.name}.`);

    return this.prisma.$transaction(async (tx) => {
      // Any previous active enrolment in another class of the same year is closed.
      await tx.classEnrollment.updateMany({
        where: { learnerId: input.learnerId, academicYearId: klass.academicYearId, status: 'ACTIVE', NOT: { classId: klass.id } },
        data: { status: 'TRANSFERRED', exitedAt: new Date() },
      });
      const enrollment = await tx.classEnrollment.create({
        data: {
          schoolId: user.schoolId,
          learnerId: input.learnerId,
          classId: klass.id,
          academicYearId: klass.academicYearId,
          termId: input.termId || null,
          status: input.status,
          createdById: user.userId,
          notes: input.notes || null,
        },
      });
      await tx.learner.update({
        where: { id: input.learnerId },
        data: { currentClassId: klass.id, gradeId: klass.gradeId, status: 'ACTIVE', enrolledOn: learner.enrolledOn ?? new Date() },
      });
      await this.audit.record({
        schoolId: user.schoolId, actorUserId: user.userId, action: 'enrollment.created', entityType: 'ClassEnrollment',
        entityId: enrollment.id, after: { classId: klass.id, learnerId: input.learnerId, className: klass.name },
      });
      return enrollment;
    });
  }

  async bulkEnroll(user: AuthPrincipal, input: BulkEnrollmentInput) {
    const klass = await this.prisma.class.findFirst({ where: { id: input.classId, schoolId: user.schoolId } });
    if (!klass) throw new TenantIsolationException('Class');
    const learners = await this.prisma.learner.findMany({ where: { id: { in: input.learnerIds }, schoolId: user.schoolId }, select: { id: true } });
    if (learners.length !== input.learnerIds.length) throw new TenantIsolationException('Learner');

    const results = { enrolled: 0, skipped: 0, errors: [] as { learnerId: string; message: string }[] };
    for (const learner of learners) {
      try {
        await this.enroll(user, { learnerId: learner.id, classId: input.classId, status: 'ACTIVE' } as EnrollmentInput);
        results.enrolled += 1;
      } catch (error) {
        results.skipped += 1;
        results.errors.push({ learnerId: learner.id, message: (error as Error).message });
      }
    }
    return results;
  }

  async withdrawEnrollment(user: AuthPrincipal, enrollmentId: string, status: 'TRANSFERRED' | 'WITHDRAWN' | 'COMPLETED' = 'TRANSFERRED', reason?: string) {
    const enrollment = await this.prisma.classEnrollment.findFirst({ where: { id: enrollmentId, schoolId: user.schoolId } });
    if (!enrollment) throw new TenantIsolationException('Enrolment');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.classEnrollment.update({
        where: { id: enrollmentId },
        data: { status, exitedAt: new Date(), notes: reason ?? enrollment.notes },
      });
      const remaining = await tx.classEnrollment.count({ where: { learnerId: enrollment.learnerId, academicYearId: enrollment.academicYearId, status: 'ACTIVE' } });
      if (remaining === 0) {
        await tx.learner.update({ where: { id: enrollment.learnerId }, data: { currentClassId: null } });
      }
      await this.audit.record({
        schoolId: user.schoolId, actorUserId: user.userId, action: 'enrollment.updated', entityType: 'ClassEnrollment',
        entityId: enrollmentId, before: { status: enrollment.status }, after: { status, reason },
      });
      return updated;
    });
  }

  /**
   * Cross-checks class membership for timetable publication: any learner that
   * appears in two active enrolments in the same academic year, or in a class
   * from a different academic year, is an invalid enrolment.
   */
  async validateEnrollments(user: AuthPrincipal, academicYearId: string) {
    const rows = await this.prisma.classEnrollment.groupBy({
      by: ['learnerId'],
      where: { schoolId: user.schoolId, status: 'ACTIVE', academicYearId },
      _count: { learnerId: true },
    });
    const duplicates = rows.filter((r) => r._count.learnerId > 1);
    const crossYear = await this.prisma.classEnrollment.findMany({
      where: { schoolId: user.schoolId, status: 'ACTIVE', class: { academicYearId: { not: academicYearId } } },
      select: { id: true, learnerId: true, class: { select: { name: true, academicYearId: true } } },
      take: 50,
    });
    return {
      duplicateEnrollments: duplicates.map((d) => ({ learnerId: d.learnerId, count: d._count.learnerId })),
      enrollmentsInOtherAcademicYears: crossYear,
      isValid: duplicates.length === 0 && crossYear.length === 0,
    };
  }

  /** Teachers/parents cannot edit classes - enforced by permissions, and this
   *  guard makes the rule explicit for the class-teacher-only operations. */
  assertCanManage(user: AuthPrincipal): void {
    if (user.role !== 'ADMIN') throw new ResourceAccessDeniedException('Only school administrators can manage classes.');
  }
}
