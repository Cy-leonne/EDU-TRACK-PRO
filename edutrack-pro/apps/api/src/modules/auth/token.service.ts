import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppRole } from '@edutrack/shared-config';

export interface TokenContext {
  userId: string;
  schoolId: string;
  membershipId: string;
  role: AppRole;
  email: string;
  fullName: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: Date;
  familyId: string;
}

/**
 * Access + refresh token issuance.
 *
 *  * Access tokens are short lived JWTs (default 15 minutes).
 *  * Refresh tokens are opaque 256-bit random strings; only their SHA-256 hash
 *    is stored, and every refresh rotates the token. Re-use of a rotated token
 *    revokes the whole family (theft detection).
 *  * Mobile clients receive the tokens in the response body; the web app stores
 *    them in httpOnly cookies set by its own server (never in localStorage).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private ttlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2];
    return unit === 's' ? value : unit === 'm' ? value * 60 : unit === 'h' ? value * 3600 : value * 86400;
  }

  async issue(params: {
    userId: string;
    schoolId: string;
    membershipId: string;
    platformAdminId?: string;
    role: AppRole;
    email: string;
    fullName: string;
    clientType: 'WEB' | 'MOBILE';
    familyId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<IssuedTokens> {
    const accessTtl = this.config.get<string>('auth.accessTtl') ?? '15m';
    const refreshTtl = this.config.get<string>('auth.refreshTtl') ?? '30d';
    const expiresIn = this.ttlToSeconds(accessTtl);
    const refreshSeconds = this.ttlToSeconds(refreshTtl);

    const accessToken = await this.jwt.signAsync(
      {
        sub: params.userId,
        sid: params.schoolId,
        mid: params.membershipId,
        role: params.role,
        email: params.email,
        name: params.fullName,
      },
      { secret: this.config.get<string>('auth.accessSecret'), expiresIn: accessTtl },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const familyId = params.familyId ?? randomUUID();
    const refreshExpiresAt = new Date(Date.now() + refreshSeconds * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: params.userId,
        schoolMembershipId: params.role === 'SUPERADMIN' ? null : params.membershipId,
        platformAdminId: params.platformAdminId ?? null,
        tokenHash: TokenService.hashToken(refreshToken),
        familyId,
        clientType: params.clientType,
        expiresAt: refreshExpiresAt,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ? params.userAgent.slice(0, 400) : null,
      },
    });

    return { accessToken, refreshToken, expiresIn, refreshExpiresAt, familyId };
  }

  /** Rotates a refresh token, revoking the family if a revoked token is replayed. */
  async rotate(refreshToken: string, clientType: 'WEB' | 'MOBILE', ipAddress?: string | null, userAgent?: string | null): Promise<IssuedTokens & { context: TokenContext }> {
    const hash = TokenService.hashToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!existing) throw new UnauthorizedException('Your session has expired. Please sign in again.');

    if (existing.revokedAt) {
      // Re-use of a rotated token: assume compromise and kill the whole family.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('This session was already signed out. Please sign in again.');
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    if (existing.platformAdminId) {
      const operator = await this.prisma.platformAdmin.findFirst({
        where: { id: existing.platformAdminId, userId: existing.userId, isActive: true, user: { isActive: true, archivedAt: null } },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
      if (!operator) throw new UnauthorizedException('Your platform account is no longer active.');
      const issued = await this.issue({
        userId: operator.user.id, schoolId: 'platform', membershipId: operator.id, platformAdminId: operator.id,
        role: 'SUPERADMIN', email: operator.user.email, fullName: operator.user.fullName,
        clientType, familyId: existing.familyId, ipAddress, userAgent,
      });
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedByHash: TokenService.hashToken(issued.refreshToken), lastUsedAt: new Date() },
      });
      return {
        ...issued,
        context: {
          userId: operator.user.id, schoolId: 'platform', membershipId: operator.id, role: 'SUPERADMIN',
          email: operator.user.email, fullName: operator.user.fullName,
        },
      };
    }

    if (!existing.schoolMembershipId) {
      throw new UnauthorizedException('This session is no longer valid. Please sign in again.');
    }
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { id: existing.schoolMembershipId, userId: existing.userId, status: 'ACTIVE' },
      include: {
        user: { select: { id: true, email: true, fullName: true, isActive: true, archivedAt: true } },
        school: { select: { id: true, name: true, isActive: true, status: true, archivedAt: true } },
      },
    });
    if (!membership || !membership.user.isActive || membership.user.archivedAt || !membership.school.isActive || membership.school.status !== 'ACTIVE' || membership.school.archivedAt) {
      throw new UnauthorizedException('Your account is no longer active. Contact your school administrator.');
    }

    const now = new Date();
    const [classTeacherAssignment, legacyClassTeacher] = membership.role === 'TEACHER' || membership.role === 'CLASS_TEACHER'
      ? await Promise.all([
          this.prisma.classTeacherAssignment.findFirst({
            where: {
              schoolId: membership.schoolId,
              teacher: { userId: membership.user.id, isActive: true, archivedAt: null },
              revokedAt: null,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            select: { id: true },
          }),
          this.prisma.class.findFirst({
            where: { schoolId: membership.schoolId, isActive: true, archivedAt: null, classTeacher: { userId: membership.user.id, isActive: true, archivedAt: null } },
            select: { id: true },
          }),
        ])
      : [null, null];
    const role: AppRole = classTeacherAssignment || legacyClassTeacher
      ? 'CLASS_TEACHER'
      : membership.role === 'CLASS_TEACHER' ? 'TEACHER' : membership.role;

    const issued = await this.issue({
      userId: membership.user.id,
      schoolId: membership.schoolId,
      membershipId: membership.id,
      role,
      email: membership.user.email,
      fullName: membership.user.fullName,
      clientType,
      familyId: existing.familyId,
      ipAddress,
      userAgent,
    });

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByHash: TokenService.hashToken(issued.refreshToken), lastUsedAt: new Date() },
    });

    return {
      ...issued,
      context: {
        userId: membership.user.id,
        schoolId: membership.schoolId,
        membershipId: membership.id,
        role,
        email: membership.user.email,
        fullName: membership.user.fullName,
      },
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    const hash = TokenService.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return res.count;
  }
}
