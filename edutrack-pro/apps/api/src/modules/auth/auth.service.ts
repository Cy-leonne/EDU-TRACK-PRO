import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'crypto';
import {
  DEFAULT_ACHIEVEMENT_LEVELS, DEFAULT_ASSESSMENT_CATEGORIES, JUNIOR_SCHOOL_LEVELS, ROLE_PERMISSIONS,
} from '@edutrack/shared-config';
import type { AuthUser } from '@edutrack/shared-types';
import type { firstAdminSetupSchema, loginSchema, parentLinkRequestSchema } from '@edutrack/validation';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

type LoginDto = z.infer<typeof loginSchema>;
type FirstAdminDto = z.infer<typeof firstAdminSetupSchema>;
type ParentLinkDto = z.infer<typeof parentLinkRequestSchema>;

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------- session ------------------------------ */

  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        memberships: { where: { status: 'ACTIVE' }, include: { school: true } },
        teacherProfile: { select: { id: true } },
        parentProfile: { select: { id: true } },
      },
    });

    // Uniform failure message: never reveal whether an account exists.
    const failure = new UnauthorizedException('Incorrect email or password.');
    if (!user || !user.isActive || user.archivedAt) {
      // Still run a dummy hash comparison to keep timing reasonably uniform.
      await this.passwords.verify('$2b$12$0000000000000000000000000000000000000000000000000000', dto.password);
      throw failure;
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Too many failed attempts. Try again later or reset your password.');
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      const failedLoginCount = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: failedLoginCount >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });
      await this.audit.record({
        schoolId: user.memberships[0]?.schoolId ?? null,
        actorUserId: user.id,
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw failure;
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('Your account is not linked to a school. Contact your administrator.');
    }
    if (!membership.school.isActive) {
      throw new UnauthorizedException('Your school account is currently inactive.');
    }

    // Opportunistic upgrade of weak hashes on successful login.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwords.hash(dto.password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
    }

    const role = await this.effectiveSchoolRole(user.id, membership.schoolId, membership.role);
    const issued = await this.tokens.issue({
      userId: user.id,
      schoolId: membership.schoolId,
      membershipId: membership.id,
      role,
      email: user.email,
      fullName: user.fullName,
      clientType: dto.clientType,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    await this.audit.record({
      schoolId: membership.schoolId,
      actorUserId: user.id,
      actorRole: role,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      user: await this.toAuthUser({
        userId: user.id,
        schoolId: membership.schoolId,
        membershipId: membership.id,
        role,
      }),
      ...issued,
    };
  }

  /** Platform sign-in is isolated from school membership selection and only
   * succeeds for an explicitly provisioned, active PlatformAdmin record. */
  async platformLogin(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { platformAdmin: true },
    });
    const failure = new UnauthorizedException('Incorrect email or password.');
    if (!user || !user.isActive || user.archivedAt || !user.platformAdmin?.isActive) {
      await this.passwords.verify('$2b$12$0000000000000000000000000000000000000000000000000000', dto.password);
      throw failure;
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Too many failed attempts. Try again later or reset your password.');
    }
    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      const failedLoginCount = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount, lockedUntil: failedLoginCount >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null },
      });
      await this.audit.record({
        actorUserId: user.id, actorRole: 'SUPERADMIN', action: 'platform.auth.login.failed',
        entityType: 'User', entityId: user.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      });
      throw failure;
    }

    const issued = await this.tokens.issue({
      userId: user.id,
      schoolId: 'platform',
      membershipId: user.platformAdmin.id,
      platformAdminId: user.platformAdmin.id,
      role: 'SUPERADMIN',
      email: user.email,
      fullName: user.fullName,
      clientType: dto.clientType,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit.record({
      actorUserId: user.id, actorRole: 'SUPERADMIN', action: 'platform.auth.login',
      entityType: 'User', entityId: user.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent,
    });
    return { user: await this.toPlatformAuthUser(user.id, user.platformAdmin.id), ...issued };
  }

  /** Rotates the refresh token and returns a fresh access token + user context. */
  async refresh(refreshToken: string, clientType: 'WEB' | 'MOBILE', meta: RequestMeta) {
    const rotated = await this.tokens.rotate(refreshToken, clientType, meta.ipAddress, meta.userAgent);
    const { context, ...issued } = rotated;
    return {
      user: await this.toAuthUser({
        userId: context.userId,
        schoolId: context.schoolId,
        membershipId: context.membershipId,
        role: context.role,
      }),
      ...issued,
    };
  }

  async logout(refreshToken: string | undefined, userId?: string, meta?: RequestMeta): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
    if (userId) {
      await this.audit.record({ actorUserId: userId, action: 'auth.logout', entityType: 'User', entityId: userId, ipAddress: meta?.ipAddress ?? null });
    }
  }

  /** Sign out everywhere: revokes every refresh token the account holds. */
  async logoutAll(userId: string, meta: RequestMeta = {}): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      actorUserId: userId,
      action: 'auth.logout_all',
      entityType: 'User',
      entityId: userId,
      summary: 'Signed out of all devices',
      ipAddress: meta.ipAddress,
    });
  }

  async buildAuthUser(userId: string, schoolId: string, membershipId: string, role: AuthUser['role']): Promise<AuthUser> {
    return this.toAuthUser({ userId, schoolId, membershipId, role });
  }

  private async toAuthUser(ctx: { userId: string; schoolId: string; membershipId: string; role: AuthUser['role'] }): Promise<AuthUser> {
    if (ctx.role === 'SUPERADMIN') return this.toPlatformAuthUser(ctx.userId, ctx.membershipId);
    const [user, school, teacher, parent] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { id: true, email: true, fullName: true, phone: true, mustChangePassword: true } }),
      this.prisma.school.findUnique({ where: { id: ctx.schoolId }, select: { id: true, name: true, timezone: true } }),
      this.prisma.teacherProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } }),
      this.prisma.parentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } }),
    ]);
    if (!user || !school) throw new NotFoundException('Account not found');
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: ctx.role,
      schoolId: school.id,
      schoolName: school.name,
      membershipId: ctx.membershipId,
      permissions: ROLE_PERMISSIONS[ctx.role] ?? [],
      teacherProfileId: teacher?.id ?? null,
      parentProfileId: parent?.id ?? null,
      timezone: school.timezone,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async effectiveSchoolRole(userId: string, schoolId: string, baseRole: AuthUser['role']): Promise<AuthUser['role']> {
    if (baseRole !== 'TEACHER' && baseRole !== 'CLASS_TEACHER') return baseRole;
    const now = new Date();
    const [assignment, legacyClassTeacher] = await Promise.all([
      this.prisma.classTeacherAssignment.findFirst({
        where: {
          schoolId,
          teacher: { userId, isActive: true, archivedAt: null },
          revokedAt: null,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        select: { id: true },
      }),
      this.prisma.class.findFirst({
        where: { schoolId, isActive: true, archivedAt: null, classTeacher: { userId, isActive: true, archivedAt: null } },
        select: { id: true },
      }),
    ]);
    return assignment || legacyClassTeacher ? 'CLASS_TEACHER' : 'TEACHER';
  }

  private async toPlatformAuthUser(userId: string, platformAdminId: string): Promise<AuthUser> {
    const [user, operator] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, phone: true, mustChangePassword: true } }),
      this.prisma.platformAdmin.findFirst({ where: { id: platformAdminId, userId, isActive: true }, select: { id: true } }),
    ]);
    if (!user || !operator) throw new NotFoundException('Platform account not found');
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: 'SUPERADMIN',
      schoolId: 'platform',
      schoolName: 'EduTrack Pro Platform',
      membershipId: operator.id,
      permissions: [],
      timezone: 'Africa/Nairobi',
      mustChangePassword: user.mustChangePassword,
    };
  }

  /* ---------------------------- password flows -------------------------- */

  async changePassword(userId: string, currentPassword: string, newPassword: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found');
    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new BadRequestException('Your current password is incorrect.');
    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException('Choose a password you have not used before.');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    // Every other session is invalidated on password change.
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({ actorUserId: userId, action: 'auth.password.changed', entityType: 'User', entityId: userId, ipAddress: meta.ipAddress });
    return { changed: true };
  }

  /**
   * Always responds with the same message so the endpoint cannot be used to
   * discover which email addresses have accounts.
   */
  async requestPasswordReset(email: string, meta: RequestMeta): Promise<{ message: string }> {
    const generic = { message: 'If an account exists for that email address, a reset link has been sent.' };
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, fullName: true, isActive: true } });
    if (!user || !user.isActive) return generic;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: TokenService.hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        ipAddress: meta.ipAddress ?? null,
      },
    });

    const webBase = this.config.get<string>('corsOrigins')?.[0] ?? 'http://localhost:3000';
    const link = `${webBase}/reset-password?token=${token}`;

    if (this.config.get<string>('email.provider') === 'console' && this.config.get<string>('env') !== 'production') {
      // Development convenience only - never enabled in production.
      this.logger.log(`[dev] Password reset link for ${user.email}: ${link}`);
    } else {
      await this.notifications.notify({
        schoolId: (await this.prisma.schoolMembership.findFirst({ where: { userId: user.id }, select: { schoolId: true } }))?.schoolId ?? '',
        userIds: [user.id],
        type: NotificationType.ACCOUNT,
        title: 'Password reset requested',
        body: 'A password reset was requested for your account. If this was not you, contact your school administrator.',
        email: { to: [user.email], subject: 'Reset your EduTrack Pro password', text: `Use this link within one hour: ${link}` },
      });
    }

    await this.audit.record({ actorUserId: user.id, action: 'auth.password.reset_requested', entityType: 'User', entityId: user.id, ipAddress: meta.ipAddress });
    return generic;
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<{ reset: boolean }> {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: TokenService.hashToken(token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ actorUserId: record.userId, action: 'auth.password.reset', entityType: 'User', entityId: record.userId, ipAddress: meta.ipAddress });
    return { reset: true };
  }

  /* --------------------------- first-run setup --------------------------- */

  setupEnabled(): boolean {
    return !!this.config.get<string>('initialAdminSetupToken');
  }

  /**
   * Creates the very first school + administrator. Requires the one-time token
   * from INITIAL_ADMIN_SETUP_TOKEN, so no publicly reachable endpoint can create
   * an administrator account. The endpoint is disabled entirely when the token
   * is unset.
   */
  async setupFirstAdmin(dto: FirstAdminDto, meta: RequestMeta) {
    const configured = this.config.get<string>('initialAdminSetupToken');
    if (!configured) {
      throw new BadRequestException(
        'First-run setup is disabled. Set INITIAL_ADMIN_SETUP_TOKEN in the server environment (or use `npm run setup:admin`).',
      );
    }
    // Constant-time-ish comparison
    const a = Buffer.from(configured);
    const b = Buffer.from(dto.setupToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await this.audit.record({ action: 'auth.setup.rejected', entityType: 'School', summary: 'Invalid setup token supplied', ipAddress: meta.ipAddress });
      throw new UnauthorizedException('Invalid setup token.');
    }

    // Harden the "first run" semantics: once an installation has a school this
    // endpoint stays closed unless the operator explicitly opened public school
    // registration. A leaked or weak setup token therefore cannot be replayed to
    // mint an administrator on an installation that is already in use.
    const schoolCount = await this.prisma.school.count();
    if (schoolCount > 0 && !this.config.get<boolean>('registration.schoolSelfRegistration')) {
      await this.audit.record({
        action: 'auth.setup.rejected',
        entityType: 'School',
        summary: 'First-run setup attempted on an installation that already has a school',
        ipAddress: meta.ipAddress,
      });
      throw new ConflictException(
        'This installation is already set up. Use the regular sign-in page or an administrator invitation.',
      );
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new BadRequestException('An account with that email already exists.');

    const passwordHash = await this.passwords.hash(dto.password);

    const result = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: dto.school.name,
          code: dto.school.code || null,
          county: dto.school.county || null,
          timezone: dto.school.timezone || 'Africa/Nairobi',
        },
      });
      const user = await tx.user.create({
        data: { email: dto.email, fullName: dto.fullName, phone: dto.phone ?? null, passwordHash },
      });
      const membership = await tx.schoolMembership.create({
        data: { userId: user.id, schoolId: school.id, role: 'ADMIN', title: 'School Administrator' },
      });
      await this.applySchoolDefaults(tx, school.id);
      return { school, user, membership };
    });

    await this.audit.record({
      schoolId: result.school.id,
      actorUserId: result.user.id,
      actorRole: 'ADMIN',
      action: 'school.created',
      entityType: 'School',
      entityId: result.school.id,
      after: { name: result.school.name, admin: result.user.email },
    });

    const issued = await this.tokens.issue({
      userId: result.user.id,
      schoolId: result.school.id,
      membershipId: result.membership.id,
      role: 'ADMIN',
      email: result.user.email,
      fullName: result.user.fullName,
      clientType: 'WEB',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      user: await this.toAuthUser({ userId: result.user.id, schoolId: result.school.id, membershipId: result.membership.id, role: 'ADMIN' }),
      ...issued,
    };
  }

  /** Grades 7-9, assessment categories, achievement bands and the year skeleton. */
  async applySchoolDefaults(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], schoolId: string): Promise<void> {
    await tx.grade.createMany({
      data: JUNIOR_SCHOOL_LEVELS.map((level, index) => ({ schoolId, level, name: `Grade ${level}`, order: index })),
    });
    await tx.assessmentCategory.createMany({
      data: DEFAULT_ASSESSMENT_CATEGORIES.map((category, index) => ({
        schoolId,
        code: category.code,
        name: category.name,
        allowsMarks: category.allowsMarks,
        allowsRubric: category.allowsRubric,
        order: index,
      })),
    });
    await tx.achievementLevel.createMany({
      data: DEFAULT_ACHIEVEMENT_LEVELS.map((level, index) => ({
        schoolId,
        code: level.code,
        label: level.label,
        minPercent: level.minPercent,
        maxPercent: level.maxPercent,
        description: level.description,
        order: index,
      })),
    });
  }

  /* -------------------- parent self-link (verification) ------------------ */

  /**
   * A parent may REQUEST a link to a learner using the learner's assessment
   * number plus the learner's surname. The assessment number is never treated
   * as sufficient on its own: the link stays unverified (and grants no access)
   * until a school administrator confirms it.
   */
  async requestParentLink(userId: string, dto: ParentLinkDto, meta: RequestMeta) {
    const parent = await this.prisma.parentProfile.findFirst({
      where: { userId },
      include: { user: { select: { fullName: true } } },
    });
    if (!parent) throw new BadRequestException('Your account has no parent profile. Contact your school administrator.');

    const learner = await this.prisma.learner.findFirst({
      where: {
        schoolId: parent.schoolId,
        assessmentNumber: dto.learnerAssessmentNumber,
        lastName: { equals: dto.learnerSurname, mode: 'insensitive' },
      },
      select: { id: true, firstName: true, lastName: true, gradeId: true },
    });
    // Deliberately generic: do not confirm whether a learner exists.
    if (!learner) {
      await this.audit.record({
        actorUserId: userId,
        action: 'parent.link.requested.rejected',
        entityType: 'ParentLearnerLink',
        summary: 'Assessment number + surname did not match any learner',
        ipAddress: meta.ipAddress,
      });
      throw new BadRequestException(
        'We could not match those details. Check the assessment number and surname, or ask the school office to link your account.',
      );
    }

    const existing = await this.prisma.parentLearnerLink.findFirst({
      where: { parentProfileId: parent.id, learnerId: learner.id },
    });
    if (existing?.isVerified && !existing.revokedAt) {
      return { status: 'ALREADY_LINKED', message: 'This learner is already linked to your account.' };
    }

    const link = existing
      ? await this.prisma.parentLearnerLink.update({
          where: { id: existing.id },
          data: { revokedAt: null, isVerified: false, relationship: dto.relationship },
        })
      : await this.prisma.parentLearnerLink.create({
          data: {
            schoolId: parent.schoolId,
            parentProfileId: parent.id,
            learnerId: learner.id,
            relationship: dto.relationship,
            isVerified: false,
          },
        });

    const admins = await this.prisma.schoolMembership.findMany({
      where: { schoolId: parent.schoolId, role: 'ADMIN', status: 'ACTIVE' },
      select: { userId: true },
    });
    await this.notifications.notify({
      schoolId: parent.schoolId,
      userIds: admins.map((a) => a.userId),
      type: NotificationType.ACCOUNT,
      title: 'Parent link awaiting verification',
      body: `${parent.user.fullName} requested access to a learner record. Verify the relationship in Parents → Links.`,
      link: '/admin/parents',
      entityType: 'ParentLearnerLink',
      entityId: link.id,
    });

    await this.audit.record({
      schoolId: parent.schoolId,
      actorUserId: userId,
      action: 'parent.link.requested',
      entityType: 'ParentLearnerLink',
      entityId: link.id,
      summary: 'Awaiting administrator verification',
      ipAddress: meta.ipAddress,
    });

    return {
      status: 'PENDING_VERIFICATION',
      message: 'Request received. A school administrator will verify the relationship before access is granted.',
      linkId: link.id,
    };
  }
}

