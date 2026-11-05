import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  schoolId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Audit trail for sensitive operations.
 *  * `before`/`after` snapshots are passed through a redaction step so that
 *    passwords, tokens and other secrets can never reach the audit table.
 *  * Audit writes never throw into the request path - a failure here is logged
 *    but must not roll back an otherwise valid business operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private static readonly REDACT_KEYS = [
    'password', 'passwordhash', 'newpassword', 'currentpassword', 'temporarypassword',
    'token', 'tokenhash', 'accesstoken', 'refreshtoken', 'setupToken', 'secret',
  ];

  constructor(private readonly prisma: PrismaService) {}

  static redact(value: unknown, depth = 0): unknown {
    if (depth > 6 || value == null) return value ?? null;
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => AuditService.redact(v, depth + 1));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (AuditService.REDACT_KEYS.some((r) => k.toLowerCase().includes(r.toLowerCase()))) {
          out[k] = '[REDACTED]';
        } else {
          out[k] = AuditService.redact(v, depth + 1);
        }
      }
      return out;
    }
    return value;
  }

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          schoolId: input.schoolId ?? null,
          actorUserId: input.actorUserId ?? null,
          actorRole: input.actorRole ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          summary: input.summary ?? null,
          beforeJson: (AuditService.redact(input.before) ?? undefined) as never,
          afterJson: (AuditService.redact(input.after) ?? undefined) as never,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ? input.userAgent.slice(0, 400) : null,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit write failed for ${input.action}: ${(error as Error).message}`);
    }
  }

  async list(params: {
    schoolId: string;
    page: number;
    pageSize: number;
    action?: string;
    entityType?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
  }) {
    const where = {
      schoolId: params.schoolId,
      ...(params.action ? { action: { contains: params.action, mode: 'insensitive' as const } } : {}),
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { actor: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
