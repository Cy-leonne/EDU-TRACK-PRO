import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../decorators';
import type { AuthPrincipal } from '../guards/auth.guard';
import { zodPipe } from '../pipes';
import { notificationPreferenceSchema } from '@edutrack/validation';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications (in-app inbox)' })
  async list(
    @CurrentUser() user: AuthPrincipal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const result = await this.notifications.list(user.userId, {
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Number(pageSize) || 25),
      unreadOnly: unreadOnly === 'true',
    });
    return { items: result.items, meta: { page: Number(page) || 1, pageSize: Number(pageSize) || 25, total: result.total, unread: result.unread } };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count for the header badge' })
  async unread(@CurrentUser() user: AuthPrincipal) {
    const { unread } = await this.notifications.list(user.userId, { page: 1, pageSize: 1, unreadOnly: true });
    return { unread };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'My notification preferences (in-app, email, muted types)' })
  preferences(@CurrentUser() user: AuthPrincipal) {
    return this.notifications.getPreferences(user.userId, user.schoolId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update my notification preferences' })
  updatePreferences(
    @CurrentUser() user: AuthPrincipal,
    @Body(zodPipe(notificationPreferenceSchema))
    body: { inAppEnabled: boolean; emailEnabled: boolean; emailAddress?: string | null; mutedTypes: string[] },
  ) {
    return this.notifications.updatePreferences(user.userId, user.schoolId, body);
  }

  @Post('retry-failed-emails')
  @RequirePermissions('school:write')
  @ApiOperation({ summary: 'Admin: retry email alerts that could not be delivered' })
  retry(@CurrentUser() user: AuthPrincipal) {
    return this.notifications.retryFailedEmails(user.schoolId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markRead(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    await this.notifications.markRead(user.userId, id);
    return { id, read: true };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  async markAllRead(@CurrentUser() user: AuthPrincipal) {
    const count = await this.notifications.markAllRead(user.userId);
    return { updated: count };
  }
}
