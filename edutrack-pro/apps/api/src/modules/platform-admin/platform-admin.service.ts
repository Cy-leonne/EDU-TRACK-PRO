import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SchoolStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { DEFAULT_ACHIEVEMENT_LEVELS, DEFAULT_ASSESSMENT_CATEGORIES, JUNIOR_SCHOOL_LEVELS } from '@edutrack/shared-config';
import type { z } from 'zod';
import type { platformSchoolCreateSchema, platformSchoolUpdateSchema, schoolStatusChangeSchema } from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { TokenService } from '../auth/token.service';

type CreateSchoolInput = z.infer<typeof platformSchoolCreateSchema>;
type UpdateSchoolInput = z.infer<typeof platformSchoolUpdateSchema>;
type StatusInput = z.infer<typeof schoolStatusChangeSchema>;

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async dashboard() {
    const [total, active, suspended, archived, recentSchools] = await Promise.all([
      this.prisma.school.count(),
      this.prisma.school.count({ where: { status: 'ACTIVE', isActive: true, archivedAt: null } }),
      this.prisma.school.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.school.count({ where: { status: 'ARCHIVED' } }),
      this.prisma.school.findMany({
        orderBy: { createdAt: 'desc' }, take: 8,
        select: { publicId: true, name: true, code: true, county: true, status: true, createdAt: true, _count: { select: { learners: true, memberships: true } } },
      }),
    ]);
    return { counts: { total, active, suspended, archived }, recentSchools };
  }

  async listSchools(filters: { status?: SchoolStatus; search?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const where: Prisma.SchoolWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { code: { contains: filters.search, mode: 'insensitive' } },
          { county: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { publicId: { contains: filters.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { name: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: {
          publicId: true, name: true, code: true, addressLine: true, county: true, phone: true, email: true,
          website: true, timezone: true, status: true, createdAt: true, updatedAt: true,
          _count: { select: { memberships: true, learners: true, teachers: true, classes: true } },
        },
      }),
      this.prisma.school.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async getSchool(publicId: string) {
    const school = await this.prisma.school.findUnique({
      where: { publicId },
      include: {
        _count: { select: { memberships: true, learners: true, teachers: true, parents: true, classes: true, assessments: true } },
        memberships: {
          where: { role: 'ADMIN', status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' }, take: 10,
          include: { user: { select: { id: true, fullName: true, email: true, lastLoginAt: true } } },
        },
        academicYears: { orderBy: { startDate: 'desc' }, take: 4, select: { id: true, name: true, isCurrent: true, startDate: true, endDate: true } },
      },
    });
    if (!school) throw new NotFoundException('School not found.');
    return {
      school: {
        id: school.id, publicId: school.publicId, name: school.name, code: school.code, status: school.status,
        addressLine: school.addressLine, county: school.county, phone: school.phone, email: school.email,
        website: school.website, motto: school.motto, timezone: school.timezone,
        portalName: school.portalName, primaryColor: school.primaryColor, accentColor: school.accentColor,
        logoFileId: school.logoFileId, createdAt: school.createdAt, updatedAt: school.updatedAt,
        archivedAt: school.archivedAt, counts: school._count,
        administrators: school.memberships.map((membership) => ({ ...membership.user, membershipId: membership.id })),
        academicYears: school.academicYears,
      },
    };
  }

  /** Creates an isolated school tenant and a token-bound initial-admin invite. */
  async createSchool(actor: AuthPrincipal, input: CreateSchoolInput, meta: { ipAddress?: string | null; userAgent?: string | null }) {
    const code = input.school.code?.trim() || null;
    if (code && await this.prisma.school.findUnique({ where: { code }, select: { id: true } })) {
      throw new ConflictException('That school code is already in use.');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const webBaseUrl = this.config.get<string>('publicWebUrl') || this.config.get<string[]>('corsOrigins')?.[0] || 'http://localhost:3000';

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const school = await tx.school.create({
          data: {
            name: input.school.name,
            code,
            addressLine: input.school.addressLine || null,
            county: input.school.county || null,
            phone: input.school.phone || null,
            email: input.school.email || null,
            website: input.school.website || null,
            motto: input.school.motto || null,
            timezone: input.school.timezone,
            status: 'ACTIVE',
            isActive: true,
          },
        });
        await this.createSchoolDefaults(tx, school.id);
        const invitation = await tx.accountInvitation.create({
          data: {
            schoolId: school.id,
            email: input.admin.email,
            fullName: input.admin.fullName,
            role: 'ADMIN',
            invitedById: actor.userId,
            tokenHash: TokenService.hashToken(token),
            expiresAt,
            lastSentAt: new Date(),
          },
        });
        return { school, invitation };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      const invitationUrl = `${webBaseUrl}/activate?token=${token}`;
      await this.audit.record({
        schoolId: result.school.id, actorUserId: actor.userId, actorRole: 'SUPERADMIN',
        action: 'platform.school.created', entityType: 'School', entityId: result.school.id,
        summary: `School tenant ${result.school.name} provisioned`,
        after: { publicId: result.school.publicId, name: result.school.name, code: result.school.code, initialAdminEmail: input.admin.email, invitationId: result.invitation.id },
        ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      });
      return {
        school: { publicId: result.school.publicId, name: result.school.name, code: result.school.code, status: result.school.status, createdAt: result.school.createdAt },
        initialAdminInvitation: {
          email: result.invitation.email,
          expiresAt: result.invitation.expiresAt,
          invitationUrl,
          note: 'This one-time invitation link is shown only now. Share it through your approved secure channel.',
        },
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A school with one of those unique identifiers already exists.');
      throw error;
    }
  }

  async updateSchool(actor: AuthPrincipal, publicId: string, input: UpdateSchoolInput, meta: { ipAddress?: string | null; userAgent?: string | null }) {
    const before = await this.prisma.school.findUnique({ where: { publicId } });
    if (!before) throw new NotFoundException('School not found.');
    const data: Prisma.SchoolUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.code !== undefined) data.code = input.code || null;
    if (input.addressLine !== undefined) data.addressLine = input.addressLine || null;
    if (input.county !== undefined) data.county = input.county || null;
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.email !== undefined) data.email = input.email || null;
    if (input.website !== undefined) data.website = input.website || null;
    if (input.motto !== undefined) data.motto = input.motto || null;
    if (input.timezone !== undefined) data.timezone = input.timezone;
    const after = await this.prisma.school.update({ where: { id: before.id }, data });
    await this.audit.record({
      schoolId: after.id, actorUserId: actor.userId, actorRole: 'SUPERADMIN',
      action: 'platform.school.updated', entityType: 'School', entityId: after.id,
      before: { name: before.name, code: before.code, county: before.county, email: before.email, phone: before.phone, timezone: before.timezone },
      after: { name: after.name, code: after.code, county: after.county, email: after.email, phone: after.phone, timezone: after.timezone },
      ipAddress: meta.ipAddress, userAgent: meta.userAgent,
    });
    return { publicId: after.publicId, name: after.name, code: after.code, status: after.status, updatedAt: after.updatedAt };
  }

  async changeStatus(actor: AuthPrincipal, publicId: string, input: StatusInput, meta: { ipAddress?: string | null; userAgent?: string | null }) {
    const before = await this.prisma.school.findUnique({ where: { publicId } });
    if (!before) throw new NotFoundException('School not found.');
    const status = input.status as SchoolStatus;
    const now = new Date();
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.school.update({
        where: { id: before.id },
        data: {
          status,
          isActive: status === 'ACTIVE',
          archivedAt: status === 'ARCHIVED' ? (before.archivedAt ?? now) : null,
        },
      });
      if (status !== 'ACTIVE') {
        const memberships = await tx.schoolMembership.findMany({ where: { schoolId: before.id }, select: { id: true } });
        const ids = memberships.map((membership) => membership.id);
        if (ids.length) {
          await tx.refreshToken.updateMany({ where: { schoolMembershipId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
        }
      }
      return updated;
    });
    await this.audit.record({
      schoolId: after.id, actorUserId: actor.userId, actorRole: 'SUPERADMIN',
      action: 'platform.school.status_changed', entityType: 'School', entityId: after.id,
      summary: input.reason,
      before: { status: before.status, isActive: before.isActive, archivedAt: before.archivedAt },
      after: { status: after.status, isActive: after.isActive, archivedAt: after.archivedAt },
      ipAddress: meta.ipAddress, userAgent: meta.userAgent,
    });
    return { publicId: after.publicId, name: after.name, status: after.status, updatedAt: after.updatedAt };
  }

  private async createSchoolDefaults(tx: Prisma.TransactionClient, schoolId: string) {
    await tx.grade.createMany({ data: JUNIOR_SCHOOL_LEVELS.map((level, index) => ({ schoolId, level, name: `Grade ${level}`, order: index })) });
    await tx.assessmentCategory.createMany({
      data: DEFAULT_ASSESSMENT_CATEGORIES.map((category, index) => ({ schoolId, code: category.code, name: category.name, allowsMarks: category.allowsMarks, allowsRubric: category.allowsRubric, order: index })),
    });
    await tx.achievementLevel.createMany({
      data: DEFAULT_ACHIEVEMENT_LEVELS.map((level, index) => ({ schoolId, code: level.code, label: level.label, minPercent: level.minPercent, maxPercent: level.maxPercent, description: level.description, order: index })),
    });
  }
}
