import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService, private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Audit trail for sensitive operations (administrators only)' })
  async list(
    @CurrentUser() user: AuthPrincipal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const pageNumber = Math.max(1, Number(page) || 1);
    const size = Math.min(200, Number(pageSize) || 50);
    const { items, total } = await this.audit.list({
      schoolId: user.schoolId, page: pageNumber, pageSize: size, action, entityType, actorUserId, from, to,
    });
    return {
      items: items.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        summary: log.summary,
        actorName: log.actor?.fullName ?? 'System',
        actorEmail: log.actor?.email ?? null,
        actorRole: log.actorRole,
        ipAddress: log.ipAddress,
        before: log.beforeJson,
        after: log.afterJson,
        createdAt: log.createdAt.toISOString(),
      })),
      meta: { page: pageNumber, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)), hasNext: pageNumber * size < total },
    };
  }

  @Get('actions')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Distinct action names present in this school’s audit trail (for filtering)' })
  async actions(@CurrentUser() user: AuthPrincipal) {
    const rows = await this.prisma.auditLog.findMany({
      where: { schoolId: user.schoolId },
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    });
    return rows.map((r) => r.action);
  }
}
