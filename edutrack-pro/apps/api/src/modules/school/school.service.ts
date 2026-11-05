import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type {
  academicYearSchema, schoolProfileSchema, termSchema,
} from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { TenantIsolationException } from '../../common/errors/domain-errors';

type SchoolProfileInput = z.infer<typeof schoolProfileSchema>;
type AcademicYearInput = z.infer<typeof academicYearSchema>;
type TermInput = z.infer<typeof termSchema>;

@Injectable()
export class SchoolService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getProfile(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      include: {
        academicYears: { orderBy: { startDate: 'desc' }, select: { id: true, name: true, startDate: true, endDate: true, isCurrent: true, isLocked: true } },
      },
    });
    if (!school) throw new TenantIsolationException('School');
    const [currentYear, currentTerm] = await Promise.all([
      school.currentAcademicYearId ? this.prisma.academicYear.findUnique({ where: { id: school.currentAcademicYearId }, select: { id: true, name: true } }) : null,
      school.currentTermId ? this.prisma.term.findUnique({ where: { id: school.currentTermId }, select: { id: true, name: true, number: true } }) : null,
    ]);
    const { academicYears, ...rest } = school;
    return {
      ...rest,
      currentAcademicYear: currentYear,
      currentTerm,
      academicYears,
      workingDays: school.workingDays,
      breakConfig: (school.breakConfig as unknown) ?? [],
      lunchConfig: (school.lunchConfig as unknown) ?? null,
      logoUrl: school.logoFileId ? `/api/v1/files/${school.logoFileId}/download` : null,
    };
  }

  async updateProfile(user: AuthPrincipal, input: SchoolProfileInput) {
    const before = await this.prisma.school.findUnique({ where: { id: user.schoolId } });
    if (!before) throw new TenantIsolationException('School');

    const school = await this.prisma.school.update({
      where: { id: user.schoolId },
      data: {
        name: input.name,
        code: input.code || null,
        addressLine: input.addressLine || null,
        county: input.county || null,
        phone: input.phone || null,
        email: input.email || null,
        website: input.website || null,
        motto: input.motto || null,
        timezone: input.timezone,
        portalName: input.portalName,
        primaryColor: input.primaryColor,
        accentColor: input.accentColor,
        workingDays: input.workingDays,
        schoolOpenTime: input.schoolOpenTime,
        schoolCloseTime: input.schoolCloseTime,
        defaultPeriodMinutes: input.defaultPeriodMinutes,
        maxPeriodsPerDay: input.maxPeriodsPerDay,
        breakConfig: (input.breaks ?? []) as never,
        lunchConfig: (input.lunchAfterPeriod ? { afterPeriod: input.lunchAfterPeriod, minutes: input.lunchMinutes ?? 45 } : null) as never,
      },
    });

    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'school.profile.updated',
      entityType: 'School',
      entityId: user.schoolId,
      before: { name: before.name, workingDays: before.workingDays, schoolOpenTime: before.schoolOpenTime },
      after: { name: school.name, workingDays: school.workingDays, schoolOpenTime: school.schoolOpenTime },
    });
    return this.getProfile(user.schoolId);
  }

  /* ------------------------------ calendar ------------------------------ */

  async listAcademicYears(schoolId: string) {
    return this.prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
      include: { terms: { orderBy: { number: 'asc' } }, _count: { select: { classes: true } } },
    });
  }

  async createAcademicYear(user: AuthPrincipal, input: AcademicYearInput) {
    const overlap = await this.prisma.academicYear.findFirst({
      where: { schoolId: user.schoolId, AND: [{ startDate: { lte: new Date(input.endDate) } }, { endDate: { gte: new Date(input.startDate) } }] },
      select: { id: true, name: true },
    });
    if (overlap) throw new BadRequestException(`This period overlaps the existing academic year "${overlap.name}".`);

    const year = await this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({ where: { schoolId: user.schoolId, isCurrent: true }, data: { isCurrent: false } });
      }
      const created = await tx.academicYear.create({
        data: {
          schoolId: user.schoolId,
          name: input.name,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          isCurrent: input.isCurrent,
        },
      });
      if (input.isCurrent) {
        await tx.school.update({ where: { id: user.schoolId }, data: { currentAcademicYearId: created.id, currentTermId: null } });
      }
      return created;
    });

    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'calendar.year.created', entityType: 'AcademicYear', entityId: year.id, after: year });
    return year;
  }

  async updateAcademicYear(user: AuthPrincipal, id: string, input: Partial<AcademicYearInput>) {
    const existing = await this.prisma.academicYear.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Academic year');
    const year = await this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) await tx.academicYear.updateMany({ where: { schoolId: user.schoolId, isCurrent: true }, data: { isCurrent: false } });
      const updated = await tx.academicYear.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
          ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
          ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
        },
      });
      if (input.isCurrent) await tx.school.update({ where: { id: user.schoolId }, data: { currentAcademicYearId: updated.id } });
      return updated;
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'calendar.year.updated', entityType: 'AcademicYear', entityId: id, before: existing, after: year });
    return year;
  }

  async listTerms(schoolId: string, academicYearId?: string) {
    return this.prisma.term.findMany({
      where: { schoolId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: [{ academicYear: { startDate: 'desc' } }, { number: 'asc' }],
      include: { academicYear: { select: { id: true, name: true } }, _count: { select: { assessments: true } } },
    });
  }

  async createTerm(user: AuthPrincipal, input: TermInput) {
    const year = await this.prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: user.schoolId } });
    if (!year) throw new TenantIsolationException('Academic year');
    if (new Date(input.startDate) < year.startDate || new Date(input.endDate) > year.endDate) {
      throw new BadRequestException(`Term dates must fall within the academic year (${year.startDate.toISOString().slice(0, 10)} to ${year.endDate.toISOString().slice(0, 10)}).`);
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) await tx.term.updateMany({ where: { schoolId: user.schoolId, isCurrent: true }, data: { isCurrent: false } });
      const term = await tx.term.create({
        data: {
          schoolId: user.schoolId,
          academicYearId: input.academicYearId,
          number: input.number,
          name: input.name,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          isCurrent: input.isCurrent,
        },
      });
      if (input.isCurrent) {
        await tx.school.update({ where: { id: user.schoolId }, data: { currentTermId: term.id, currentAcademicYearId: input.academicYearId } });
      }
      await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'calendar.term.created', entityType: 'Term', entityId: term.id, after: term });
      return term;
    });
  }

  async updateTerm(user: AuthPrincipal, id: string, input: Partial<TermInput>) {
    const existing = await this.prisma.term.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Term');
    return this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) await tx.term.updateMany({ where: { schoolId: user.schoolId, isCurrent: true }, data: { isCurrent: false } });
      const term = await tx.term.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.number ? { number: input.number } : {}),
          ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
          ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
          ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
        },
      });
      if (input.isCurrent) await tx.school.update({ where: { id: user.schoolId }, data: { currentTermId: term.id, currentAcademicYearId: term.academicYearId } });
      return term;
    });
  }

  async setTermResultsPublication(user: AuthPrincipal, id: string, published: boolean) {
    const term = await this.prisma.term.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!term) throw new TenantIsolationException('Term');
    return this.prisma.term.update({ where: { id }, data: { resultsPublishedAt: published ? new Date() : null } });
  }

  /* ------------------------------- grades ------------------------------- */

  async listGrades(schoolId: string) {
    const grades = await this.prisma.grade.findMany({
      where: { schoolId },
      orderBy: { level: 'asc' },
      include: { _count: { select: { classes: true, learners: true } } },
    });
    return grades.map((g) => ({ id: g.id, level: g.level, name: g.name, order: g.order, classCount: g._count.classes, learnerCount: g._count.learners }));
  }

  /* ------------------------------ school meta --------------------------- */

  /** Everything a client needs to render navigation + branding after sign-in. */
  async bootstrap(user: AuthPrincipal) {
    const [profile, terms, grades, context] = await Promise.all([
      this.getProfile(user.schoolId),
      this.listTerms(user.schoolId),
      this.listGrades(user.schoolId),
      this.contextBadge(user.schoolId),
    ]);
    return { school: profile, terms, grades, context };
  }

  async contextBadge(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { currentAcademicYearId: true, currentTermId: true, workingDays: true, timezone: true, maxPeriodsPerDay: true },
    });
    if (!school) throw new TenantIsolationException('School');
    const [year, term] = await Promise.all([
      school.currentAcademicYearId ? this.prisma.academicYear.findUnique({ where: { id: school.currentAcademicYearId }, select: { id: true, name: true, isLocked: true } }) : null,
      school.currentTermId ? this.prisma.term.findUnique({ where: { id: school.currentTermId }, select: { id: true, name: true, number: true, startDate: true, endDate: true } }) : null,
    ]);
    return {
      academicYear: year,
      term,
      workingDays: school.workingDays,
      timezone: school.timezone,
      maxPeriodsPerDay: school.maxPeriodsPerDay,
      setupComplete: !!year && !!term,
    };
  }
}
