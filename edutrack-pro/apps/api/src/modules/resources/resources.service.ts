import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { assignmentSchema, learningResourceSchema } from '@edutrack/validation';
import { isTeacherRole } from '@edutrack/shared-config';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessRuleException, TenantIsolationException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { NotificationType } from '@prisma/client';

type ResourceInput = z.infer<typeof learningResourceSchema>;
type AssignmentInput = z.infer<typeof assignmentSchema>;

/**
 * Learning resources and assignments.
 * Visibility rules enforced here (in addition to the API permissions):
 *  * teachers see resources for the classes/learning areas they teach;
 *  * parents see only PUBLISHED resources marked visibleToParents for a class
 *    their verified linked learner is enrolled in - a guessed resource id
 *    returns 404, never another family's material.
 */
@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly notifications: NotificationsService,
  ) {}

  private async scopeWhere(user: AuthPrincipal): Promise<Prisma.LearningResourceWhereInput> {
    const where: Prisma.LearningResourceWhereInput = { schoolId: user.schoolId, archivedAt: null };
    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const assignments = await this.prisma.teacherAssignment.findMany({ where: { teacherId, isActive: true }, select: { classId: true, learningAreaId: true } });
      where.OR = [...assignments.map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId })), { createdById: user.userId }];
    }
    if (user.role === 'PARENT') {
      const parentId = await this.tenant.parentProfileId(user);
      const links = await this.prisma.parentLearnerLink.findMany({
        where: { parentProfileId: parentId, isVerified: true, revokedAt: null, canViewResources: true },
        select: { learnerId: true },
      });
      const enrollments = await this.prisma.classEnrollment.findMany({
        where: { learnerId: { in: links.map((l) => l.learnerId) }, status: 'ACTIVE' },
        select: { classId: true },
        distinct: ['classId'],
      });
      where.classId = { in: enrollments.map((e) => e.classId) };
      where.publishedAt = { not: null };
      where.visibleToParents = true;
    }
    return where;
  }

  async list(user: AuthPrincipal, filters: { classId?: string; learningAreaId?: string; type?: string; search?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, filters.pageSize ?? 25);
    const scope = await this.scopeWhere(user);
    const where: Prisma.LearningResourceWhereInput = {
      ...scope,
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.learningAreaId ? { learningAreaId: filters.learningAreaId } : {}),
      ...(filters.type ? { type: filters.type as never } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.learningResource.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          class: { select: { id: true, name: true } },
          learningArea: { select: { id: true, name: true, colorHex: true } },
          createdBy: { select: { fullName: true } },
          file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
        },
      }),
      this.prisma.learningResource.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id, title: r.title, description: r.description, body: r.body, type: r.type,
        classId: r.classId, className: r.class.name,
        learningAreaId: r.learningAreaId, learningAreaName: r.learningArea.name, learningAreaColor: r.learningArea.colorHex,
        createdByName: r.createdBy.fullName, fileId: r.fileId, fileName: r.file?.originalName ?? null,
        mimeType: r.file?.mimeType ?? null, sizeBytes: r.file?.sizeBytes ?? null,
        downloadUrl: r.fileId ? `/api/v1/files/${r.fileId}/download` : null,
        externalUrl: r.externalUrl, dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
        visibleToParents: r.visibleToParents, publishedAt: r.publishedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNext: page * pageSize < total },
    };
  }

  async get(user: AuthPrincipal, id: string) {
    const scope = await this.scopeWhere(user);
    const resource = await this.prisma.learningResource.findFirst({
      where: { AND: [{ id, schoolId: user.schoolId }, scope] },
      include: {
        class: { select: { id: true, name: true } },
        learningArea: { select: { id: true, name: true, colorHex: true } },
        createdBy: { select: { fullName: true } },
        file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
    });
    if (!resource) throw new TenantIsolationException('Learning resource');
    return {
      id: resource.id, title: resource.title, description: resource.description, body: resource.body, type: resource.type,
      classId: resource.classId, className: resource.class.name,
      learningAreaId: resource.learningAreaId, learningAreaName: resource.learningArea.name, learningAreaColor: resource.learningArea.colorHex,
      createdByName: resource.createdBy.fullName, fileName: resource.file?.originalName ?? null,
      mimeType: resource.file?.mimeType ?? null, sizeBytes: resource.file?.sizeBytes ?? null,
      downloadUrl: resource.fileId ? `/api/v1/files/${resource.fileId}/download` : null,
      externalUrl: resource.externalUrl, dueDate: resource.dueDate?.toISOString().slice(0, 10) ?? null,
      visibleToParents: resource.visibleToParents, publishedAt: resource.publishedAt?.toISOString() ?? null, createdAt: resource.createdAt.toISOString(),
    };
  }

  async create(user: AuthPrincipal, input: ResourceInput) {
    if (user.role === 'PARENT') throw new BusinessRuleException('Parents cannot publish learning resources.');
    const teacherId = await this.tenant.teacherProfileId(user);
    void teacherId;
    await this.tenant.assertTeacherClassAssignment(user, input.classId, input.learningAreaId);

    if (input.fileId) {
      const file = await this.prisma.fileObject.findFirst({ where: { id: input.fileId, schoolId: user.schoolId, deletedAt: null } });
      if (!file) throw new TenantIsolationException('File');
    }

    const resource = await this.prisma.learningResource.create({
      data: {
        schoolId: user.schoolId, classId: input.classId, learningAreaId: input.learningAreaId, createdById: user.userId,
        type: input.type, title: input.title, description: input.description ?? null, body: input.body ?? null,
        fileId: input.fileId || null, externalUrl: input.externalUrl || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        visibleToParents: input.visibleToParents, publishedAt: input.publishNow ? new Date() : null,
      },
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role, action: 'resource.created',
      entityType: 'LearningResource', entityId: resource.id,
      summary: `"${resource.title}" (${resource.type}) shared${input.publishNow ? '' : ' as draft'}`,
    });

    if (input.publishNow && input.visibleToParents) await this.notifyGuardiansOfClass(user, input.classId, resource.title, 'NEW_RESOURCE', '/parent/resources');
    return this.get(user, resource.id);
  }

  async update(user: AuthPrincipal, id: string, input: Partial<ResourceInput>) {
    const resource = await this.prisma.learningResource.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!resource) throw new TenantIsolationException('Learning resource');
    if (isTeacherRole(user.role) && resource.createdById !== user.userId) {
      throw new BusinessRuleException('You can only edit resources you published.');
    }
    await this.prisma.learningResource.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.body !== undefined ? { body: input.body ?? null } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.fileId !== undefined ? { fileId: input.fileId || null } : {}),
        ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl || null } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
        ...(input.visibleToParents !== undefined ? { visibleToParents: input.visibleToParents } : {}),
        ...(input.publishNow !== undefined ? { publishedAt: input.publishNow ? new Date() : null } : {}),
      },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'resource.updated', entityType: 'LearningResource', entityId: id, before: { title: resource.title }, after: input });
    return this.get(user, id);
  }

  async archive(user: AuthPrincipal, id: string) {
    const resource = await this.prisma.learningResource.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!resource) throw new TenantIsolationException('Learning resource');
    if (isTeacherRole(user.role) && resource.createdById !== user.userId) throw new BusinessRuleException('You can only archive resources you published.');
    await this.prisma.learningResource.update({ where: { id }, data: { archivedAt: new Date(), publishedAt: null } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'resource.archived', entityType: 'LearningResource', entityId: id, summary: resource.title });
    return { archived: true };
  }

  /* ------------------------------ assignments --------------------------- */

  async listAssignments(user: AuthPrincipal, filters: { classId?: string; learningAreaId?: string; upcomingOnly?: boolean } = {}) {
    const where: Prisma.AssignmentWhereInput = { schoolId: user.schoolId, archivedAt: null };
    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const assignments = await this.prisma.teacherAssignment.findMany({ where: { teacherId, isActive: true }, select: { classId: true, learningAreaId: true } });
      where.OR = [...assignments.map((a) => ({ classId: a.classId, learningAreaId: a.learningAreaId })), { createdById: user.userId }];
    }
    if (user.role === 'PARENT') {
      const parentId = await this.tenant.parentProfileId(user);
      const links = await this.prisma.parentLearnerLink.findMany({ where: { parentProfileId: parentId, isVerified: true, revokedAt: null, canViewResources: true }, select: { learnerId: true } });
      const enrollments = await this.prisma.classEnrollment.findMany({
        where: { learnerId: { in: links.map((l) => l.learnerId) }, status: 'ACTIVE' },
        select: { classId: true }, distinct: ['classId'],
      });
      where.classId = { in: enrollments.map((e) => e.classId) };
      where.publishedAt = { not: null };
    }
    if (filters.classId) where.classId = filters.classId;
    if (filters.learningAreaId) where.learningAreaId = filters.learningAreaId;
    if (filters.upcomingOnly) where.dueDate = { gte: new Date() };

    const rows = await this.prisma.assignment.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        class: { select: { id: true, name: true } },
        learningArea: { select: { id: true, name: true, colorHex: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id, title: a.title, instructions: a.instructions,
      classId: a.classId, className: a.class.name,
      learningAreaId: a.learningAreaId, learningAreaName: a.learningArea.name, learningAreaColor: a.learningArea.colorHex,
      dueDate: a.dueDate?.toISOString().slice(0, 10) ?? null, maxScore: a.maxScore ? Number(a.maxScore) : null,
      publishedAt: a.publishedAt?.toISOString() ?? null, createdByName: a.createdBy.fullName,
    }));
  }

  async createAssignment(user: AuthPrincipal, input: AssignmentInput) {
    if (user.role === 'PARENT') throw new BusinessRuleException('Parents cannot create assignments.');
    await this.tenant.assertTeacherClassAssignment(user, input.classId, input.learningAreaId);
    const assignment = await this.prisma.assignment.create({
      data: {
        schoolId: user.schoolId, classId: input.classId, learningAreaId: input.learningAreaId,
        resourceId: input.resourceId || null, createdById: user.userId, title: input.title,
        instructions: input.instructions ?? null, dueDate: input.dueDate ? new Date(input.dueDate) : null,
        maxScore: input.maxScore ?? null, publishedAt: input.publishNow ? new Date() : null,
      },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role, action: 'assignment.created',
      entityType: 'Assignment', entityId: assignment.id, summary: `"${assignment.title}" assigned`,
    });
    if (input.publishNow) await this.notifyGuardiansOfClass(user, input.classId, assignment.title, 'NEW_ASSIGNMENT', '/parent/assignments');
    return assignment;
  }

  private async notifyGuardiansOfClass(user: AuthPrincipal, classId: string, title: string, type: 'NEW_RESOURCE' | 'NEW_ASSIGNMENT', link: string) {
    const links = await this.prisma.parentLearnerLink.findMany({
      where: { isVerified: true, revokedAt: null, canViewResources: true, learner: { enrollments: { some: { classId, status: 'ACTIVE' } } } },
      select: { parentProfile: { select: { userId: true } } },
    });
    const klass = await this.prisma.class.findUnique({ where: { id: classId }, select: { name: true } });
    await this.notifications.notify({
      schoolId: user.schoolId,
      userIds: links.map((l) => l.parentProfile.userId),
      type: type === 'NEW_RESOURCE' ? NotificationType.NEW_RESOURCE : NotificationType.NEW_ASSIGNMENT,
      title: type === 'NEW_RESOURCE' ? 'New learning material shared' : 'New assignment posted',
      body: `${title} — ${klass?.name ?? 'class'}`,
      link,
      entityType: type === 'NEW_RESOURCE' ? 'LearningResource' : 'Assignment',
    });
  }
}
