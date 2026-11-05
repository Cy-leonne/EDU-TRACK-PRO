import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppRole, Permission } from '@edutrack/shared-config';
import { ROLE_PERMISSIONS } from '@edutrack/shared-config';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../decorators';

export interface JwtPayload {
  sub: string;          // user id
  sid: string;          // active school id ("platform" for platform operators)
  mid: string;          // school membership id or platform-admin id
  role: AppRole;
  email: string;
  name: string;
  tv: number;           // token version (bumped when memberships change)
  iat?: number;
  exp?: number;
}

export interface AuthPrincipal {
  userId: string;
  schoolId: string;
  membershipId: string;
  role: AppRole;
  email: string;
  fullName: string;
  permissions: Permission[];
}

/**
 * Global authentication + authorization guard.
 *
 * Every protected request revalidates the session's school membership (or
 * platform-operator record) in PostgreSQL. This means a suspended school,
 * deactivated membership, disabled user, or revoked class-teacher assignment
 * takes effect immediately instead of waiting for the JWT to expire.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal; headers: Record<string, string | undefined> }>();
    const token = this.extractToken(request);

    if (isPublic) return true;
    if (!token) throw new UnauthorizedException('Please sign in to continue.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('auth.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('Please sign in to continue.');
    }

    const principal = await this.resolvePrincipal(payload);
    request.user = principal;

    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    // Platform operators are never implicitly school administrators. They must
    // be routed through an explicit @Roles('SUPERADMIN') platform endpoint.
    if (principal.role === 'SUPERADMIN' && !requiredRoles?.includes('SUPERADMIN')) {
      throw new UnauthorizedException('Your role does not allow this action.');
    }
    if (requiredRoles?.length && !requiredRoles.includes(principal.role)) {
      throw new UnauthorizedException('Your role does not allow this action.');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (requiredPermissions?.length) {
      const missing = requiredPermissions.filter((permission) => !principal.permissions.includes(permission));
      if (missing.length) {
        throw new UnauthorizedException(`Your account is missing the required permission: ${missing.join(', ')}`);
      }
    }
    return true;
  }

  private async resolvePrincipal(payload: JwtPayload): Promise<AuthPrincipal> {
    if (payload.role === 'SUPERADMIN') {
      const operator = await this.prisma.platformAdmin.findFirst({
        where: {
          id: payload.mid,
          userId: payload.sub,
          isActive: true,
          user: { isActive: true, archivedAt: null },
        },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
      if (!operator || payload.sid !== 'platform') throw new UnauthorizedException('Your platform account is no longer active.');
      return {
        userId: operator.user.id,
        schoolId: 'platform',
        membershipId: operator.id,
        role: 'SUPERADMIN',
        email: operator.user.email,
        fullName: operator.user.fullName,
        permissions: ROLE_PERMISSIONS.SUPERADMIN,
      };
    }

    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        id: payload.mid,
        userId: payload.sub,
        schoolId: payload.sid,
        status: 'ACTIVE',
        user: { isActive: true, archivedAt: null },
        school: { isActive: true, status: 'ACTIVE', archivedAt: null },
      },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!membership || membership.role === 'SUPERADMIN') {
      throw new UnauthorizedException('Your account is no longer active. Contact your school administrator.');
    }

    let role: AppRole = membership.role;
    if (membership.role === 'TEACHER' || membership.role === 'CLASS_TEACHER') {
      const now = new Date();
      const [activeAssignment, legacyClassTeacher] = await Promise.all([
        this.prisma.classTeacherAssignment.findFirst({
          where: {
            schoolId: membership.schoolId,
            teacher: { userId: membership.userId, isActive: true, archivedAt: null },
            revokedAt: null,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { id: true },
        }),
        this.prisma.class.findFirst({
          where: { schoolId: membership.schoolId, isActive: true, archivedAt: null, classTeacher: { userId: membership.userId, isActive: true, archivedAt: null } },
          select: { id: true },
        }),
      ]);
      role = activeAssignment || legacyClassTeacher ? 'CLASS_TEACHER' : 'TEACHER';
    }

    return {
      userId: membership.user.id,
      schoolId: membership.schoolId,
      membershipId: membership.id,
      role,
      email: membership.user.email,
      fullName: membership.user.fullName,
      permissions: ROLE_PERMISSIONS[role] ?? [],
    };
  }

  private extractToken(request: Request & { headers: Record<string, string | undefined> }): string | undefined {
    const header = request.headers['authorization'];
    if (header?.startsWith('Bearer ')) return header.slice(7).trim();
    // The web app uses an HttpOnly access cookie through the same-origin Next proxy.
    const cookies = (request as unknown as { cookies?: Record<string, string> }).cookies;
    return cookies?.['edutrack_access_token'];
  }
}
