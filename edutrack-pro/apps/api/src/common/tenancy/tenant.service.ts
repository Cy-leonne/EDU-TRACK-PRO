import { Injectable } from '@nestjs/common';
import { isTeacherRole } from '@edutrack/shared-config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthPrincipal } from '../guards/auth.guard';
import { ResourceAccessDeniedException, TenantIsolationException } from '../errors/domain-errors';

/**
 * Tenant + resource authorization helpers.
 * Every service funnels resource lookups through here so that a caller can
 * never reach another school's record, and a teacher/parent can never read a
 * class, learner or assessment they are not entitled to - even by guessing an
 * id, because Prisma exceptions are turned into 404s.
 */
@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** School-scoped fetch: returns the record or throws a 404 (never a 403 that leaks existence). */
  async scopedOrThrow<T extends { schoolId: string }>(
    fetcher: () => Promise<T | null>,
    resource = 'Record',
    user?: AuthPrincipal,
  ): Promise<T> {
    const record = await fetcher();
    if (!record) throw new TenantIsolationException(resource);
    if (user && record.schoolId !== user.schoolId) throw new TenantIsolationException(resource);
    return record;
  }

  async assertClassAccess(user: AuthPrincipal, classId: string): Promise<{ id: string; schoolId: string; gradeId: string; academicYearId: string; name: string }> {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, schoolId: user.schoolId },
      select: { id: true, schoolId: true, gradeId: true, academicYearId: true, name: true },
    });
    if (!klass) throw new TenantIsolationException('Class');
    if (user.role === 'ADMIN') return klass;

    if (isTeacherRole(user.role)) {
      const profile = await this.teacherProfileId(user);
      const now = new Date();
      const [assignment, classTeacherAssignment, legacyClassTeacher] = await Promise.all([
        this.prisma.teacherAssignment.findFirst({
          where: { schoolId: user.schoolId, teacherId: profile, classId, isActive: true },
          select: { id: true },
        }),
        this.prisma.classTeacherAssignment.findFirst({
          where: {
            schoolId: user.schoolId, teacherId: profile, classId, revokedAt: null,
            effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { id: true },
        }),
        this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId, classTeacherId: profile }, select: { id: true } }),
      ]);
      if (!assignment && !classTeacherAssignment && !legacyClassTeacher) throw new ResourceAccessDeniedException('You are not assigned to this class.');
      return klass;
    }

    // PARENT: must have a verified link to a learner currently enrolled in the class
    const parentId = await this.parentProfileId(user);
    const link = await this.prisma.classEnrollment.findFirst({
      where: {
        classId,
        status: 'ACTIVE',
        learner: { parentLinks: { some: { schoolId: user.schoolId, parentProfileId: parentId, revokedAt: null, isVerified: true } } },
      },
      select: { id: true },
    });
    if (!link) throw new ResourceAccessDeniedException('No linked learner in this class.');
    return klass;
  }

  /** Learner ids the caller may access. Used to scope every learner-facing query. */
  async accessibleLearnerIds(user: AuthPrincipal): Promise<string[] | 'ALL'> {
    if (user.role === 'ADMIN') return 'ALL';
    if (user.role === 'PARENT') {
      const parentId = await this.parentProfileId(user);
      const links = await this.prisma.parentLearnerLink.findMany({
        where: { schoolId: user.schoolId, parentProfileId: parentId, revokedAt: null, isVerified: true },
        select: { learnerId: true },
      });
      return links.map((l) => l.learnerId);
    }
    // Teachers see their subject classes; class teachers also see every learner
    // in their active homeroom assignment.
    if (!isTeacherRole(user.role)) return [];
    const profileId = await this.teacherProfileId(user);
    const now = new Date();
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: {
        schoolId: user.schoolId,
        status: 'ACTIVE',
        class: {
          OR: [
            { teacherAssignments: { some: { teacherId: profileId, isActive: true } } },
            { classTeacherId: profileId },
            { classTeacherAssignments: { some: { teacherId: profileId, revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } } },
          ],
        },
      },
      select: { learnerId: true },
      distinct: ['learnerId'],
    });
    return enrollments.map((e) => e.learnerId);
  }

  /** Guard for a specific learner id. */
  async assertLearnerAccess(user: AuthPrincipal, learnerId: string): Promise<{ id: string; schoolId: string; currentClassId: string | null }> {
    const learner = await this.prisma.learner.findFirst({
      where: { id: learnerId, schoolId: user.schoolId },
      select: { id: true, schoolId: true, currentClassId: true },
    });
    if (!learner) throw new TenantIsolationException('Learner');
    if (user.role === 'ADMIN') return learner;

    if (user.role === 'PARENT') {
      const parentId = await this.parentProfileId(user);
    const link = await this.prisma.parentLearnerLink.findFirst({
  where: {
    schoolId: user.schoolId,
    parentProfileId: parentId,
    learnerId,
    revokedAt: null,
    isVerified: true,
  },
  select: { id: true },
});
      if (!link) throw new ResourceAccessDeniedException('This learner is not linked to your account.');
      return learner;
    }

    const ids = await this.accessibleLearnerIds(user);
    if (ids === 'ALL' || ids.includes(learnerId)) return learner;
    throw new ResourceAccessDeniedException('This learner is not in your classes.');
  }

  /** Subject edits require a subject assignment; homeroom assignment grants class-wide reads only. */
  async assertTeacherClassAssignment(user: AuthPrincipal, classId: string, learningAreaId?: string): Promise<{ teacherProfileId: string | null; assignmentId: string | null }> {
    if (user.role === 'ADMIN') {
      if (!learningAreaId) return { teacherProfileId: null, assignmentId: null };
      const assignment = await this.prisma.teacherAssignment.findFirst({
        where: { schoolId: user.schoolId, classId, learningAreaId, isActive: true },
        select: { id: true, teacherId: true },
      });
      return { teacherProfileId: assignment?.teacherId ?? null, assignmentId: assignment?.id ?? null };
    }
    if (!isTeacherRole(user.role)) throw new ResourceAccessDeniedException('Only teachers and administrators can perform this action.');
    const profileId = await this.teacherProfileId(user);
    const assignment = await this.prisma.teacherAssignment.findFirst({
      where: { schoolId: user.schoolId, classId, teacherId: profileId, isActive: true, ...(learningAreaId ? { learningAreaId } : {}) },
      select: { id: true, teacherId: true },
    });
    if (assignment) return { teacherProfileId: assignment.teacherId, assignmentId: assignment.id };

    // A class-teacher assignment is intentionally not a substitute for teaching
    // a learning area when collecting or amending marks.
    if (learningAreaId) {
      throw new ResourceAccessDeniedException('You are not assigned to teach this learning area in this class.');
    }

    const now = new Date();
    const [classTeacherAssignment, legacyClassTeacher] = await Promise.all([
      this.prisma.classTeacherAssignment.findFirst({
        where: {
          schoolId: user.schoolId, teacherId: profileId, classId, revokedAt: null,
          effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        select: { id: true },
      }),
      this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId, classTeacherId: profileId }, select: { id: true } }),
    ]);
    if (!classTeacherAssignment && !legacyClassTeacher) {
      throw new ResourceAccessDeniedException('You are not assigned to this class.');
    }
    return { teacherProfileId: profileId, assignmentId: null };
  }

  async teacherProfileId(user: AuthPrincipal): Promise<string> {
    if (user.role === 'ADMIN') {
      const admin = await this.prisma.teacherProfile.findFirst({ where: { userId: user.userId }, select: { id: true } });
      if (admin) return admin.id;
      throw new ResourceAccessDeniedException('Administrator account has no teacher profile.');
    }
    const profile = await this.prisma.teacherProfile.findFirst({ where: { userId: user.userId, schoolId: user.schoolId }, select: { id: true } });
    if (!profile) throw new ResourceAccessDeniedException('No teacher profile is linked to your account.');
    return profile.id;
  }

  async parentProfileId(user: AuthPrincipal): Promise<string> {
    const profile = await this.prisma.parentProfile.findFirst({ where: { userId: user.userId, schoolId: user.schoolId }, select: { id: true } });
    if (!profile) throw new ResourceAccessDeniedException('No parent profile is linked to your account.');
    return profile.id;
  }

  /** Full academic context used by assessments, timetables and dashboards. */
  async currentContext(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true, name: true, timezone: true, currentAcademicYearId: true, currentTermId: true,
        workingDays: true, maxPeriodsPerDay: true, defaultPeriodMinutes: true,
        schoolOpenTime: true, schoolCloseTime: true,
      },
    });
    if (!school) throw new TenantIsolationException('School');
    const [year, term] = await Promise.all([
      school.currentAcademicYearId
        ? this.prisma.academicYear.findFirst({ where: { id: school.currentAcademicYearId, schoolId }, select: { id: true, name: true, startDate: true, endDate: true } })
        : null,
      school.currentTermId
        ? this.prisma.term.findFirst({ where: { id: school.currentTermId, schoolId }, select: { id: true, name: true, number: true, endDate: true } })
        : null,
    ]);
    return { school, academicYear: year, term };
  }
}
