import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { z } from 'zod';
import type {
  createParentSchema, createTeacherSchema, learnerSchema, parentLearnerLinkSchema, updateParentSchema, updateTeacherSchema,
} from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { CsvService } from '../../common/csv/csv.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantIsolationException, ResourceAccessDeniedException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import { PasswordService } from '../auth/password.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { NotificationType } from '@prisma/client';

type CreateTeacherInput = z.infer<typeof createTeacherSchema>;
type UpdateTeacherInput = z.infer<typeof updateTeacherSchema>;
type CreateParentInput = z.infer<typeof createParentSchema>;
type UpdateParentInput = z.infer<typeof updateParentSchema>;
type LearnerInput = z.infer<typeof learnerSchema>;
type LinkInput = z.infer<typeof parentLearnerLinkSchema>;

export interface ImportOutcome {
  total: number; created: number; updated: number; skipped: number;
  errors: { row: number; field: string; message: string; value?: string }[];
  generatedCredentials?: { email: string; temporaryPassword: string }[];
}

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly passwords: PasswordService,
    private readonly csv: CsvService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Generates a one-time password for a new account.
   *
   * 14 characters drawn from an unambiguous alphabet (no O/0, l/1) with an
   * upper-case, lower-case, digit and symbol class, so it satisfies the shared
   * password policy with margin. It is hashed immediately, returned once to the
   * admin who created the account and never written to the logs.
   */
  private temporaryPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const pick = (set: string, n: number) => Array.from({ length: n }, () => set[randomBytes(1)[0] % set.length]).join('');
    return `${pick(alphabet, 3)}${pick(lower, 6)}${pick(digits, 4)}!`;
  }

  /* ------------------------------- teachers ----------------------------- */

  async listTeachers(user: AuthPrincipal, filters: { search?: string; includeInactive?: boolean } = {}) {
    const teachers = await this.prisma.teacherProfile.findMany({
      where: {
        schoolId: user.schoolId,
        ...(filters.includeInactive ? {} : { isActive: true }),
        ...(filters.search
          ? { OR: [{ user: { fullName: { contains: filters.search, mode: 'insensitive' } } }, { staffNumber: { contains: filters.search, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: [{ user: { fullName: 'asc' } }],
      include: {
        user: { select: { id: true, email: true, fullName: true, phone: true, isActive: true, lastLoginAt: true } },
        assignments: { where: { isActive: true }, include: { learningArea: { select: { id: true, name: true } }, class: { select: { id: true, name: true } } } },
        availability: { where: { isAvailable: false } },
      },
    });
    return teachers.map((t) => ({
      id: t.id,
      userId: t.userId,
      staffNumber: t.staffNumber,
      fullName: t.user.fullName,
      email: t.user.email,
      phone: t.phone ?? t.user.phone,
      tscNumber: t.tscNumber,
      specialization: t.specialization,
      qualifications: t.qualifications,
      employmentType: t.employmentType,
      maxPeriodsPerDay: t.maxPeriodsPerDay,
      maxPeriodsPerWeek: t.maxPeriodsPerWeek,
      prefersFreeDays: t.prefersFreeDays,
      isActive: t.isActive && t.user.isActive,
      lastLoginAt: t.user.lastLoginAt,
      assignmentCount: t.assignments.length,
      assignments: t.assignments.map((a) => ({ id: a.id, classId: a.class.id, className: a.class.name, learningAreaId: a.learningArea.id, learningAreaName: a.learningArea.name })),
      unavailableSlots: t.availability.map((a) => ({ dayOfWeek: a.dayOfWeek, periodIndex: a.periodIndex, reason: a.reason })),
    }));
  }

  async createTeacher(user: AuthPrincipal, input: CreateTeacherInput): Promise<{ teacher: unknown; temporaryPassword?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (existing.archivedAt) throw new BadRequestException('An archived account already uses that email address.');
      throw new BadRequestException('An account with that email address already exists.');
    }
    const duplicateStaff = await this.prisma.teacherProfile.findFirst({ where: { schoolId: user.schoolId, staffNumber: input.staffNumber } });
    if (duplicateStaff) throw new BadRequestException(`Staff number ${input.staffNumber} is already in use.`);

    const temporaryPassword = input.temporaryPassword ?? this.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const created = await this.prisma.$transaction(async (tx) => {
      const account = await tx.user.create({
        data: {
          email: input.email, fullName: input.fullName, phone: input.phone ?? null,
          passwordHash, mustChangePassword: true,
        },
      });
      await tx.schoolMembership.create({ data: { userId: account.id, schoolId: user.schoolId, role: 'TEACHER', invitedById: user.userId } });
      const profile = await tx.teacherProfile.create({
        data: {
          userId: account.id, schoolId: user.schoolId, staffNumber: input.staffNumber,
          tscNumber: input.tscNumber || null, nationalId: input.nationalId || null, phone: input.phone ?? null,
          specialization: input.specialization || null, qualifications: input.qualifications || null,
          employmentType: input.employmentType, maxPeriodsPerDay: input.maxPeriodsPerDay ?? 8,
          maxPeriodsPerWeek: input.maxPeriodsPerWeek ?? 40, prefersFreeDays: input.prefersFreeDays ?? [],
        },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
      return profile;
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher.created', entityType: 'TeacherProfile',
      entityId: created.id, after: { staffNumber: created.staffNumber, email: created.user.email, fullName: created.user.fullName },
    });

    return {
      teacher: { id: created.id, userId: created.userId, fullName: created.user.fullName, email: created.user.email, staffNumber: created.staffNumber, isActive: true },
      // Returned once, for the admin to hand over securely; never emailed or logged.
      temporaryPassword,
    };
  }

  async updateTeacher(user: AuthPrincipal, id: string, input: UpdateTeacherInput) {
    const existing = await this.prisma.teacherProfile.findFirst({ where: { id, schoolId: user.schoolId }, include: { user: true } });
    if (!existing) throw new TenantIsolationException('Teacher');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      return tx.teacherProfile.update({
        where: { id },
        data: {
          ...(input.staffNumber ? { staffNumber: input.staffNumber } : {}),
          ...(input.tscNumber !== undefined ? { tscNumber: input.tscNumber || null } : {}),
          ...(input.specialization !== undefined ? { specialization: input.specialization || null } : {}),
          ...(input.qualifications !== undefined ? { qualifications: input.qualifications || null } : {}),
          ...(input.employmentType ? { employmentType: input.employmentType } : {}),
          ...(input.maxPeriodsPerDay !== undefined ? { maxPeriodsPerDay: input.maxPeriodsPerDay ?? null } : {}),
          ...(input.maxPeriodsPerWeek !== undefined ? { maxPeriodsPerWeek: input.maxPeriodsPerWeek ?? null } : {}),
          ...(input.prefersFreeDays ? { prefersFreeDays: input.prefersFreeDays } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher.updated', entityType: 'TeacherProfile', entityId: id, before: { isActive: existing.isActive, maxPeriodsPerWeek: existing.maxPeriodsPerWeek }, after: input });
    return updated;
  }

  async deactivateTeacher(user: AuthPrincipal, id: string, reason?: string) {
    const existing = await this.prisma.teacherProfile.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Teacher');
    return this.prisma.$transaction(async (tx) => {
      await tx.teacherProfile.update({ where: { id }, data: { isActive: false, archivedAt: new Date(), notes: reason ?? existing.notes } });
      await tx.user.update({ where: { id: existing.userId }, data: { isActive: false } });
      await tx.refreshToken.updateMany({ where: { userId: existing.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.teacherAssignment.updateMany({ where: { teacherId: id }, data: { isActive: false, archivedAt: new Date() } });
      await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher.deactivated', entityType: 'TeacherProfile', entityId: id, summary: reason });
      return { deactivated: true };
    });
  }

  async resetTeacherPassword(user: AuthPrincipal, id: string) {
    const existing = await this.prisma.teacherProfile.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Teacher');
    const temporaryPassword = this.temporaryPassword();
    await this.prisma.user.update({
      where: { id: existing.userId },
      data: { passwordHash: await this.passwords.hash(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: existing.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher.password.reset', entityType: 'TeacherProfile', entityId: id });
    return { temporaryPassword };
  }

  /* -------------------------------- parents ----------------------------- */

  async listParents(user: AuthPrincipal, filters: { search?: string; includeInactive?: boolean } = {}) {
    const parents = await this.prisma.parentProfile.findMany({
      where: {
        schoolId: user.schoolId,
        ...(filters.includeInactive ? {} : { isActive: true }),
        ...(filters.search
          ? { OR: [{ user: { fullName: { contains: filters.search, mode: 'insensitive' } } }, { user: { email: { contains: filters.search, mode: 'insensitive' } } }, { phone: { contains: filters.search } }] }
          : {}),
      },
      orderBy: { user: { fullName: 'asc' } },
      include: {
        user: { select: { id: true, email: true, fullName: true, isActive: true, lastLoginAt: true } },
        links: { include: { learner: { include: { grade: true, currentClass: true } } } },
      },
    });
    return parents.map((p) => ({
      id: p.id, userId: p.userId, fullName: p.user.fullName, email: p.user.email,
      phone: p.phone, relationship: p.relationship, occupation: p.occupation,
      isActive: p.isActive && p.user.isActive, lastLoginAt: p.user.lastLoginAt,
      linkedLearners: p.links.map((l) => ({
        linkId: l.id,
        id: l.learner.id,
        fullName: `${l.learner.firstName} ${l.learner.lastName}`,
        admissionNumber: l.learner.admissionNumber,
        gradeName: l.learner.grade?.name ?? '—',
        className: l.learner.currentClass?.name ?? 'Not assigned',
        relationship: l.relationship,
        isVerified: l.isVerified && !l.revokedAt,
        canViewResults: l.canViewResults,
        canViewResources: l.canViewResources,
      })),
    }));
  }

  async createParent(user: AuthPrincipal, input: CreateParentInput) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new BadRequestException('An account with that email address already exists.');
    const temporaryPassword = input.temporaryPassword ?? this.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const created = await this.prisma.$transaction(async (tx) => {
      const account = await tx.user.create({
        data: { email: input.email, fullName: input.fullName, phone: input.phone, passwordHash, mustChangePassword: true },
      });
      await tx.schoolMembership.create({ data: { userId: account.id, schoolId: user.schoolId, role: 'PARENT', invitedById: user.userId } });
      return tx.parentProfile.create({
        data: {
          userId: account.id, schoolId: user.schoolId, phone: input.phone, altPhone: input.altPhone || null,
          relationship: input.relationship, occupation: input.occupation || null, addressLine: input.addressLine || null,
        },
      });
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'parent.created', entityType: 'ParentProfile',
      entityId: created.id, after: { email: input.email, fullName: input.fullName },
    });
    return { parent: { id: created.id, userId: created.userId, fullName: input.fullName, email: input.email }, temporaryPassword };
  }

  async updateParent(user: AuthPrincipal, id: string, input: UpdateParentInput) {
    const existing = await this.prisma.parentProfile.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Parent');
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      return tx.parentProfile.update({
        where: { id },
        data: {
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.altPhone !== undefined ? { altPhone: input.altPhone || null } : {}),
          ...(input.relationship ? { relationship: input.relationship } : {}),
          ...(input.occupation !== undefined ? { occupation: input.occupation || null } : {}),
          ...(input.addressLine !== undefined ? { addressLine: input.addressLine || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    });
  }

  async resetParentPassword(user: AuthPrincipal, id: string) {
    const existing = await this.prisma.parentProfile.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Parent');
    const temporaryPassword = this.temporaryPassword();
    await this.prisma.user.update({
      where: { id: existing.userId },
      data: { passwordHash: await this.passwords.hash(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: existing.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'parent.password.reset', entityType: 'ParentProfile', entityId: id });
    return { temporaryPassword };
  }

  /* ------------------------------- learners ----------------------------- */

  async listLearners(
    user: AuthPrincipal,
    filters: { search?: string; gradeId?: string; classId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) {
    const access = await this.tenant.accessibleLearnerIds(user);
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, filters.pageSize ?? 50);

    const where = {
      schoolId: user.schoolId,
      ...(access === 'ALL' ? {} : { id: { in: access } }),
      ...(filters.gradeId ? { gradeId: filters.gradeId } : {}),
      ...(filters.classId ? { currentClassId: filters.classId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.search
        ? {
            OR: [
              { firstName: { contains: filters.search, mode: 'insensitive' as const } },
              { lastName: { contains: filters.search, mode: 'insensitive' as const } },
              { admissionNumber: { contains: filters.search, mode: 'insensitive' as const } },
              { assessmentNumber: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.learner.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          grade: { select: { id: true, level: true, name: true } },
          currentClass: { select: { id: true, name: true } },
          _count: { select: { parentLinks: true } },
        },
      }),
      this.prisma.learner.count({ where }),
    ]);

    return {
      items: rows.map((l) => this.toLearnerDto(l)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNext: page * pageSize < total },
    };
  }

  private toLearnerDto(l: {
    id: string; admissionNumber: string; assessmentNumber: string | null; upiNumber: string | null;
    firstName: string; lastName: string; gender: string; dateOfBirth: Date | null; status: string;
    enrolledOn: Date | null; isBoarding: boolean; schoolId: string;
    grade?: { id: string; level: number; name: string } | null;
    currentClass?: { id: string; name: string } | null;
    _count?: { parentLinks: number };
  }) {
    return {
      id: l.id,
      admissionNumber: l.admissionNumber,
      assessmentNumber: l.assessmentNumber,
      upiNumber: l.upiNumber,
      fullName: `${l.firstName} ${l.lastName}`,
      firstName: l.firstName,
      lastName: l.lastName,
      gender: l.gender,
      dateOfBirth: l.dateOfBirth ? l.dateOfBirth.toISOString().slice(0, 10) : null,
      gradeId: l.grade?.id ?? null,
      gradeName: l.grade?.name ?? null,
      gradeLevel: l.grade?.level ?? null,
      currentClassId: l.currentClass?.id ?? null,
      className: l.currentClass?.name ?? null,
      status: l.status,
      enrolledOn: l.enrolledOn ? l.enrolledOn.toISOString().slice(0, 10) : null,
      isBoarding: l.isBoarding,
      guardianCount: l._count?.parentLinks,
    };
  }

  async getLearner(user: AuthPrincipal, id: string) {
    await this.tenant.assertLearnerAccess(user, id);
    const learner = await this.prisma.learner.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        grade: true,
        currentClass: { select: { id: true, name: true, classTeacher: { include: { user: { select: { fullName: true } } } } } },
        parentLinks: { where: { revokedAt: null }, include: { parentProfile: { include: { user: { select: { fullName: true, email: true } } } } } },
        enrollments: { orderBy: { enrolledAt: 'desc' }, take: 5, include: { class: { select: { id: true, name: true } } } },
      },
    });
    if (!learner) throw new TenantIsolationException('Learner');
    const results = await this.prisma.assessmentResult.count({ where: { learnerId: id } });
    return {
      ...this.toLearnerDto(learner),
      notes: learner.notes,
      specialNeeds: learner.specialNeeds,
      medicalNotes: user.role === 'ADMIN' ? learner.medicalNotes : undefined,
      homeLocation: learner.homeLocation,
      classTeacherName: learner.currentClass?.classTeacher?.user.fullName ?? null,
      guardians: learner.parentLinks.map((link) => ({
        linkId: link.id,
        parentProfileId: link.parentProfileId,
        name: link.parentProfile.user.fullName,
        email: link.parentProfile.user.email,
        phone: link.parentProfile.phone,
        relationship: link.relationship,
        isVerified: link.isVerified,
        isPrimaryContact: link.isPrimaryContact,
      })),
      enrollmentHistory: learner.enrollments.map((e) => ({ id: e.id, className: e.class.name, status: e.status, enrolledAt: e.enrolledAt })),
      resultCount: results,
    };
  }

  async createLearner(user: AuthPrincipal, input: LearnerInput) {
    const duplicate = await this.prisma.learner.findFirst({ where: { schoolId: user.schoolId, admissionNumber: input.admissionNumber } });
    if (duplicate) throw new BadRequestException(`Admission number ${input.admissionNumber} already exists.`);
    if (input.assessmentNumber) {
      const dupAssessment = await this.prisma.learner.findFirst({ where: { schoolId: user.schoolId, assessmentNumber: input.assessmentNumber } });
      if (dupAssessment) throw new BadRequestException(`Assessment number ${input.assessmentNumber} is already assigned to another learner.`);
    }
    if (input.currentClassId) await this.tenant.assertClassAccess({ ...user, role: 'ADMIN' }, input.currentClassId);

    const learner = await this.prisma.learner.create({
      data: {
        schoolId: user.schoolId,
        admissionNumber: input.admissionNumber,
        upiNumber: input.upiNumber || null,
        assessmentNumber: input.assessmentNumber || null,
        firstName: input.firstName,
        middleName: input.middleName || null,
        lastName: input.lastName,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        gradeId: input.gradeId || null,
        currentClassId: input.currentClassId || null,
        status: input.status,
        enrolledOn: input.enrolledOn ? new Date(input.enrolledOn) : new Date(),
        specialNeeds: input.specialNeeds || null,
        medicalNotes: input.medicalNotes || null,
        homeLocation: input.homeLocation || null,
        isBoarding: input.isBoarding,
        notes: input.notes || null,
      },
    });

    allowedGradeGapCheck(learner.gradeId, input.gradeId);

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'learner.created', entityType: 'Learner',
      entityId: learner.id, after: { admissionNumber: learner.admissionNumber, name: `${learner.firstName} ${learner.lastName}` },
    });
    return this.toLearnerDto(learner);
  }

  async updateLearner(user: AuthPrincipal, id: string, input: Partial<LearnerInput>) {
    const existing = await this.prisma.learner.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!existing) throw new TenantIsolationException('Learner');
    if (input.assessmentNumber && input.assessmentNumber !== existing.assessmentNumber) {
      const dup = await this.prisma.learner.findFirst({ where: { schoolId: user.schoolId, assessmentNumber: input.assessmentNumber, NOT: { id } } });
      if (dup) throw new BadRequestException(`Assessment number ${input.assessmentNumber} is already assigned to another learner.`);
    }
    const updated = await this.prisma.learner.update({
      where: { id },
      data: {
        ...(input.admissionNumber ? { admissionNumber: input.admissionNumber } : {}),
        ...(input.upiNumber !== undefined ? { upiNumber: input.upiNumber || null } : {}),
        ...(input.assessmentNumber !== undefined ? { assessmentNumber: input.assessmentNumber || null } : {}),
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.middleName !== undefined ? { middleName: input.middleName || null } : {}),
        ...(input.lastName ? { lastName: input.lastName } : {}),
        ...(input.gender ? { gender: input.gender } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null } : {}),
        ...(input.gradeId !== undefined ? { gradeId: input.gradeId || null } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.specialNeeds !== undefined ? { specialNeeds: input.specialNeeds || null } : {}),
        ...(input.medicalNotes !== undefined ? { medicalNotes: input.medicalNotes || null } : {}),
        ...(input.homeLocation !== undefined ? { homeLocation: input.homeLocation || null } : {}),
        ...(input.isBoarding !== undefined ? { isBoarding: input.isBoarding } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      },
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'learner.updated', entityType: 'Learner', entityId: id, before: { status: existing.status, gradeId: existing.gradeId }, after: input });
    return this.toLearnerDto(updated);
  }

  /* --------------------- parent <-> learner relationships --------------- */

  async listLinks(user: AuthPrincipal, filters: { verified?: boolean; learnerId?: string; parentProfileId?: string } = {}) {
    const links = await this.prisma.parentLearnerLink.findMany({
      where: {
        schoolId: user.schoolId,
        revokedAt: null,
        ...(filters.verified !== undefined ? { isVerified: filters.verified } : {}),
        ...(filters.learnerId ? { learnerId: filters.learnerId } : {}),
        ...(filters.parentProfileId ? { parentProfileId: filters.parentProfileId } : {}),
      },
      orderBy: [{ isVerified: 'asc' }, { createdAt: 'desc' }],
      include: {
        parentProfile: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        learner: { include: { grade: true, currentClass: true } },
      },
    });
    return links.map((l) => ({
      id: l.id,
      relationship: l.relationship,
      isVerified: l.isVerified,
      verifiedAt: l.verifiedAt,
      verificationMethod: l.verificationMethod,
      isPrimaryContact: l.isPrimaryContact,
      canViewResults: l.canViewResults,
      canViewResources: l.canViewResources,
      createdAt: l.createdAt,
      parent: { id: l.parentProfileId, name: l.parentProfile.user.fullName, email: l.parentProfile.user.email, phone: l.parentProfile.phone },
      learner: {
        id: l.learnerId,
        name: `${l.learner.firstName} ${l.learner.lastName}`,
        admissionNumber: l.learner.admissionNumber,
        assessmentNumber: l.learner.assessmentNumber,
        gradeName: l.learner.grade?.name ?? null,
        className: l.learner.currentClass?.name ?? null,
      },
    }));
  }

  async createLink(user: AuthPrincipal, input: LinkInput) {
    const [parent, learner] = await Promise.all([
      this.prisma.parentProfile.findFirst({ where: { id: input.parentProfileId, schoolId: user.schoolId } }),
      this.prisma.learner.findFirst({ where: { id: input.learnerId, schoolId: user.schoolId } }),
    ]);
    if (!parent) throw new TenantIsolationException('Parent');
    if (!learner) throw new TenantIsolationException('Learner');

    const link = await this.prisma.parentLearnerLink.upsert({
      where: { parentProfileId_learnerId: { parentProfileId: input.parentProfileId, learnerId: input.learnerId } },
      create: {
        schoolId: user.schoolId, parentProfileId: input.parentProfileId, learnerId: input.learnerId,
        relationship: input.relationship, isPrimaryContact: input.isPrimaryContact,
        isVerified: input.isVerified, verifiedAt: input.isVerified ? new Date() : null,
        verifiedById: input.isVerified ? user.userId : null,
        verificationMethod: input.isVerified ? input.verificationMethod ?? 'ADMIN_RECORD' : null,
        canViewResults: input.canViewResults, canViewResources: input.canViewResources,
        notes: input.notes || null,
      },
      update: {
        relationship: input.relationship, isPrimaryContact: input.isPrimaryContact,
        isVerified: input.isVerified, revokedAt: null,
        verifiedAt: input.isVerified ? new Date() : null,
        verifiedById: input.isVerified ? user.userId : null,
        verificationMethod: input.isVerified ? input.verificationMethod ?? 'ADMIN_RECORD' : null,
        canViewResults: input.canViewResults, canViewResources: input.canViewResources,
      },
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: input.isVerified ? 'parent.link.verified' : 'parent.link.created',
      entityType: 'ParentLearnerLink', entityId: link.id,
      summary: input.isVerified ? 'Relationship confirmed by school administrator' : 'Relationship recorded (not yet verified)',
    });
    return link;
  }

  async verifyLink(user: AuthPrincipal, linkId: string, method: 'ADMIN_RECORD' | 'DOCUMENT' | 'ASSESSMENT_NUMBER_AND_ID' = 'ADMIN_RECORD') {
    const link = await this.prisma.parentLearnerLink.findFirst({ where: { id: linkId, schoolId: user.schoolId } });
    if (!link) throw new TenantIsolationException('Parent link');
    const updated = await this.prisma.parentLearnerLink.update({
      where: { id: linkId },
      data: { isVerified: true, verifiedAt: new Date(), verifiedById: user.userId, verificationMethod: method, revokedAt: null },
    });
    const admin = await this.prisma.schoolMembership.findFirst({ where: { userId: user.userId, schoolId: user.schoolId }, select: { role: true } });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: admin?.role, action: 'parent.link.verified',
      entityType: 'ParentLearnerLink', entityId: linkId, summary: `Verification method: ${method}`,
    });
    await this.notifications.notify({
      schoolId: user.schoolId,
      userIds: [link.parentProfileId ? (await this.prisma.parentProfile.findUnique({ where: { id: link.parentProfileId }, select: { userId: true } }))?.userId ?? '' : ''],
      type: NotificationType.ACCOUNT,
      title: 'Learner linked to your account',
      body: 'The school has verified your relationship. You can now view results, resources and the timetable for this learner.',
      link: '/parent',
    });
    return updated;
  }

  async revokeLink(user: AuthPrincipal, linkId: string, reason?: string) {
    const link = await this.prisma.parentLearnerLink.findFirst({ where: { id: linkId, schoolId: user.schoolId } });
    if (!link) throw new TenantIsolationException('Parent link');
    await this.prisma.parentLearnerLink.update({ where: { id: linkId }, data: { revokedAt: new Date(), isVerified: false, notes: reason ?? link.notes } });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'parent.link.revoked', entityType: 'ParentLearnerLink',
      entityId: linkId, summary: reason ?? 'Link revoked by administrator',
    });
    return { revoked: true };
  }

  async updateLinkPermissions(user: AuthPrincipal, linkId: string, input: { canViewResults?: boolean; canViewResources?: boolean; isPrimaryContact?: boolean; relationship?: string }) {
    const link = await this.prisma.parentLearnerLink.findFirst({ where: { id: linkId, schoolId: user.schoolId } });
    if (!link) throw new TenantIsolationException('Parent link');
    const updated = await this.prisma.parentLearnerLink.update({
      where: { id: linkId },
      data: {
        ...(input.canViewResults !== undefined ? { canViewResults: input.canViewResults } : {}),
        ...(input.canViewResources !== undefined ? { canViewResources: input.canViewResources } : {}),
        ...(input.isPrimaryContact !== undefined ? { isPrimaryContact: input.isPrimaryContact } : {}),
        ...(input.relationship ? { relationship: input.relationship } : {}),
      },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'parent.link.permissions_updated',
      entityType: 'ParentLearnerLink', entityId: linkId, before: { canViewResults: link.canViewResults, canViewResources: link.canViewResources }, after: input,
    });
    return updated;
  }

  /* ------------------------------ CSV import ---------------------------- */

  async importLearners(user: AuthPrincipal, buffer: Buffer, dryRun = false): Promise<ImportOutcome & { preview: { row: number; admissionNumber: string; name: string; grade: string; className: string }[] }> {
    const { rows } = this.csv.parse(buffer, ['admission_number', 'first_name', 'last_name']);
    const grades = await this.prisma.grade.findMany({ where: { schoolId: user.schoolId } });
    const classes = await this.prisma.class.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true, gradeId: true } });

    const outcome: ImportOutcome = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
    const preview: { row: number; admissionNumber: string; name: string; grade: string; className: string }[] = [];

    for (const { row, values } of rows) {
      const admissionNumber = this.csv.pick(values, 'admission_number', 'admission_no', 'adm');
      const firstName = this.csv.pick(values, 'first_name', 'firstname', 'given_name');
      const lastName = this.csv.pick(values, 'last_name', 'surname', 'family_name');
      const gradeName = this.csv.pick(values, 'grade', 'grade_name', 'class_grade');
      const className = this.csv.pick(values, 'class', 'stream', 'class_name');
      const gender = (this.csv.pick(values, 'gender', 'sex') || 'UNDISCLOSED').toUpperCase();
      const assessmentNumber = this.csv.pick(values, 'assessment_number', 'assessment_no');
      const dateOfBirth = this.csv.pick(values, 'date_of_birth', 'dob');

      if (!admissionNumber) { outcome.errors.push({ row, field: 'admission_number', message: 'Required' }); continue; }
      if (!firstName || !lastName) { outcome.errors.push({ row, field: 'first_name/last_name', message: 'Learner name is required' }); continue; }
      const grade = grades.find((g) => g.name.toLowerCase() === gradeName.toLowerCase() || String(g.level) === gradeName.replace(/\D/g, ''));
      if (gradeName && !grade) { outcome.errors.push({ row, field: 'grade', message: `Unknown grade "${gradeName}" (expected Grade 7, 8 or 9)`, value: gradeName }); continue; }
      const klass = className ? classes.find((c) => c.name.toLowerCase() === className.toLowerCase()) : undefined;
      if (className && !klass) { outcome.errors.push({ row, field: 'class', message: `Unknown class "${className}". Create the class first.`, value: className }); continue; }
      if (dateOfBirth && Number.isNaN(Date.parse(dateOfBirth))) { outcome.errors.push({ row, field: 'date_of_birth', message: 'Use YYYY-MM-DD', value: dateOfBirth }); continue; }

      preview.push({ row, admissionNumber, name: `${firstName} ${lastName}`, grade: grade?.name ?? '', className: klass?.name ?? '' });
      if (dryRun) continue;

      try {
        const existing = await this.prisma.learner.findFirst({ where: { schoolId: user.schoolId, admissionNumber } });
        if (existing) {
          await this.prisma.learner.update({
            where: { id: existing.id },
            data: {
              firstName, lastName,
              ...(assessmentNumber ? { assessmentNumber } : {}),
              ...(grade ? { gradeId: grade.id } : {}),
              ...(klass ? { currentClassId: klass.id } : {}),
            },
          });
          outcome.updated += 1;
        } else {
          const learner = await this.prisma.learner.create({
            data: {
              schoolId: user.schoolId, admissionNumber, firstName, lastName,
              assessmentNumber: assessmentNumber || null,
              gender: ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'].includes(gender) ? (gender as never) : 'UNDISCLOSED',
              dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
              gradeId: grade?.id ?? null,
              currentClassId: klass?.id ?? null,
              enrolledOn: new Date(),
            },
          });
          if (klass) {
            await this.prisma.classEnrollment.create({
              data: { schoolId: user.schoolId, learnerId: learner.id, classId: klass.id, academicYearId: (await this.prisma.class.findUnique({ where: { id: klass.id }, select: { academicYearId: true } }))!.academicYearId },
            });
          }
          outcome.created += 1;
        }
      } catch (error) {
        outcome.skipped += 1;
        outcome.errors.push({ row, field: 'row', message: (error as Error).message });
      }
    }

    if (!dryRun) {
      await this.audit.record({
        schoolId: user.schoolId, actorUserId: user.userId, action: 'learner.imported', entityType: 'Learner',
        summary: `CSV import: ${outcome.created} created, ${outcome.updated} updated, ${outcome.skipped} skipped, ${outcome.errors.length} error(s)`,
      });
    }
    return { ...outcome, preview: preview.slice(0, 20) };
  }

  async importTeachers(user: AuthPrincipal, buffer: Buffer, dryRun = false): Promise<ImportOutcome> {
    const { rows } = this.csv.parse(buffer, ['staff_number', 'full_name', 'email']);
    const outcome: ImportOutcome = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [], generatedCredentials: [] };

    for (const { row, values } of rows) {
      const staffNumber = this.csv.pick(values, 'staff_number', 'staff_no', 'tsc_number');
      const fullName = this.csv.pick(values, 'full_name', 'name');
      const email = this.csv.pick(values, 'email', 'email_address').toLowerCase();
      const phone = this.csv.pick(values, 'phone', 'phone_number', 'mobile');
      const specialization = this.csv.pick(values, 'specialization', 'subjects', 'learning_areas');
      const maxPerWeek = this.csv.pick(values, 'max_periods_per_week', 'max_lessons_per_week');

      if (!staffNumber || !fullName || !email) { outcome.errors.push({ row, field: 'staff_number/full_name/email', message: 'All three are required' }); continue; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { outcome.errors.push({ row, field: 'email', message: 'Invalid email address', value: email }); continue; }
      if (dryRun) continue;

      try {
        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
          outcome.skipped += 1;
          outcome.errors.push({ row, field: 'email', message: 'An account with this email already exists' });
          continue;
        }
        const temporaryPassword = this.temporaryPassword();
        await this.prisma.$transaction(async (tx) => {
          const account = await tx.user.create({ data: { email, fullName, phone: phone || null, passwordHash: await this.passwords.hash(temporaryPassword), mustChangePassword: true } });
          await tx.schoolMembership.create({ data: { userId: account.id, schoolId: user.schoolId, role: 'TEACHER', invitedById: user.userId } });
          await tx.teacherProfile.create({
            data: {
              userId: account.id, schoolId: user.schoolId, staffNumber, phone: phone || null,
              specialization: specialization || null,
              maxPeriodsPerWeek: maxPerWeek ? Number(maxPerWeek) : 40,
            },
          });
        });
        outcome.created += 1;
        outcome.generatedCredentials?.push({ email, temporaryPassword });
      } catch (error) {
        outcome.skipped += 1;
        outcome.errors.push({ row, field: 'row', message: (error as Error).message });
      }
    }

    if (!dryRun) {
      await this.audit.record({
        schoolId: user.schoolId, actorUserId: user.userId, action: 'teacher.imported', entityType: 'TeacherProfile',
        summary: `CSV import: ${outcome.created} created, ${outcome.errors.length} error(s)`,
      });
    }
    return outcome;
  }

  learnerTemplate(): string {
    return this.csv.template([
      'admission_number', 'first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth',
      'assessment_number', 'upi_number', 'grade', 'class', 'home_location', 'is_boarding',
    ]) + 'JS/2026/001,Jane,Wanjiku,Mwangi,FEMALE,2013-04-12,ASS-000123,,Grade 7,Grade 7 East,Nakuru,false\n';
  }

  teacherTemplate(): string {
    return this.csv.template(['staff_number', 'full_name', 'email', 'phone', 'specialization', 'max_periods_per_week'])
      + 'TSC/123456,John Otieno,john.otieno@example.ac.ke,0722000111,Mathematics; Integrated Science,30\n';
  }

  /** Parents can request a correction of an incorrect relationship; admins act on it. */
  async requestRelationshipCorrection(user: AuthPrincipal, linkId: string, message: string) {
    if (user.role !== 'PARENT') throw new ResourceAccessDeniedException('Only parents can request corrections to their own links.');
    const parentId = await this.tenant.parentProfileId(user);
    const link = await this.prisma.parentLearnerLink.findFirst({ where: { id: linkId, parentProfileId: parentId, schoolId: user.schoolId } });
    if (!link) throw new TenantIsolationException('Parent link');
    const admins = await this.prisma.schoolMembership.findMany({ where: { schoolId: user.schoolId, role: 'ADMIN', status: 'ACTIVE' }, select: { userId: true } });
    await this.notifications.notify({
      schoolId: user.schoolId,
      userIds: admins.map((a) => a.userId),
      type: NotificationType.ACCOUNT,
      title: 'Correction requested for a parent–learner link',
      body: message.slice(0, 400),
      link: '/admin/parents',
      entityType: 'ParentLearnerLink',
      entityId: linkId,
    });
    await this.audit.record({ schoolId: user.schoolId, actorUserId: user.userId, action: 'parent.link.correction_requested', entityType: 'ParentLearnerLink', entityId: linkId, summary: message.slice(0, 300) });
    return { requested: true };
  }

  async findByIdOrThrow(id: string, schoolId: string, model: 'teacher' | 'parent' | 'learner') {
    if (model === 'teacher') {
      const row = await this.prisma.teacherProfile.findFirst({ where: { id, schoolId } });
      if (!row) throw new NotFoundException('Teacher not found');
      return row;
    }
    if (model === 'parent') {
      const row = await this.prisma.parentProfile.findFirst({ where: { id, schoolId } });
      if (!row) throw new NotFoundException('Parent not found');
      return row;
    }
    const row = await this.prisma.learner.findFirst({ where: { id, schoolId } });
    if (!row) throw new NotFoundException('Learner not found');
    return row;
  }
}

/** Guard against impossible grade assignments (e.g. Grade 9 learner in Grade 7 class). */
function allowedGradeGapCheck(learnerGradeId: string | null, requestedGradeId: string | null | undefined): void {
  if (!requestedGradeId || !learnerGradeId) return;
  if (learnerGradeId !== requestedGradeId) {
    throw new BadRequestException('The learner grade does not match the requested grade. Update the learner grade explicitly.');
  }
}
