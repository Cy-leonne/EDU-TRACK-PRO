import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { bulkClassRequirementSchema, classRequirementSchema, learningAreaSchema, strandSchema, subStrandSchema } from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantIsolationException } from '../../common/errors/domain-errors';
import type { AuthPrincipal } from '../../common/guards/auth.guard';

type LearningAreaInput = z.infer<typeof learningAreaSchema>;
type StrandInput = z.infer<typeof strandSchema>;
type SubStrandInput = z.infer<typeof subStrandSchema>;
type RequirementInput = z.infer<typeof classRequirementSchema>;
type BulkRequirementInput = z.infer<typeof bulkClassRequirementSchema>;

@Injectable()
export class LearningAreasService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(user: AuthPrincipal, search?: string) {
    // Parents and teachers only need active areas for their own classes; the
    // catalogue itself is not sensitive, but we still scope it to the school.
    const areas = await this.prisma.learningArea.findMany({
      where: {
        schoolId: user.schoolId,
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { strands: true, requirements: true, assessments: true } } },
    });
    return areas.map((a) => ({
      id: a.id, code: a.code, name: a.name, shortName: a.shortName, colorHex: a.colorHex,
      isCore: a.isCore, isExamined: a.isExamined, defaultPeriodsPerWeek: a.defaultPeriodsPerWeek,
      order: a.order, isActive: a.isActive, strandCount: a._count.strands,
      requirementCount: a._count.requirements, assessmentCount: a._count.assessments,
    }));
  }

  async create(user: AuthPrincipal, input: LearningAreaInput) {
    const area = await this.prisma.learningArea.create({
      data: { schoolId: user.schoolId, ...input, shortName: input.shortName || null, description: input.description || null },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'learning-area.created', entityType: 'LearningArea', entityId: area.id, after: area });
    return area;
  }

  async update(user: AuthPrincipal, id: string, input: Partial<LearningAreaInput>) {
    const existing = await this.prisma.learningArea.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Learning area');
    if (input.isActive === false) {
      const timetabled = await this.prisma.timetableEntry.count({ where: { learningAreaId: id } });
      if (timetabled > 0) {
        throw new BadRequestException('This learning area is used in a timetable. Archive the timetable first or keep it active.');
      }
    }
    const updated = await this.prisma.learningArea.update({
      where: { id },
      data: {
        ...(input.code ? { code: input.code } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName || null } : {}),
        ...(input.colorHex ? { colorHex: input.colorHex } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.isCore !== undefined ? { isCore: input.isCore } : {}),
        ...(input.isExamined !== undefined ? { isExamined: input.isExamined } : {}),
        ...(input.defaultPeriodsPerWeek !== undefined ? { defaultPeriodsPerWeek: input.defaultPeriodsPerWeek } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'learning-area.updated', entityType: 'LearningArea', entityId: id, before: existing, after: updated });
    return updated;
  }

  async archive(user: AuthPrincipal, id: string) {
    const existing = await this.prisma.learningArea.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Learning area');
    return this.prisma.learningArea.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } });
  }

  /* ------------------------------ strands ------------------------------- */

  async listStrands(user: AuthPrincipal, learningAreaId?: string) {
    const strands = await this.prisma.strand.findMany({
      where: { schoolId: user.schoolId, ...(learningAreaId ? { learningAreaId } : {}) },
      orderBy: [{ learningArea: { order: 'asc' } }, { order: 'asc' }],
      include: {
        learningArea: { select: { id: true, name: true, code: true, colorHex: true } },
        subStrands: { orderBy: { order: 'asc' } },
        teachers: { include: { teacher: { select: { id: true, staffNumber: true, user: { select: { fullName: true } } } } } },
      },
    });
    return strands.map((s) => ({
      id: s.id, name: s.name, description: s.description, order: s.order,
      learningArea: s.learningArea,
      subStrands: s.subStrands.map((sub) => ({ id: sub.id, name: sub.name, description: sub.description, order: sub.order })),
      teachers: s.teachers.map((t) => ({ id: t.teacher.id, name: t.teacher.user.fullName, staffNumber: t.teacher.staffNumber })),
    }));
  }

  async createStrand(user: AuthPrincipal, input: StrandInput) {
    const area = await this.prisma.learningArea.findFirst({ where: { id: input.learningAreaId, schoolId: user.schoolId } });
    if (!area) throw new TenantIsolationException('Learning area');
    return this.prisma.strand.create({ data: { schoolId: user.schoolId, ...input, description: input.description || null } });
  }

  async createSubStrand(user: AuthPrincipal, input: SubStrandInput) {
    const strand = await this.prisma.strand.findFirst({ where: { id: input.strandId, schoolId: user.schoolId } });
    if (!strand) throw new TenantIsolationException('Strand');
    return this.prisma.subStrand.create({ data: { schoolId: user.schoolId, ...input, description: input.description || null } });
  }

  /* ------------------------ per-class requirements ---------------------- */

  /** Weekly period allocation per class + learning area (school policy). */
  async listRequirements(user: AuthPrincipal, classId?: string) {
    const rows = await this.prisma.classLearningAreaRequirement.findMany({
      where: { schoolId: user.schoolId, ...(classId ? { classId } : {}) },
      include: {
        class: { select: { id: true, name: true, grade: { select: { level: true, name: true } } } },
        learningArea: { select: { id: true, name: true, code: true, colorHex: true } },
      },
      orderBy: [{ class: { name: 'asc' } }, { learningArea: { order: 'asc' } }],
    });
    return rows.map((r) => ({
      id: r.id,
      classId: r.classId,
      className: r.class.name,
      gradeLevel: r.class.grade.level,
      learningAreaId: r.learningAreaId,
      learningAreaName: r.learningArea.name,
      learningAreaColor: r.learningArea.colorHex,
      periodsPerWeek: r.periodsPerWeek,
      preferDoubleLesson: r.preferDoubleLesson,
      preferMorning: r.preferMorning,
      requiredRoomId: r.requiredRoomId,
    }));
  }

  async upsertRequirement(user: AuthPrincipal, input: RequirementInput) {
    const [klass, area] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: input.classId, schoolId: user.schoolId }, select: { id: true } }),
      this.prisma.learningArea.findFirst({ where: { id: input.learningAreaId, schoolId: user.schoolId }, select: { id: true } }),
    ]);
    if (!klass) throw new TenantIsolationException('Class');
    if (!area) throw new TenantIsolationException('Learning area');

    const requirement = await this.prisma.classLearningAreaRequirement.upsert({
      where: { classId_learningAreaId: { classId: input.classId, learningAreaId: input.learningAreaId } },
      create: { schoolId: user.schoolId, ...input, requiredRoomId: input.requiredRoomId || null },
      update: {
        periodsPerWeek: input.periodsPerWeek,
        preferDoubleLesson: input.preferDoubleLesson,
        preferMorning: input.preferMorning,
        requiredRoomId: input.requiredRoomId || null,
      },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'class.requirement.upserted',
      entityType: 'ClassLearningAreaRequirement', entityId: requirement.id, after: requirement,
    });
    return requirement;
  }

  /** Applies the same allocation to a set of classes (typical setup pattern). */
  async bulkUpsertRequirements(user: AuthPrincipal, input: BulkRequirementInput) {
    const classes = await this.prisma.class.findMany({ where: { id: { in: input.classIds }, schoolId: user.schoolId }, select: { id: true } });
    if (classes.length !== input.classIds.length) throw new TenantIsolationException('Class');

    const results = await this.prisma.$transaction(
      classes.flatMap((klass) =>
        input.requirements.map((req) =>
          this.prisma.classLearningAreaRequirement.upsert({
            where: { classId_learningAreaId: { classId: klass.id, learningAreaId: req.learningAreaId } },
            create: {
              schoolId: user.schoolId, classId: klass.id, learningAreaId: req.learningAreaId,
              periodsPerWeek: req.periodsPerWeek, preferDoubleLesson: req.preferDoubleLesson, preferMorning: req.preferMorning,
            },
            update: { periodsPerWeek: req.periodsPerWeek, preferDoubleLesson: req.preferDoubleLesson, preferMorning: req.preferMorning },
          }),
        ),
      ),
    );
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'class.requirements.bulk_upserted',
      entityType: 'ClassLearningAreaRequirement', summary: `${results.length} allocations applied across ${classes.length} class(es)`,
    });
    return { classesUpdated: classes.length, allocations: results.length };
  }

  async deleteRequirement(user: AuthPrincipal, id: string) {
    const row = await this.prisma.classLearningAreaRequirement.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!row) throw new TenantIsolationException('Requirement');
    await this.prisma.classLearningAreaRequirement.delete({ where: { id } });
    return { deleted: true };
  }

  /** Template learning areas a school can import during setup. */
  async importTemplate(user: AuthPrincipal, areas: { code: string; name: string; shortName?: string; colorHex?: string; isCore?: boolean }[]) {
    const created = await this.prisma.$transaction(
      areas.map((area) =>
        this.prisma.learningArea.upsert({
          where: { schoolId_code: { schoolId: user.schoolId, code: area.code } },
          create: { schoolId: user.schoolId, code: area.code, name: area.name, shortName: area.shortName, colorHex: area.colorHex ?? '#0F766E', isCore: area.isCore ?? false },
          update: { name: area.name },
        }),
      ),
    );
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'learning-area.template_imported', entityType: 'LearningArea', summary: `${created.length} learning areas ensured` });
    return { count: created.length };
  }
}
