import { BadRequestException, Injectable } from '@nestjs/common';
import { AssessmentStatus, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { isTeacherRole } from '@edutrack/shared-config';
import type { assessmentSchema, assessmentStatusSchema, rubricSchema } from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessRuleException, ResourceAccessDeniedException, TenantIsolationException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { NotificationType } from '@prisma/client';

type AssessmentInput = z.infer<typeof assessmentSchema>;
type StatusInput = z.infer<typeof assessmentStatusSchema>;
type RubricInput = z.infer<typeof rubricSchema>;

/** Legal transitions in the assessment lifecycle. */
const ALLOWED_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'PUBLISHED', 'ARCHIVED'],
  READY_FOR_REVIEW: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['CORRECTED', 'ARCHIVED'],
  CORRECTED: ['CORRECTED', 'ARCHIVED'],
  ARCHIVED: [],
};


  /** Shape shared by the list and detail queries - kept explicit so both call sites stay typed. */
interface AssessmentRow {
  id: string; title: string; description: string | null; instructions: string | null;
  academicYearId: string; termId: string; classId: string; learningAreaId: string; categoryId: string;
  strandId: string | null; subStrandId: string | null; rubricId: string | null;
  createdById: string; assessmentDate: Date; dueDate: Date | null;
  totalMarks: unknown; usesMarks: boolean; usesRubric: boolean; isExternallyReported: boolean;
  status: AssessmentStatus; publishedAt: Date | null; correctedAt: Date | null; correctionReason: string | null;
  class: { id: string; name: string; grade: { level: number } };
  learningArea: { id: string; name: string; colorHex: string };
  category: { id: string; name: string; code: string };
  term: { id: string; name: string };
  strand: { id: string; name: string } | null;
  subStrand: { id: string; name: string } | null;
  createdBy: { id: string; fullName: string };
  resources: {
    id: string; fileId: string | null; title: string | null; kind: string; externalUrl: string | null;
    createdAt: Date; file: { id: string; originalName: string; mimeType: string; sizeBytes: number } | null;
}[];
  _count: { results: number };
}


