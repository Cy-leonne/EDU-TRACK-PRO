import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportCardStatus } from '@prisma/client';
import type { z } from 'zod';
import type {
  classReportNarrativeSchema,
  classTeacherAssignmentSchema,
  classTeacherInterventionSchema,
  classTeacherInterventionUpdateSchema,
} from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ResourceAccessDeniedException, TenantIsolationException } from '../../common/errors/domain-errors';
import type { AuthPrincipal } from '../../common/guards/auth.guard';

type AssignmentInput = z.infer<typeof classTeacherAssignmentSchema>;
type InterventionInput = z.infer<typeof classTeacherInterventionSchema>;
type InterventionUpdateInput = z.infer<typeof classTeacherInterventionUpdateSchema>;
type NarrativeInput = z.infer<typeof classReportNarrativeSchema>;

const ACTIVE_INTERVENTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD'];

@Injectable()
export class ClassTeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Assign/reassign a class teacher without erasing the prior assignment history. */
  async assign(user: AuthPrincipal, input: AssignmentInput) {
    const [klass, teacher] = await Promise.all([
      this.prisma.class.findFirst({
        where: { id: input.classId, schoolId: user.schoolId, isActive: true, archivedAt: null },
        select: { id: true, name: true, academicYearId: true, classTeacherId: true },
      }),
      this.prisma.teacherProfile.findFirst({
        where: {
          id: input.teacherId,
          schoolId: user.schoolId,
          isActive: true,
          archivedAt: null,
          user: {
            isActive: true,
            archivedAt: null,
            memberships: { some: { schoolId: user.schoolId, status: 'ACTIVE', role: { in: ['TEACHER', 'CLASS_TEACHER'] } } },
          },
        },
        include: { user: { select: { fullName: true, email: true } } },
      }),
    ]);
    if (!klass) throw new TenantIsolationException('Class');
    if (!teacher) throw new BadRequestException('Choose an active teacher from this school.');

    const now = new Date();
    const effectiveFrom = input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00.000Z`) : now;
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.getTime() > now.getTime()) {
      throw new BadRequestException('Class-teacher assignments must take effect now or in the past.');
    }
    const previous = await this.prisma.classTeacherAssignment.findFirst({
      where: {
        schoolId: user.schoolId,
        classId: klass.id,
        academicYearId: klass.academicYearId,
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, teacherId: true, effectiveFrom: true, changeReason: true },
    });
    if (previous?.teacherId === teacher.id) return { ...previous, classId: klass.id, teacherName: teacher.user.fullName, unchanged: true };

    const result = await this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.classTeacherAssignment.update({
          where: { id: previous.id },
          data: {
            effectiveTo: effectiveFrom,
            revokedAt: now,
            revokedById: user.userId,
            changeReason: input.changeReason ?? 'Reassigned by a school administrator',
          },
        });
      }
      const assignment = await tx.classTeacherAssignment.create({
        data: {
          schoolId: user.schoolId,
          classId: klass.id,
          teacherId: teacher.id,
          academicYearId: klass.academicYearId,
          effectiveFrom,
          assignedById: user.userId,
          changeReason: input.changeReason ?? null,
        },
      });
      await tx.class.update({ where: { id: klass.id }, data: { classTeacherId: teacher.id } });
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'class_teacher.assignment.created',
      entityType: 'ClassTeacherAssignment',
      entityId: result.id,
      summary: `${teacher.user.fullName} assigned to ${klass.name}`,
      before: previous,
      after: { ...result, teacherName: teacher.user.fullName, className: klass.name },
    });
    return { ...result, teacherName: teacher.user.fullName, className: klass.name };
  }

  async listAssignments(user: AuthPrincipal, filters: { classId?: string; academicYearId?: string } = {}) {
    const where: Prisma.ClassTeacherAssignmentWhereInput = {
      schoolId: user.schoolId,
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
    };
    if (filters.classId) await this.requireSchoolClass(user, filters.classId);
    const rows = await this.prisma.classTeacherAssignment.findMany({
      where,
      orderBy: [{ academicYear: { startDate: 'desc' } }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        class: { select: { id: true, name: true, stream: true, academicYearId: true, grade: { select: { name: true, level: true } } } },
        teacher: { select: { id: true, staffNumber: true, user: { select: { id: true, fullName: true, email: true } } } },
        academicYear: { select: { id: true, name: true } },
        assignedBy: { select: { fullName: true } },
        revokedBy: { select: { fullName: true } },
      },
    });
    return rows;
  }

  async revokeAssignment(user: AuthPrincipal, assignmentId: string, reason?: string) {
    const assignment = await this.prisma.classTeacherAssignment.findFirst({
      where: { id: assignmentId, schoolId: user.schoolId },
      include: { class: { select: { id: true, name: true, classTeacherId: true } } },
    });
    if (!assignment) throw new TenantIsolationException('Class teacher assignment');
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.classTeacherAssignment.update({
        where: { id: assignment.id },
        data: {
          effectiveTo: assignment.effectiveTo ?? now,
          revokedAt: assignment.revokedAt ?? now,
          revokedById: user.userId,
          changeReason: reason?.trim() || assignment.changeReason || 'Assignment revoked by a school administrator',
        },
      });
      if (assignment.class.classTeacherId === assignment.teacherId) {
        await tx.class.update({ where: { id: assignment.classId }, data: { classTeacherId: null } });
      }
      return updated;
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'class_teacher.assignment.revoked', entityType: 'ClassTeacherAssignment', entityId: assignment.id,
      summary: `${assignment.class.name} class-teacher assignment revoked`, before: assignment, after: result,
    });
    return result;
  }

  /** School-scoped class-teacher dashboard. No synthetic marks or averages are calculated. */
  async dashboard(user: AuthPrincipal) {
    const school = await this.prisma.school.findFirst({
      where: { id: user.schoolId, isActive: true, status: 'ACTIVE', archivedAt: null },
      select: {
        id: true, publicId: true, name: true, motto: true, logoFileId: true, primaryColor: true, accentColor: true,
        currentAcademicYearId: true, currentTermId: true,
      },
    });
    if (!school) throw new TenantIsolationException('School');

    const now = new Date();
    const classWhere: Prisma.ClassWhereInput = {
      schoolId: user.schoolId,
      isActive: true,
      archivedAt: null,
      ...(school.currentAcademicYearId ? { academicYearId: school.currentAcademicYearId } : {}),
    };
    if (user.role !== 'ADMIN') {
      if (user.role !== 'CLASS_TEACHER') throw new ResourceAccessDeniedException('Class-teacher access is required.');
      classWhere.OR = [
        { classTeacherAssignments: { some: { teacher: { userId: user.userId }, revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } } },
        { classTeacher: { userId: user.userId } },
      ];
    }
    const classes = await this.prisma.class.findMany({
      where: classWhere,
      orderBy: [{ grade: { level: 'asc' } }, { name: 'asc' }],
      include: {
        grade: { select: { id: true, name: true, level: true } },
        academicYear: { select: { id: true, name: true } },
        _count: { select: { enrollments: { where: { schoolId: user.schoolId, status: 'ACTIVE' } } } },
      },
    });
    const classIds = classes.map((row) => row.id);
    const [interventionCounts, assessmentCounts, academicYear, term] = await Promise.all([
      classIds.length ? this.prisma.learnerIntervention.groupBy({
        by: ['classId'], where: { schoolId: user.schoolId, classId: { in: classIds }, status: { in: ACTIVE_INTERVENTION_STATUSES } },
        _count: { _all: true },
      }) : Promise.resolve([]),
      classIds.length && school.currentTermId ? this.prisma.assessment.groupBy({
        by: ['classId'], where: { schoolId: user.schoolId, classId: { in: classIds }, termId: school.currentTermId, status: 'PUBLISHED', archivedAt: null },
        _count: { _all: true },
      }) : Promise.resolve([]),
      school.currentAcademicYearId ? this.prisma.academicYear.findFirst({ where: { id: school.currentAcademicYearId, schoolId: user.schoolId }, select: { id: true, name: true } }) : Promise.resolve(null),
      school.currentTermId ? this.prisma.term.findFirst({ where: { id: school.currentTermId, schoolId: user.schoolId }, select: { id: true, name: true, number: true, endDate: true } }) : Promise.resolve(null),
    ]);
    const interventionsByClass = new Map(interventionCounts.map((row) => [row.classId, row._count._all]));
    const assessmentsByClass = new Map(assessmentCounts.map((row) => [row.classId, row._count._all]));

    return {
      school: { ...school, academicYear, term },
      classes: classes.map((row) => ({
        id: row.id, name: row.name, stream: row.stream, grade: row.grade, academicYear: row.academicYear,
        learnerCount: row._count.enrollments,
        openInterventionCount: interventionsByClass.get(row.id) ?? 0,
        publishedAssessmentCount: assessmentsByClass.get(row.id) ?? 0,
      })),
      summary: {
        classCount: classes.length,
        learnerCount: classes.reduce((sum, row) => sum + row._count.enrollments, 0),
        openInterventionCount: [...interventionsByClass.values()].reduce((sum, value) => sum + value, 0),
      },
    };
  }

  async progress(user: AuthPrincipal, classId: string, termId?: string) {
    const { klass, term } = await this.requireClassTerm(user, classId, termId);
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: { schoolId: user.schoolId, classId, academicYearId: klass.academicYearId, status: { not: 'WITHDRAWN' }, learner: { archivedAt: null } },
      orderBy: [{ learner: { lastName: 'asc' } }, { learner: { firstName: 'asc' } }],
      select: { learner: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true } } },
    });
    const learnerIds = enrollments.map((row) => row.learner.id);
    if (!learnerIds.length) return { classId, term, learners: [] };

    const [results, interventions] = await Promise.all([
      this.prisma.assessmentResult.findMany({
        where: {
          schoolId: user.schoolId, learnerId: { in: learnerIds }, status: 'PUBLISHED',
          assessment: { schoolId: user.schoolId, classId, termId: term.id, status: 'PUBLISHED', archivedAt: null },
        },
        select: { learnerId: true, publishedAt: true, updatedAt: true },
      }),
      this.prisma.learnerIntervention.groupBy({
        by: ['learnerId'], where: { schoolId: user.schoolId, classId, learnerId: { in: learnerIds }, status: { in: ACTIVE_INTERVENTION_STATUSES } },
        _count: { _all: true },
      }),
    ]);
    const resultStats = new Map<string, { publishedResultCount: number; lastPublishedAt: Date | null }>();
    for (const result of results) {
      const current = resultStats.get(result.learnerId) ?? { publishedResultCount: 0, lastPublishedAt: null };
      current.publishedResultCount += 1;
      const resultDate = result.publishedAt ?? result.updatedAt;
      if (!current.lastPublishedAt || resultDate > current.lastPublishedAt) current.lastPublishedAt = resultDate;
      resultStats.set(result.learnerId, current);
    }
    const interventionsByLearner = new Map(interventions.map((row) => [row.learnerId, row._count._all]));
    return {
      class: { id: klass.id, name: klass.name },
      term,
      learners: enrollments.map(({ learner }) => ({
        ...learner,
        fullName: [learner.firstName, learner.middleName, learner.lastName].filter(Boolean).join(' '),
        ...(resultStats.get(learner.id) ?? { publishedResultCount: 0, lastPublishedAt: null }),
        openInterventionCount: interventionsByLearner.get(learner.id) ?? 0,
      })),
    };
  }

  async reportCards(user: AuthPrincipal, classId: string, termId: string) {
    const { klass, term, school } = await this.requireClassTerm(user, classId, termId);
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: { schoolId: user.schoolId, classId, academicYearId: klass.academicYearId, status: { not: 'WITHDRAWN' }, learner: { archivedAt: null } },
      orderBy: [{ learner: { lastName: 'asc' } }, { learner: { firstName: 'asc' } }],
      select: { learner: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true, upiNumber: true } } },
    });
    const learnerIds = enrollments.map((row) => row.learner.id);
    if (!learnerIds.length) {
      return { school, class: this.classDto(klass), term, reportCards: [] };
    }
    const [results, narratives] = await Promise.all([
      this.prisma.assessmentResult.findMany({
        where: {
          schoolId: user.schoolId, learnerId: { in: learnerIds }, status: 'PUBLISHED',
          assessment: { schoolId: user.schoolId, classId, termId: term.id, status: 'PUBLISHED', archivedAt: null },
        },
        orderBy: [{ assessment: { assessmentDate: 'asc' } }, { createdAt: 'asc' }],
        include: {
          assessment: {
            select: {
              id: true, title: true, assessmentDate: true, totalMarks: true,
              learningArea: { select: { id: true, name: true, code: true, colorHex: true } },
              category: { select: { name: true } },
            },
          },
          achievementLevel: { select: { label: true, description: true } },
        },
      }),
      this.prisma.classReportNarrative.findMany({
        where: { schoolId: user.schoolId, classId, termId: term.id, learnerId: { in: learnerIds } },
        orderBy: [{ learnerId: 'asc' }, { version: 'desc' }],
      }),
    ]);
    const resultsByLearner = new Map<string, typeof results>();
    for (const result of results) resultsByLearner.set(result.learnerId, [...(resultsByLearner.get(result.learnerId) ?? []), result]);
    const narrativeByLearner = new Map<string, (typeof narratives)[number]>();
    for (const narrative of narratives) if (!narrativeByLearner.has(narrative.learnerId)) narrativeByLearner.set(narrative.learnerId, narrative);

    return {
      school,
      class: this.classDto(klass),
      term,
      reportCards: enrollments.map(({ learner }) => ({
        learner: { ...learner, fullName: [learner.firstName, learner.middleName, learner.lastName].filter(Boolean).join(' ') },
        results: (resultsByLearner.get(learner.id) ?? []).map((result) => ({
          assessmentId: result.assessment.id,
          title: result.assessment.title,
          assessmentDate: result.assessment.assessmentDate,
          learningArea: result.assessment.learningArea,
          category: result.assessment.category.name,
          score: result.numericScore == null ? null : Number(result.numericScore),
          maximumMarks: result.assessment.totalMarks == null ? null : Number(result.assessment.totalMarks),
          isAbsent: result.isAbsent,
          isExcused: result.isExcused,
          achievementLevel: result.achievementLevel?.label ?? null,
          achievementDescription: result.achievementLevel?.description ?? null,
          comment: result.comment,
        })),
        narrative: narrativeByLearner.get(learner.id) ?? null,
      })),
    };
  }

  async saveNarrative(user: AuthPrincipal, classId: string, learnerId: string, termId: string, input: NarrativeInput) {
    const { klass, term } = await this.requireClassTerm(user, classId, termId);
    await this.requireLearnerInClass(user.schoolId, learnerId, klass);
    const before = await this.prisma.classReportNarrative.findFirst({
      where: { schoolId: user.schoolId, learnerId, termId: term.id }, orderBy: { version: 'desc' },
    });
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.classReportNarrative.findFirst({
        where: { schoolId: user.schoolId, learnerId, termId: term.id }, orderBy: { version: 'desc' },
      });
      const patch: Prisma.ClassReportNarrativeUpdateInput = { updatedBy: { connect: { id: user.userId } } };
      if (input.teacherComment !== undefined) patch.teacherComment = input.teacherComment;
      if (input.strengths !== undefined) patch.strengths = input.strengths;
      if (input.supportPlan !== undefined) patch.supportPlan = input.supportPlan;
      if (latest?.status === 'DRAFT') {
        return tx.classReportNarrative.update({ where: { id: latest.id }, data: patch });
      }
      if (latest?.status === 'PUBLISHED') {
        await tx.classReportNarrative.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
      }
      return tx.classReportNarrative.create({
        data: {
          schoolId: user.schoolId,
          learnerId,
          classId: klass.id,
          academicYearId: klass.academicYearId,
          termId: term.id,
          teacherComment: input.teacherComment ?? null,
          strengths: input.strengths ?? null,
          supportPlan: input.supportPlan ?? null,
          status: 'DRAFT',
          version: (latest?.version ?? 0) + 1,
          updatedById: user.userId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'class_report.narrative.saved', entityType: 'ClassReportNarrative', entityId: row.id,
      summary: `Report narrative saved for learner ${learnerId}`, before, after: row,
    });
    return row;
  }

  async publishNarrative(user: AuthPrincipal, classId: string, learnerId: string, termId: string) {
    const { klass, term } = await this.requireClassTerm(user, classId, termId);
    await this.requireLearnerInClass(user.schoolId, learnerId, klass);
    const latest = await this.prisma.classReportNarrative.findFirst({
      where: { schoolId: user.schoolId, learnerId, classId, termId: term.id }, orderBy: { version: 'desc' },
    });
    if (!latest) throw new NotFoundException('Save the report narrative before publishing it.');
    if (latest.status !== 'DRAFT') throw new ConflictException('Only a draft report narrative can be published.');
    const published = await this.prisma.classReportNarrative.update({
      where: { id: latest.id },
      data: { status: 'PUBLISHED', publishedById: user.userId, publishedAt: new Date(), updatedById: user.userId },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'class_report.narrative.published', entityType: 'ClassReportNarrative', entityId: published.id,
      summary: `Report narrative published for learner ${learnerId}`, before: latest, after: published,
    });
    return published;
  }

  async interventions(user: AuthPrincipal, classId: string, status?: string) {
    await this.assertManagedClass(user, classId);
    const rows = await this.prisma.learnerIntervention.findMany({
      where: { schoolId: user.schoolId, classId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { updatedAt: 'desc' }],
      include: {
        learner: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true } },
        teacher: { select: { user: { select: { fullName: true } } } },
        createdBy: { select: { fullName: true } },
        updatedBy: { select: { fullName: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      learner: { ...row.learner, fullName: [row.learner.firstName, row.learner.middleName, row.learner.lastName].filter(Boolean).join(' ') },
      teacherName: row.teacher?.user.fullName ?? null,
      createdByName: row.createdBy?.fullName ?? null,
      updatedByName: row.updatedBy?.fullName ?? null,
    }));
  }

  async createIntervention(user: AuthPrincipal, classId: string, input: InterventionInput) {
    if (input.classId !== classId) throw new BadRequestException('The class in the request does not match the selected class.');
    const klass = await this.assertManagedClass(user, classId);
    const learner = await this.requireLearnerInClass(user.schoolId, input.learnerId, klass, true);
    const teacher = user.role === 'CLASS_TEACHER'
      ? await this.prisma.teacherProfile.findFirst({ where: { userId: user.userId, schoolId: user.schoolId }, select: { id: true } })
      : null;
    const row = await this.prisma.learnerIntervention.create({
      data: {
        schoolId: user.schoolId,
        learnerId: learner.id,
        classId: klass.id,
        teacherId: teacher?.id ?? null,
        createdById: user.userId,
        updatedById: user.userId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
      },
      include: { learner: { select: { firstName: true, lastName: true, admissionNumber: true } } },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'learner_intervention.created', entityType: 'LearnerIntervention', entityId: row.id,
      summary: `Learner support plan created for ${row.learner.firstName} ${row.learner.lastName}`, after: row,
    });
    return row;
  }

  async updateIntervention(user: AuthPrincipal, interventionId: string, input: InterventionUpdateInput) {
    const before = await this.prisma.learnerIntervention.findFirst({ where: { id: interventionId, schoolId: user.schoolId } });
    if (!before || !before.classId) throw new TenantIsolationException('Learner intervention');
    await this.assertManagedClass(user, before.classId);
    const data: Prisma.LearnerInterventionUpdateInput = { updatedBy: { connect: { id: user.userId } } };
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null;
    const after = await this.prisma.learnerIntervention.update({ where: { id: before.id }, data });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'learner_intervention.updated', entityType: 'LearnerIntervention', entityId: after.id,
      summary: `Learner support plan updated for learner ${after.learnerId}`, before, after,
    });
    return after;
  }

  private async requireClassTerm(user: AuthPrincipal, classId: string, requestedTermId?: string) {
    const klass = await this.assertManagedClass(user, classId);
    const school = await this.prisma.school.findFirst({
      where: { id: user.schoolId, isActive: true, status: 'ACTIVE', archivedAt: null },
      select: { id: true, name: true, publicId: true, motto: true, logoFileId: true, primaryColor: true, accentColor: true, portalName: true, addressLine: true, county: true, website: true, currentTermId: true },
    });
    if (!school) throw new TenantIsolationException('School');
    const termId = requestedTermId ?? school.currentTermId;
    if (!termId) throw new BadRequestException('Select a term before viewing results or report cards.');
    const term = await this.prisma.term.findFirst({
      where: { id: termId, schoolId: user.schoolId, academicYearId: klass.academicYearId },
      select: { id: true, name: true, number: true, startDate: true, endDate: true, academicYearId: true },
    });
    if (!term) throw new TenantIsolationException('Term');
    return { klass, term, school };
  }

  private async requireSchoolClass(user: AuthPrincipal, classId: string) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, schoolId: user.schoolId, archivedAt: null },
      include: {
        grade: { select: { name: true, level: true } },
        academicYear: { select: { name: true } },
      },
    });
    if (!klass) throw new TenantIsolationException('Class');
    return klass;
  }

  private async assertManagedClass(user: AuthPrincipal, classId: string) {
    const klass = await this.requireSchoolClass(user, classId);
    if (user.role === 'ADMIN') return klass;
    if (user.role !== 'CLASS_TEACHER') throw new ResourceAccessDeniedException('Only an assigned class teacher or school administrator can access this class-teacher workflow.');
    const teacher = await this.prisma.teacherProfile.findFirst({
      where: { userId: user.userId, schoolId: user.schoolId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    if (!teacher) throw new ResourceAccessDeniedException('No active teacher profile is linked to your account.');
    const now = new Date();
    const [assignment, legacyClassTeacher] = await Promise.all([
      this.prisma.classTeacherAssignment.findFirst({
        where: {
          schoolId: user.schoolId, classId: klass.id, academicYearId: klass.academicYearId, teacherId: teacher.id,
          revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        select: { id: true },
      }),
      this.prisma.class.findFirst({ where: { id: klass.id, schoolId: user.schoolId, classTeacherId: teacher.id }, select: { id: true } }),
    ]);
    if (!assignment && !legacyClassTeacher) throw new ResourceAccessDeniedException('You are not the assigned class teacher for this class.');
    return klass;
  }

  private async requireLearnerInClass(schoolId: string, learnerId: string, klass: { id: string; academicYearId: string }, activeOnly = false) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        schoolId, classId: klass.id, academicYearId: klass.academicYearId, learnerId,
        ...(activeOnly ? { status: 'ACTIVE' } : { status: { not: 'WITHDRAWN' } }),
        learner: { schoolId, archivedAt: null },
      },
      select: { learner: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!enrollment) throw new NotFoundException('The learner is not enrolled in this class and academic year.');
    return enrollment.learner;
  }

  private classDto(klass: { id: string; name: string; stream: string | null; grade?: { name: string; level: number } | null; academicYear?: { name: string } | null }) {
    return { id: klass.id, name: klass.name, stream: klass.stream, grade: klass.grade ?? null, academicYear: klass.academicYear ?? null };
  }
}
