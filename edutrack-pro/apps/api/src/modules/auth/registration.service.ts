import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Role } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'crypto';
import { JUNIOR_SCHOOL_LEVELS, DEFAULT_ASSESSMENT_CATEGORIES, DEFAULT_ACHIEVEMENT_LEVELS, ROLE_LABELS } from '@edutrack/shared-config';
import type {
  AcceptInvitationInput,
  InvitationCreateInput,
  ParentRegistrationInput,
  SchoolRegistrationInput,
} from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface Principal {
  userId: string;
  schoolId: string;
  membershipId: string;
  role: 'ADMIN' | 'TEACHER' | 'PARENT';
  fullName?: string;
  email?: string;
}

const INVITATION_TTL_DAYS = 7;

/**
 * Registration, invitation and account-lifecycle service.
 *
 * Onboarding rules (deliberately conservative — this is a child-records system):
 *
 *  1. Anyone may register a *new* school only while the deployment allows it.
 *     With `ALLOW_SCHOOL_SELF_REGISTRATION=false` the route still works for the
 *     one-time INITIAL_ADMIN_SETUP_TOKEN path and for the CLI script; it can
 *     never be used to add an administrator to an existing school.
 *  2. Teachers and additional administrators are never self-registered: an
 *     existing school administrator issues an invitation, the invitee sets
 *     their own password, and only then does the membership become active.
 *  3. Guardians register either through an invitation prepared by the school or
 *     with the school's own code. Either way the *learner link* stays unverified
 *     (and therefore grants nothing) until a school administrator confirms it.
 *  4. Every path writes an audit row and revokes any pre-existing session.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  /* --------------------------- registration policy ----------------------- */

  /**
   * What the deployment currently allows. Exposed publicly (no secrets) so the
   * sign-in page can decide which onboarding routes to offer.
   */
  async policy() {
    const schoolCount = await this.prisma.school.count();
    const setupTokenConfigured = Boolean(this.config.get<string>('initialAdminSetupToken'));
    return {
      firstRunSetupEnabled: setupTokenConfigured && schoolCount === 0,
      /** A brand-new school may be registered from the web when allowed. */
      schoolSelfRegistration: (this.config.get<boolean>('registration.schoolSelfRegistration') ?? false) && schoolCount >= 0,
      /** Guardians may register with a school code (not just an invitation). */
      parentSelfRegistration: this.config.get<boolean>('registration.parentSelfRegistration') ?? true,
      invitationRegistration: true,
      schoolCount,
    };
  }

  private webBaseUrl(): string {
    return this.config.get<string>('publicWebUrl') || this.config.get<string[]>('corsOrigins')?.[0] || 'http://localhost:3000';
  }

  private makeToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /* ------------------------- school + first admin ------------------------ */

  /**
   * Creates a school, its first administrator, the Grades 7–9 catalogue and the
   * default assessment vocabulary in ONE transaction: a half-registered school
   * can never exist.
   */
  async registerSchool(dto: SchoolRegistrationInput, meta: RequestMeta) {
    const configuredToken = this.config.get<string>('initialAdminSetupToken');
    const selfService = this.config.get<boolean>('registration.schoolSelfRegistration') ?? false;

    if (dto.setupToken) {
      if (!configuredToken) {
        throw new BadRequestException('First-run setup is disabled on this server. Set INITIAL_ADMIN_SETUP_TOKEN to enable it.');
      }
      const a = Buffer.from(configuredToken);
      const b = Buffer.from(dto.setupToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        await this.audit.record({ action: 'auth.setup.rejected', entityType: 'School', summary: 'Invalid setup token supplied', ipAddress: meta.ipAddress });
        throw new ForbiddenException('That setup token is not valid.');
      }
    } else if (!selfService) {
      throw new ForbiddenException(
        'This server does not accept public school registrations. Ask your head teacher for an invitation, or contact the platform administrator.',
      );
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.admin.email }, select: { id: true } });
    if (existingUser) throw new BadRequestException('An account with that email address already exists. Sign in instead, or use a different address.');

    if (dto.school.code) {
      const clash = await this.prisma.school.findUnique({ where: { code: dto.school.code }, select: { id: true } });
      if (clash) throw new BadRequestException(`The school code ${dto.school.code} is already in use.`);
    }

    const passwordHash = await this.passwords.hash(dto.admin.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: dto.school.name,
          code: dto.school.code || null,
          county: dto.school.county || null,
          phone: dto.school.phone || null,
          email: dto.school.email || null,
          timezone: dto.school.timezone || 'Africa/Nairobi',
        },
      });
      const user = await tx.user.create({
        data: { email: dto.admin.email, fullName: dto.admin.fullName, phone: dto.admin.phone ?? null, passwordHash },
      });
      const membership = await tx.schoolMembership.create({
        data: { userId: user.id, schoolId: school.id, role: 'ADMIN', title: 'School Administrator' },
      });
      await this.applySchoolDefaults(tx, school.id);
      return { school, user, membership };
    });

    await this.audit.record({
      schoolId: created.school.id,
      actorUserId: created.user.id,
      actorRole: 'ADMIN',
      action: 'school.registered',
      entityType: 'School',
      entityId: created.school.id,
      after: { name: created.school.name, code: created.school.code, admin: created.user.email, via: dto.setupToken ? 'setup-token' : 'self-service' },
      ipAddress: meta.ipAddress,
    });

    const issued = await this.tokens.issue({
      userId: created.user.id,
      schoolId: created.school.id,
      membershipId: created.membership.id,
      role: 'ADMIN',
      email: created.user.email,
      fullName: created.user.fullName,
      clientType: 'WEB',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      school: { id: created.school.id, name: created.school.name, code: created.school.code, timezone: created.school.timezone },
      user: await this.auth.buildAuthUser(created.user.id, created.school.id, created.membership.id, 'ADMIN'),
      ...issued,
    };
  }

  /* ------------------------------- guardians ----------------------------- */

  /**
   * Guardian registration.
   *
   * With an invitation: the account is created, the school membership is active
   * and the learner named on the invitation is linked *unverified* (no access
   * until an administrator confirms it).
   *
   * With a school code: the account is created with an active membership but NO
   * learner link at all — the guardian then requests a link with the learner's
   * assessment number and surname, which the school verifies.
   */
  async registerParent(dto: ParentRegistrationInput, meta: RequestMeta) {
    const selfServiceAllowed = this.config.get<boolean>('registration.parentSelfRegistration') ?? true;
    if (!dto.invitationToken && !selfServiceAllowed) {
      throw new ForbiddenException('Guardian self-registration is closed on this server. Ask the school office to invite you.');
    }

    let schoolId: string;
    let learnerId: string | null = null;
    let invitationId: string | null = null;

    if (dto.invitationToken) {
      const invitation = await this.prisma.accountInvitation.findUnique({ where: { tokenHash: TokenService.hashToken(dto.invitationToken) } });
      if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
        throw new BadRequestException('That invitation link is no longer valid. Ask the school office to send a new one.');
      }
      if (invitation.role !== Role.PARENT) {
        throw new BadRequestException('That invitation is not a guardian invitation.');
      }
      if (invitation.email.toLowerCase() !== dto.email.toLowerCase()) {
        throw new BadRequestException(`This invitation was issued to ${invitation.email}. Register with that address, or ask the school office for a new invitation.`);
      }
      schoolId = invitation.schoolId;
      learnerId = invitation.learnerId;
      invitationId = invitation.id;
    } else {
      if (!dto.schoolCode) throw new BadRequestException('Enter the school code from your invitation letter.');
      const school = await this.prisma.school.findFirst({
        where: { code: { equals: dto.schoolCode.trim(), mode: 'insensitive' }, isActive: true, archivedAt: null },
        select: { id: true, name: true },
      });
      if (!school) {
        throw new BadRequestException('We could not find a school with that code. Check the letter from the school office, or call them for help.');
      }
      schoolId = school.id;
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true, memberships: { select: { schoolId: true, role: true } } } });
    if (existing) {
      const alreadyHere = existing.memberships.some((membership) => membership.schoolId === schoolId);
      if (alreadyHere) {
        throw new BadRequestException('An account with that email address already exists. Sign in, or use "Forgotten your password?" to recover it.');
      }
      throw new BadRequestException('An account with that email address already exists.');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: dto.email, fullName: dto.fullName, phone: dto.phone, passwordHash },
      });
      const membership = await tx.schoolMembership.create({
        data: { userId: user.id, schoolId, role: 'PARENT', status: 'ACTIVE' },
      });
      const profile = await tx.parentProfile.create({
        data: { userId: user.id, schoolId, relationship: dto.relationship, phone: dto.phone },
      });
      let linkId: string | null = null;
      if (learnerId) {
        const link = await tx.parentLearnerLink.upsert({
          where: { parentProfileId_learnerId: { parentProfileId: profile.id, learnerId } },
          update: { revokedAt: null, isVerified: false, relationship: dto.relationship },
          create: {
            schoolId,
            parentProfileId: profile.id,
            learnerId,
            relationship: dto.relationship,
            isVerified: false,
            isPrimaryContact: false,
          },
        });
        linkId = link.id;
      }
      if (invitationId) {
        await tx.accountInvitation.update({ where: { id: invitationId }, data: { acceptedAt: new Date() } });
      }
      return { user, membership, profile, linkId };
    });

    // Tell the school office there is something to verify.
    const admins = await this.prisma.schoolMembership.findMany({ where: { schoolId, role: 'ADMIN', status: 'ACTIVE' }, select: { userId: true } });
    await this.notifications.notify({
      schoolId,
      userIds: admins.map((row) => row.userId),
      type: NotificationType.ACCOUNT,
      title: created.linkId ? 'Guardian registered — verify the learner link' : 'New guardian registered',
      body: `${dto.fullName} created a guardian account${created.linkId ? ' and claimed a learner record' : ''}. Review it under Parents & links.`,
      link: '/people/parents',
      entityType: 'ParentProfile',
      entityId: created.profile.id,
      email: undefined,
    });

    await this.audit.record({
      schoolId,
      actorUserId: created.user.id,
      actorRole: 'PARENT',
      action: 'auth.parent.registered',
      entityType: 'User',
      entityId: created.user.id,
      summary: created.linkId ? 'Guardian self-registration with pending learner link' : 'Guardian self-registration with school code',
      ipAddress: meta.ipAddress,
    });

    return {
      registered: true,
      /** The client shows a "waiting for the school office" screen until verified. */
      verificationRequired: true,
      hasPendingLink: Boolean(created.linkId),
      message: created.linkId
        ? 'Your account is ready. The school office must confirm your link to your child before their records appear.'
        : 'Your account is ready. Add your child using the assessment number from the school office; the school will confirm it.',
    };
  }

  /* ------------------------------ invitations ---------------------------- */

  /** Public preview so the invitee sees who invited them before signing up. */
  async previewInvitation(token: string) {
    const invitation = await this.prisma.accountInvitation.findUnique({
      where: { tokenHash: TokenService.hashToken(token) },
      include: { school: { select: { name: true, code: true } }, learner: { select: { firstName: true, lastName: true } } },
    });
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
      return { valid: false as const, message: 'This invitation link is no longer valid. Ask the school office to send a new one.' };
    }
    return {
      valid: true as const,
      email: invitation.email,
      fullName: invitation.fullName,
      role: invitation.role,
      roleLabel: ROLE_LABELS[invitation.role as keyof typeof ROLE_LABELS] ?? invitation.role,
      schoolName: invitation.school.name,
      learnerName: invitation.learner ? `${invitation.learner.firstName} ${invitation.learner.lastName}` : null,
      relationship: invitation.relationship,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** Accepting sets the invitee's own password and activates the membership. */
  async acceptInvitation(dto: AcceptInvitationInput, meta: RequestMeta) {
    const invitation = await this.prisma.accountInvitation.findUnique({ where: { tokenHash: TokenService.hashToken(dto.token) } });
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation link is no longer valid. Ask the school office to send a new one.');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    const result = await this.prisma.$transaction(async (tx) => {
      let userId: string;
      const existing = await tx.user.findUnique({ where: { email: invitation.email } });
      if (existing) {
        userId = existing.id;
        await tx.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
            isActive: true,
            ...(dto.fullName ? { fullName: dto.fullName } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
          },
        });
      } else {
        const user = await tx.user.create({
          data: { email: invitation.email, fullName: dto.fullName || invitation.fullName, phone: dto.phone ?? null, passwordHash },
        });
        userId = user.id;
      }

      const membership = await tx.schoolMembership.upsert({
        where: { userId_schoolId_role: { userId, schoolId: invitation.schoolId, role: invitation.role } },
        update: { status: 'ACTIVE', deactivatedAt: null },
        create: {
          userId,
          schoolId: invitation.schoolId,
          role: invitation.role,
          status: 'ACTIVE',
          title: invitation.role === 'TEACHER' ? 'Teacher' : invitation.role === 'ADMIN' ? 'School Administrator' : null,
          invitedById: invitation.invitedById,
        },
      });

      if (invitation.role === Role.TEACHER) {
        await tx.teacherProfile.upsert({
          where: { userId },
          update: { staffNumber: invitation.staffNumber ?? undefined },
          create: {
            userId,
            schoolId: invitation.schoolId,
            staffNumber: invitation.staffNumber || `STF-${Date.now().toString().slice(-6)}`,
            phone: dto.phone ?? null,
          },
        });
      }

      if (invitation.role === Role.PARENT) {
        const profile = await tx.parentProfile.upsert({
          where: { userId },
          update: { relationship: invitation.relationship ?? 'Guardian' },
          create: {
            userId,
            schoolId: invitation.schoolId,
            relationship: invitation.relationship ?? 'Guardian',
            phone: dto.phone ?? null,
          },
        });
        if (invitation.learnerId) {
          await tx.parentLearnerLink.upsert({
            where: { parentProfileId_learnerId: { parentProfileId: profile.id, learnerId: invitation.learnerId } },
            update: { revokedAt: null, isVerified: false },
            create: {
              schoolId: invitation.schoolId,
              parentProfileId: profile.id,
              learnerId: invitation.learnerId,
              relationship: invitation.relationship ?? 'Guardian',
              isVerified: false,
            },
          });
        }
      }

      await tx.accountInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      return { userId, membership };
    });

    await this.tokens.revokeAllForUser(result.userId);
    await this.audit.record({
      schoolId: invitation.schoolId,
      actorUserId: result.userId,
      actorRole: invitation.role,
      action: 'auth.invitation.accepted',
      entityType: 'AccountInvitation',
      entityId: invitation.id,
      summary: `${ROLE_LABELS[invitation.role as keyof typeof ROLE_LABELS] ?? invitation.role} activated their account`,
      ipAddress: meta.ipAddress,
    });

    return {
      activated: true,
      email: invitation.email,
      role: invitation.role,
      message: 'Your account is active. Sign in with the password you just chose.',
    };
  }

  /**
   * Administrator-issued invitation. The caller must hold `user:manage`; the
   * invitation can only ever grant access inside the caller's own school.
   */
  async createInvitation(user: Principal, dto: InvitationCreateInput, meta: RequestMeta) {
    const email = dto.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email }, include: { memberships: true } });

    if (existingUser?.memberships.some((membership) => membership.schoolId === user.schoolId && membership.status === 'ACTIVE' && membership.role === dto.role)) {
      throw new BadRequestException('That person already has an active account in this school with that role.');
    }

    if (dto.role === 'ADMIN') {
      const admins = await this.prisma.schoolMembership.count({ where: { schoolId: user.schoolId, role: 'ADMIN', status: 'ACTIVE' } });
      if (admins >= 10) throw new BadRequestException('This school already has the maximum number of administrators.');
    }

    if (dto.learnerId) {
      const learner = await this.prisma.learner.findFirst({ where: { id: dto.learnerId, schoolId: user.schoolId }, select: { id: true } });
      if (!learner) throw new NotFoundException('That learner is not part of this school.');
    }

    const token = this.makeToken();
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? INVITATION_TTL_DAYS) * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.accountInvitation.create({
      data: {
        schoolId: user.schoolId,
        email,
        fullName: dto.fullName,
        role: dto.role as Role,
        staffNumber: dto.staffNumber ?? null,
        relationship: dto.relationship ?? null,
        learnerId: dto.learnerId ?? null,
        tokenHash: TokenService.hashToken(token),
        expiresAt,
        invitedById: user.userId,
        lastSentAt: new Date(),
      },
    });

    const url = `${this.webBaseUrl()}/activate?token=${token}`;

    // In-app heads-up for the invited person if they already have an account here.
    if (existingUser) {
      await this.notifications.notify({
        schoolId: user.schoolId,
        userIds: [existingUser.id],
        type: NotificationType.ACCOUNT,
        title: 'You have been invited',
        body: `${user.fullName ?? 'A school administrator'} invited you to join as ${ROLE_LABELS[dto.role as keyof typeof ROLE_LABELS] ?? dto.role}.`,
        link: '/account',
        entityType: 'AccountInvitation',
        entityId: invitation.id,
      });
    }

    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: 'ADMIN',
      action: 'auth.invitation.created',
      entityType: 'AccountInvitation',
      entityId: invitation.id,
      after: { email, role: dto.role, learnerId: dto.learnerId ?? null },
      ipAddress: meta.ipAddress,
    });

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        fullName: invitation.fullName,
        role: invitation.role,
        status: 'PENDING' as const,
        expiresAt: invitation.expiresAt.toISOString(),
        learnerId: invitation.learnerId,
      },
      /**
       * Returned once so the office can hand it over (WhatsApp, SMS, printed
       * letter). When SMTP is configured the same link is also emailed.
       */
      invitationUrl: url,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async listInvitations(user: Principal) {
    const rows = await this.prisma.accountInvitation.findMany({
      where: { schoolId: user.schoolId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: { learner: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      relationship: row.relationship,
      learnerName: row.learner ? `${row.learner.firstName} ${row.learner.lastName}` : null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async revokeInvitation(user: Principal, id: string, reason: string | undefined, meta: RequestMeta) {
    const invitation = await this.prisma.accountInvitation.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.acceptedAt) throw new BadRequestException('That invitation has already been accepted.');
    await this.prisma.accountInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: 'ADMIN',
      action: 'auth.invitation.revoked',
      entityType: 'AccountInvitation',
      entityId: id,
      summary: reason,
      ipAddress: meta.ipAddress,
    });
    return { revoked: true };
  }

  /**
   * Administrator-issued password reset link, for schools that have not
   * configured an email provider. The link is returned to the administrator
   * (who hands it to the account holder in person) and is short lived, single
   * use, and audited — it is never sent to the client of the account owner.
   */
  async issueResetLink(user: Principal, targetUserId: string, meta: RequestMeta) {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId: targetUserId, schoolId: user.schoolId },
      include: { user: { select: { id: true, email: true, fullName: true, isActive: true } } },
    });
    if (!membership) throw new NotFoundException('That account is not part of this school.');

    const token = this.makeToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: targetUserId,
        tokenHash: TokenService.hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ipAddress: meta.ipAddress ?? null,
      },
    });
    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: 'ADMIN',
      action: 'auth.password.reset_link_issued',
      entityType: 'User',
      entityId: targetUserId,
      summary: 'Administrator issued a password reset link on behalf of the account holder',
      ipAddress: meta.ipAddress,
    });
    return {
      email: membership.user.email,
      fullName: membership.user.fullName,
      resetUrl: `${this.webBaseUrl()}/reset-password?token=${token}`,
      expiresInMinutes: 60,
    };
  }

  /** Deactivate (or reactivate) an account and revoke its live sessions. */
  async setAccountActive(user: Principal, targetUserId: string, isActive: boolean, meta: RequestMeta) {
    if (targetUserId === user.userId) throw new BadRequestException('You cannot deactivate your own account.');
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId: targetUserId, schoolId: user.schoolId },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (!membership) throw new NotFoundException('That account is not part of this school.');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: targetUserId }, data: { isActive } });
      await tx.schoolMembership.updateMany({
        where: { userId: targetUserId, schoolId: user.schoolId },
        data: { status: isActive ? 'ACTIVE' : 'DEACTIVATED', deactivatedAt: isActive ? null : new Date() },
      });
    });
    if (!isActive) await this.tokens.revokeAllForUser(targetUserId);

    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: 'ADMIN',
      action: isActive ? 'auth.account.reactivated' : 'auth.account.deactivated',
      entityType: 'User',
      entityId: targetUserId,
      summary: `${membership.user.fullName} (${membership.user.email})`,
      ipAddress: meta.ipAddress,
    });
    return { isActive };
  }

  /** Grades 7–9, assessment categories and achievement bands for a new school. */
  private async applySchoolDefaults(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], schoolId: string): Promise<void> {
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
}
