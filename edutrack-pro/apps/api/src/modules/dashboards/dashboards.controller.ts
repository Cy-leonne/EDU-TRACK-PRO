import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { DashboardsService } from './dashboards.service';

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller()
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('dashboard/admin')
  @RequirePermissions('report:read:school')
  @ApiOperation({ summary: 'Administrator dashboard: counts, setup warnings, publication overview, timetable status' })
  admin(@CurrentUser() user: AuthPrincipal) {
    return this.dashboards.admin(user);
  }

  @Get('dashboard/teacher')
  @RequirePermissions('report:read:class')
  @ApiOperation({ summary: 'Teacher dashboard: today’s lessons, workloads, assessments needing attention' })
  teacher(@CurrentUser() user: AuthPrincipal) {
    return this.dashboards.teacher(user);
  }

  @Get('dashboard/parent')
  @RequirePermissions('report:read:learner')
  @ApiOperation({ summary: 'Parent dashboard for the selected linked learner (defaults to the first verified link)' })
  parent(@CurrentUser() user: AuthPrincipal, @Query('learnerId') learnerId?: string) {
    return this.dashboards.parent(user, learnerId);
  }

  @Get('reports/school')
  @RequirePermissions('report:read:school')
  @ApiOperation({ summary: 'School analytics: enrolment, assessment completion, teacher workload, timetable coverage' })
  reports(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId?: string, @Query('termId') termId?: string) {
    return this.dashboards.reports(user, academicYearId, termId);
  }
}