@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------- catalogue ---------------------------- */

  async listCategories(user: AuthPrincipal) {
    return this.prisma.assessmentCategory.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  async upsertCategory(user: AuthPrincipal, input: { code: string; name: string; allowsMarks?: boolean; allowsRubric?: boolean; defaultMaxMarks?: number | null; description?: string }) {
    const category = await this.prisma.assessmentCategory.upsert({
      where: { schoolId_code: { schoolId: user.schoolId, code: input.code } },
      create: {
        schoolId: user.schoolId, code: input.code, name: input.name,
        allowsMarks: input.allowsMarks ?? true, allowsRubric: input.allowsRubric ?? true,
        defaultMaxMarks: input.defaultMaxMarks ?? null, description: input.description ?? null,
      },
      update: { name: input.name, allowsMarks: input.allowsMarks, allowsRubric: input.allowsRubric, defaultMaxMarks: input.defaultMaxMarks },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'assessment-category.upserted', entityType: 'AssessmentCategory', entityId: category.id, after: input });
    return category;
  }

  async listAchievementLevels(user: AuthPrincipal) {
    return this.prisma.achievementLevel.findMany({
      where: { schoolId: user.schoolId, isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  async upsertAchievementLevel(user: AuthPrincipal, input: { code: string; label: string; minPercent: number; maxPercent: number; description?: string }) {
    if (input.minPercent >= input.maxPercent) throw new BadRequestException('The minimum percentage must be lower than the maximum.');
    const level = await this.prisma.achievementLevel.upsert({
      where: { schoolId_code: { schoolId: user.schoolId, code: input.code } },
      create: { schoolId: user.schoolId, code: input.code, label: input.label, minPercent: input.minPercent, maxPercent: input.maxPercent, description: input.description ?? null },
      update: { label: input.label, minPercent: input.minPercent, maxPercent: input.maxPercent, description: input.description ?? null },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'achievement-level.upserted', entityType: 'AchievementLevel',
      entityId: level.id, after: input,
      summary: 'School-defined achievement band. These bands are internal to the school and are not official national performance levels.',
    });
    return level;
  }

  /** Resolves the school's configured band for a percentage (never a national band). */
  async resolveAchievementLevel(schoolId: string, percent: number): Promise<string | null> {
    const level = await this.prisma.achievementLevel.findFirst({
      where: { schoolId, isActive: true, minPercent: { lte: percent }, maxPercent: { gte: percent } },
      orderBy: { order: 'asc' },
    });
    return level?.id ?? null;
  }

  /* -------------------------------- rubrics ----------------------------- */

  async listRubrics(user: AuthPrincipal, learningAreaId?: string) {
    const rubrics = await this.prisma.rubric.findMany({
      where: { schoolId: user.schoolId, archivedAt: null, ...(learningAreaId ? { OR: [{ learningAreaId }, { learningAreaId: null }] } : {}) },
      include: { criteria: { orderBy: { order: 'asc' }, include: { levels: { orderBy: { order: 'asc' } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rubrics.map((r) => ({
      id: r.id, title: r.title, description: r.description, learningAreaId: r.learningAreaId, isTemplate: r.isTemplate,
      criteria: r.criteria.map((c) => ({
        id: c.id, title: c.title, description: c.description,
        maxScore: c.maxScore ? Number(c.maxScore) : null, weight: c.weight ? Number(c.weight) : null, order: c.order,
        levels: c.levels.map((l) => ({ id: l.id, label: l.label, score: Number(l.score), description: l.description })),
      })),
    }));
  }

  async createRubric(user: AuthPrincipal, input: RubricInput) {
    const rubric = await this.prisma.rubric.create({
      data: {
        schoolId: user.schoolId, title: input.title, description: input.description ?? null,
        learningAreaId: input.learningAreaId || null, isTemplate: input.isTemplate, createdById: user.userId,
        criteria: {
          create: input.criteria.map((criterion, index) => ({
            title: criterion.title, description: criterion.description ?? null,
            maxScore: criterion.maxScore ?? null, weight: criterion.weight ?? null, order: index,
            levels: { create: criterion.levels.map((level, levelIndex) => ({ label: level.label, score: level.score, description: level.description ?? null, order: levelIndex })) },
          })),
        },
      },
      include: { criteria: { include: { levels: true } } },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'rubric.created', entityType: 'Rubric', entityId: rubric.id, after: { title: input.title, criteria: input.criteria.length } });
    return rubric;
  }

  /* ------------------------------ assessments --------------------------- */

  async list(
    user: AuthPrincipal,
    filters: { classId?: string; learningAreaId?: string; termId?: string; status?: string; categoryId?: string; page?: number; pageSize?: number; search?: string } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, filters.pageSize ?? 25);

    const where: Prisma.AssessmentWhereInput = { schoolId: user.schoolId };
    if (filters.classId) where.classId = filters.classId;
    if (filters.learningAreaId) where.learningAreaId = filters.learningAreaId;
    if (filters.termId) where.termId = filters.termId;
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };

    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const assigned = await this.prisma.teacherAssignment.findMany({ where: { teacherId, isActive: true }, select: { classId: true, learningAreaId: true } });
      // A teacher sees assessments for the classes+learning areas they teach,
      // plus anything they authored (e.g. a class-teacher assessment).
      where.OR = [
        ...assigned.map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId })),
        { createdById: user.userId },
      ];
    } else if (user.role === 'PARENT') {
      // Parents only ever see published assessments for their linked learners.
      const parentId = await this.tenant.parentProfileId(user);
      const links = await this.prisma.parentLearnerLink.findMany({
        where: { parentProfileId: parentId, isVerified: true, revokedAt: null, canViewResults: true },
        select: { learnerId: true },
      });
      const enrollments = await this.prisma.classEnrollment.findMany({
        where: { learnerId: { in: links.map((l) => l.learnerId) }, status: 'ACTIVE' },
        select: { classId: true },
        distinct: ['classId'],
      });
      where.classId = { in: enrollments.map((e) => e.classId) };
      where.status = { in: ['PUBLISHED', 'CORRECTED'] };
    }

    if (filters.status && user.role !== 'PARENT') where.status = filters.status as AssessmentStatus;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assessment.findMany({
        where,
        orderBy: [{ assessmentDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          class: { include: { grade: true } },
          learningArea: { select: { id: true, name: true, colorHex: true, code: true } },
          category: { select: { id: true, name: true, code: true } },
          term: { select: { id: true, name: true } },
          strand: { select: { id: true, name: true } },
          subStrand: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          resources: { include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } } },
          _count: { select: { results: true } },
        },
      }),
      this.prisma.assessment.count({ where }),
    ]);

    const items = await Promise.all(rows.map((row) => this.toDto(row, user)));
    return { items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNext: page * pageSize < total } };
  }

  private async toDto(row: AssessmentRow, user: AuthPrincipal) {
    const learnerCount = await this.prisma.classEnrollment.count({ where: { classId: row.classId, status: 'ACTIVE' } });
    const isOwner = row.createdById === user.userId;
    const isAdmin = user.role === 'ADMIN';
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      instructions: row.instructions,
      academicYearId: row.academicYearId,
      termId: row.termId,
      termName: row.term.name,
      classId: row.classId,
      className: row.class.name,
      gradeLevel: row.class.grade.level,
      learningAreaId: row.learningAreaId,
      learningAreaName: row.learningArea.name,
      learningAreaColor: row.learningArea.colorHex,
      categoryId: row.categoryId,
      categoryCode: row.category.code,
      categoryName: row.category.name,
      strandId: row.strandId,
      strandName: row.strand?.name ?? null,
      subStrandId: row.subStrandId,
      subStrandName: row.subStrand?.name ?? null,
      rubricId: row.rubricId,
      createdById: row.createdById,
      createdByName: row.createdBy.fullName,
      assessmentDate: row.assessmentDate.toISOString().slice(0, 10),
      dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      totalMarks: row.totalMarks ? Number(row.totalMarks) : null,
      usesMarks: row.usesMarks,
      usesRubric: row.usesRubric,
      isExternallyReported: row.isExternallyReported,
      status: row.status,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      correctedAt: row.correctedAt ? row.correctedAt.toISOString() : null,
      correctionReason: row.correctionReason,
      resources: row.resources.map((resource) => ({
        id: resource.id,
        fileId: resource.fileId,
        title: resource.title,
        kind: resource.kind,
        externalUrl: resource.externalUrl,
        fileName: resource.file?.originalName ?? null,
        mimeType: resource.file?.mimeType ?? null,
        sizeBytes: resource.file?.sizeBytes ?? null,
        downloadUrl: resource.fileId ? `/api/v1/files/${resource.fileId}/download` : null,
        createdAt: resource.createdAt.toISOString(),
      })),
      resultSummary: {
        totalLearners: learnerCount,
        entered: row._count.results,
        missing: Math.max(0, learnerCount - row._count.results),
        published: 0,
        completionPercent: learnerCount === 0 ? 0 : Math.round((row._count.results / learnerCount) * 100),
      },
      canEdit: (isOwner || isAdmin) && ['DRAFT', 'READY_FOR_REVIEW', 'CORRECTED'].includes(row.status),
      canPublish: (isOwner || isAdmin) && row.status !== 'ARCHIVED',
    };
  }

  async get(user: AuthPrincipal, id: string) {
    const row = await this.prisma.assessment.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        class: { include: { grade: true } }, learningArea: true, category: true, term: true, strand: true, subStrand: true,
        createdBy: true, resources: { include: { file: true } }, _count: { select: { results: true } },
      },
    });
    if (!row) throw new TenantIsolationException('Assessment');
    if (isTeacherRole(user.role)) {
      await this.tenant.assertTeacherClassAssignment(user, row.classId, row.learningAreaId);
    }
    if (user.role === 'PARENT') {
      if (!['PUBLISHED', 'CORRECTED'].includes(row.status)) throw new TenantIsolationException('Assessment');
      const parentId = await this.tenant.parentProfileId(user);
      const allowed = await this.prisma.classEnrollment.findFirst({
        where: {
          classId: row.classId, status: 'ACTIVE',
          learner: { parentLinks: { some: { parentProfileId: parentId, isVerified: true, revokedAt: null, canViewResults: true } } },
        },
        select: { id: true },
      });
      if (!allowed) throw new ResourceAccessDeniedException('This assessment is not available for your linked learner.');
    }
    return this.toDto(row, user);
  }

  async create(user: AuthPrincipal, input: AssessmentInput) {
    const [klass, area, category, term] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: input.classId, schoolId: user.schoolId } }),
      this.prisma.learningArea.findFirst({ where: { id: input.learningAreaId, schoolId: user.schoolId } }),
      this.prisma.assessmentCategory.findFirst({ where: { id: input.categoryId, schoolId: user.schoolId } }),
      this.prisma.term.findFirst({ where: { id: input.termId, schoolId: user.schoolId } }),
    ]);
    if (!klass) throw new TenantIsolationException('Class');
    if (!area) throw new TenantIsolationException('Learning area');
    if (!category) throw new TenantIsolationException('Assessment category');
    if (!term) throw new TenantIsolationException('Term');
    if (term.academicYearId !== input.academicYearId) throw new BusinessRuleException('The selected term does not belong to the selected academic year.');
    if (klass.academicYearId !== input.academicYearId) throw new BusinessRuleException('The selected class belongs to a different academic year.');

    // Teachers may only create assessments for classes/learning areas they teach.
    await this.tenant.assertTeacherClassAssignment(user, input.classId, input.learningAreaId);

    if (input.usesRubric && !input.rubricId) throw new BusinessRuleException('Select a rubric when rubric assessment is enabled.');

    const created = await this.prisma.assessment.create({
      data: {
        schoolId: user.schoolId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        classId: input.classId,
        learningAreaId: input.learningAreaId,
        categoryId: input.categoryId,
        strandId: input.strandId || null,
        subStrandId: input.subStrandId || null,
        rubricId: input.rubricId || null,
        createdById: user.userId,
        title: input.title,
        description: input.description || null,
        instructions: input.instructions || null,
        assessmentDate: new Date(input.assessmentDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        totalMarks: input.totalMarks ?? null,
        usesMarks: input.usesMarks,
        usesRubric: input.usesRubric,
        weight: input.weight ?? null,
        isExternallyReported: input.isExternallyReported,
        status: AssessmentStatus.DRAFT,
      },
    });

    await this.prisma.assessmentChangeLog.create({
      data: { assessmentId: created.id, actorId: user.userId, action: 'CREATE', summary: `Created "${created.title}" for ${klass.name}` },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role, action: 'assessment.created',
      entityType: 'Assessment', entityId: created.id,
      after: { title: created.title, classId: created.classId, learningAreaId: created.learningAreaId, totalMarks: created.totalMarks ? Number(created.totalMarks) : null },
    });
    return this.get(user, created.id);
  }

  async update(user: AuthPrincipal, id: string, input: Partial<AssessmentInput>) {
    const existing = await this.prisma.assessment.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Assessment');
    if (isTeacherRole(user.role)) {
      if (existing.createdById !== user.userId) throw new ResourceAccessDeniedException('Only the teacher who created this assessment can edit it.');
      await this.tenant.assertTeacherClassAssignment(user, existing.classId, existing.learningAreaId);
    }
    if (existing.status === 'PUBLISHED' || existing.status === 'ARCHIVED') {
      throw new BusinessRuleException(
        `A ${existing.status.toLowerCase()} assessment cannot be edited. Amend the affected results instead, which keeps the change auditable.`,
      );
    }
    if (input.totalMarks !== undefined && input.totalMarks !== null && existing.usesMarks) {
      const outOfRange = await this.prisma.assessmentResult.count({
        where: { assessmentId: id, numericScore: { gt: input.totalMarks } },
      });
      if (outOfRange > 0) throw new BusinessRuleException(`${outOfRange} entered result(s) exceed the new total of ${input.totalMarks}. Adjust those results first.`);
    }

    const updated = await this.prisma.assessment.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions || null } : {}),
        ...(input.assessmentDate ? { assessmentDate: new Date(input.assessmentDate) } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
        ...(input.totalMarks !== undefined ? { totalMarks: input.totalMarks ?? null } : {}),
        ...(input.usesMarks !== undefined ? { usesMarks: input.usesMarks } : {}),
        ...(input.usesRubric !== undefined ? { usesRubric: input.usesRubric } : {}),
        ...(input.rubricId !== undefined ? { rubricId: input.rubricId || null } : {}),
        ...(input.strandId !== undefined ? { strandId: input.strandId || null } : {}),
        ...(input.subStrandId !== undefined ? { subStrandId: input.subStrandId || null } : {}),
        ...(input.weight !== undefined ? { weight: input.weight ?? null } : {}),
      },
    });
    await this.prisma.assessmentChangeLog.create({
      data: {
        assessmentId: id, actorId: user.userId, action: 'UPDATE',
        summary: `Updated ${Object.keys(input).join(', ')}`,
        beforeJson: { title: existing.title, totalMarks: existing.totalMarks ? Number(existing.totalMarks) : null },
        afterJson: { title: updated.title, totalMarks: updated.totalMarks ? Number(updated.totalMarks) : null },
      },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'assessment.updated', entityType: 'Assessment', entityId: id, after: input });
    return this.get(user, id);
  }

  /* ------------------------------- lifecycle ---------------------------- */

  async changeStatus(user: AuthPrincipal, id: string, input: StatusInput) {
    const assessment = await this.prisma.assessment.findFirst({ where: { id, schoolId: user.schoolId }, include: { class: true, learningArea: true } });
    if (!assessment) throw new TenantIsolationException('Assessment');
    if (isTeacherRole(user.role)) await this.tenant.assertTeacherClassAssignment(user, assessment.classId, assessment.learningAreaId);

    const target = input.status as AssessmentStatus;
    const allowed = ALLOWED_TRANSITIONS[assessment.status] ?? [];
    if (!allowed.includes(target)) {
      throw new BusinessRuleException(`Cannot move an assessment from ${assessment.status} to ${target}. Allowed: ${allowed.join(', ') || 'none'}.`);
    }

    if (target === 'PUBLISHED' || target === 'CORRECTED') {
      if (user.role !== 'ADMIN' && !isTeacherRole(user.role)) throw new ResourceAccessDeniedException('Only teachers and administrators can publish results.');
      return this.publish(user, id, input.reason ?? undefined);
    }
    if (target === 'ARCHIVED') {
      return this.prisma.assessment.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    }
    const updated = await this.prisma.assessment.update({ where: { id }, data: { status: target } });
    await this.prisma.assessmentChangeLog.create({ data: { assessmentId: id, actorId: user.userId, action: target === 'READY_FOR_REVIEW' ? 'SUBMIT' : 'UPDATE', summary: `Status changed to ${target}`, reason: input.reason ?? null } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'assessment.status.changed', entityType: 'Assessment', entityId: id, before: { status: assessment.status }, after: { status: target } });
    return updated;
  }

  /**
   * Publishes results. Runs in a transaction: results become visible to parents
   * atomically, feedback is flagged published, and guardians are notified.
   * Parents only ever see PUBLISHED / CORRECTED results.
   */
  async publish(user: AuthPrincipal, id: string, reason?: string, notifyParents = true) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, schoolId: user.schoolId },
      include: { class: { include: { grade: true } }, learningArea: true, term: true },
    });
    if (!assessment) throw new TenantIsolationException('Assessment');
    if (isTeacherRole(user.role)) await this.tenant.assertTeacherClassAssignment(user, assessment.classId, assessment.learningAreaId);

    const learners = await this.prisma.classEnrollment.findMany({ where: { classId: assessment.classId, status: 'ACTIVE' }, select: { learnerId: true } });
    const results = await this.prisma.assessmentResult.findMany({
      where: { assessmentId: id },
      include: { learner: { select: { firstName: true, lastName: true } } },
    });
    if (results.length === 0) throw new BusinessRuleException('There are no results to publish yet. Enter results first.');

    const missing = learners.filter((l) => !results.some((r) => r.learnerId === l.learnerId));
    const isCorrection = assessment.status === 'PUBLISHED' || assessment.status === 'CORRECTED';
    if (isCorrection && !reason) {
      throw new BusinessRuleException('Provide a reason for re-publishing an already published assessment. It is stored in the audit trail.');
    }

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.assessmentResult.updateMany({
        where: { assessmentId: id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: user.userId },
      });
      await tx.resultFeedback.updateMany({ where: { result: { assessmentId: id } }, data: { isPublished: true } });
      const updated = await tx.assessment.update({
        where: { id },
        data: {
          status: isCorrection ? 'CORRECTED' : 'PUBLISHED',
          publishedAt: new Date(),
          publishedById: user.userId,
          ...(isCorrection ? { correctedAt: new Date(), correctionReason: reason ?? null } : {}),
        },
      });
      await tx.assessmentChangeLog.create({
        data: {
          assessmentId: id, actorId: user.userId, action: isCorrection ? 'CORRECT' : 'PUBLISH',
          summary: `${results.length} result(s) published${missing.length ? `; ${missing.length} learner(s) without a result` : ''}`,
          reason: reason ?? null,
        },
      });
      for (const result of results) {
        await tx.resultChangeLog.create({
          data: { resultId: result.id, actorId: user.userId, action: isCorrection ? 'AMEND' : 'PUBLISH', reason: reason ?? null, afterJson: { status: 'PUBLISHED' } },
        });
      }
      return updated;
    });

    if (notifyParents) await this.notifyGuardians(assessment, results.map((r) => r.learnerId), isCorrection);

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: isCorrection ? 'assessment.corrected' : 'assessment.published',
      entityType: 'Assessment', entityId: id,
      summary: `${assessment.title} • ${assessment.class.name} • ${assessment.learningArea.name} — ${results.length} result(s)${missing.length ? `, ${missing.length} missing` : ''}`,
      after: { status: published.status, missingResults: missing.length, reason: reason ?? null },
    });

    return { ...published, resultCount: results.length, missingCount: missing.length };
  }

  private async notifyGuardians(
    assessment: { id: string; title: string; schoolId: string; class: { name: string } ; learningArea: { name: string } },
    learnerIds: string[],
    isCorrection: boolean,
  ): Promise<void> {
    const links = await this.prisma.parentLearnerLink.findMany({
      where: { learnerId: { in: learnerIds }, isVerified: true, revokedAt: null, canViewResults: true },
      include: { parentProfile: { include: { user: { select: { id: true, email: true, fullName: true } } } } },
    });
    const byUser = new Map<string, { name: string; email: string }>();
    for (const link of links) byUser.set(link.parentProfile.user.id, { name: link.parentProfile.user.fullName, email: link.parentProfile.user.email });

    await this.notifications.notify({
      schoolId: assessment.schoolId,
      userIds: [...byUser.keys()],
      type: NotificationType.ASSESSMENT_PUBLISHED,
      title: isCorrection ? 'Assessment results updated' : 'New assessment results published',
      body: `${assessment.title} (${assessment.learningArea.name} • ${assessment.class.name}) results are now available in your child's portal.`,
      link: '/parent/results',
      entityType: 'Assessment',
      entityId: assessment.id,
      email: byUser.size
        ? {
            to: [...byUser.values()].map((u) => u.email),
            subject: `Results published: ${assessment.title}`,
            text: `Results for ${assessment.title} (${assessment.learningArea.name}) have been published to your EduTrack Pro account. Sign in to view them.`,
          }
        : null,
    });
  }

  /* ------------------------------ dashboard ----------------------------- */

  async dashboard(user: AuthPrincipal) {
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const scopeWhere: Prisma.AssessmentWhereInput = { schoolId: user.schoolId };
    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const assigned = await this.prisma.teacherAssignment.findMany({ where: { teacherId, isActive: true }, select: { classId: true, learningAreaId: true } });
      scopeWhere.OR = [...assigned.map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId })), { createdById: user.userId }];
    }

    const [upcoming, drafts, published, ready] = await this.prisma.$transaction([
      this.prisma.assessment.count({ where: { ...scopeWhere, assessmentDate: { gte: now, lte: horizon }, status: 'DRAFT' } }),
      this.prisma.assessment.count({ where: { ...scopeWhere, status: 'DRAFT' } }),
      this.prisma.assessment.count({ where: { ...scopeWhere, status: { in: ['PUBLISHED', 'CORRECTED'] } } }),
      this.prisma.assessment.count({ where: { ...scopeWhere, status: 'READY_FOR_REVIEW' } }),
    ]);

    const incomplete = await this.prisma.assessment.findMany({
      where: { ...scopeWhere, status: { in: ['DRAFT', 'READY_FOR_REVIEW'] } },
      take: 25,
      orderBy: { assessmentDate: 'asc' },
      include: {
        class: { select: { id: true, name: true } },
        learningArea: { select: { name: true } },
        _count: { select: { results: true } },
      },
    });

    const withMissing = await Promise.all(
      incomplete.map(async (assessment) => {
        const total = await this.prisma.classEnrollment.count({ where: { classId: assessment.classId, status: 'ACTIVE' } });
        return {
          id: assessment.id,
          title: assessment.title,
          className: assessment.class.name,
          learningAreaName: assessment.learningArea.name,
          assessmentDate: assessment.assessmentDate.toISOString().slice(0, 10),
          status: assessment.status,
          entered: assessment._count.results,
          expected: total,
          missing: Math.max(0, total - assessment._count.results),
        };
      }),
    );

    return {
      counts: { upcomingDue: upcoming, drafts, published, awaitingReview: ready },
      missingResults: withMissing.filter((a) => a.missing > 0).sort((a, b) => b.missing - a.missing).slice(0, 10),
      recentChangeLog: await this.prisma.assessmentChangeLog.findMany({
        where: { assessment: { schoolId: user.schoolId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { assessment: { select: { id: true, title: true } } },
      }),
    };
  }
}
