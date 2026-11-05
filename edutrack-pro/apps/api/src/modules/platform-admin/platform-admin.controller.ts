import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchoolStatus } from '@prisma/client';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { platformSchoolCreateSchema, platformSchoolUpdateSchema, schoolStatusChangeSchema } from '@edutrack/validation';
import { PlatformAdminService } from './platform-admin.service';

@ApiTags('platform-admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('SUPERADMIN')
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Platform overview across tenant schools' })
  dashboard() {
    return this.platform.dashboard();
  }

  @Get('schools')
  @ApiOperation({ summary: 'List school tenants with stable public identities and lifecycle status' })
  listSchools(
    @Query('status') status?: SchoolStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const allowed: SchoolStatus[] = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];
    return this.platform.listSchools({
      status: status && allowed.includes(status) ? status : undefined,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('schools/:publicId')
  @ApiOperation({ summary: 'School tenant detail, counts, administrators and recent academic years' })
  getSchool(@Param('publicId') publicId: string) {
    return this.platform.getSchool(publicId);
  }

  @Post('schools')
  @ApiOperation({ summary: 'Onboard a school and issue a one-time initial-administrator invitation' })
  createSchool(
    @CurrentUser() user: AuthPrincipal,
    @Body(zodPipe(platformSchoolCreateSchema)) body: z.infer<typeof platformSchoolCreateSchema>,
    @Req() req: Request,
  ) {
    return this.platform.createSchool(user, body, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Patch('schools/:publicId')
  @ApiOperation({ summary: 'Update school identity/contact details; stable public ID remains unchanged' })
  updateSchool(
    @CurrentUser() user: AuthPrincipal,
    @Param('publicId') publicId: string,
    @Body(zodPipe(platformSchoolUpdateSchema)) body: z.infer<typeof platformSchoolUpdateSchema>,
    @Req() req: Request,
  ) {
    return this.platform.updateSchool(user, publicId, body, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Patch('schools/:publicId/status')
  @ApiOperation({ summary: 'Activate, suspend or archive a tenant without deleting its school data' })
  changeStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('publicId') publicId: string,
    @Body(zodPipe(schoolStatusChangeSchema)) body: z.infer<typeof schoolStatusChangeSchema>,
    @Req() req: Request,
  ) {
    return this.platform.changeStatus(user, publicId, body, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }
}
