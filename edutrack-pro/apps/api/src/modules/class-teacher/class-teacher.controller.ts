import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions, Roles } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import {
  classReportNarrativeSchema,
  classTeacherAssignmentSchema,
  classTeacherInterventionSchema,
  classTeacherInterventionUpdateSchema,
} from '@edutrack/validation';
import { ClassTeacherService } from './class-teacher.service';

@ApiTags('class-teacher')
@ApiBearerAuth()
@Controller('class-teacher')
export class ClassTeacherController {
  constructor(private readonly classTeachers: ClassTeacherService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:read')
  @ApiOperation({ summary: 'Class-teacher dashboard with assigned classes and real school data' })
  dashboard(@CurrentUser() user: AuthPrincipal) {
    return this.classTeachers.dashboard(user);
  }

  @Get('assignments')
  @Roles('ADMIN')
  @RequirePermissions('class-teacher:assign')
  @ApiOperation({ summary: 'List historical class-teacher assignments for this school' })
  listAssignments(
    @CurrentUser() user: AuthPrincipal,
    @Query('classId') classId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.classTeachers.listAssignments(user, { classId, academicYearId });
  }

  @Post('assignments')
  @Roles('ADMIN')
  @RequirePermissions('class-teacher:assign')
  @ApiOperation({ summary: 'Assign or reassign an active teacher to a class' })
  assign(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(classTeacherAssignmentSchema)) body: z.infer<typeof classTeacherAssignmentSchema>) {
    return this.classTeachers.assign(user, body);
  }

  @Patch('assignments/:id/revoke')
  @Roles('ADMIN')
  @RequirePermissions('class-teacher:assign')
  @ApiOperation({ summary: 'Revoke a class-teacher assignment without deleting its history' })
  revoke(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.classTeachers.revokeAssignment(user, id, body?.reason);
  }

  @Get('classes/:classId/progress')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:results:review')
  @ApiOperation({ summary: 'Learner progress from published results and support records only' })
  progress(@CurrentUser() user: AuthPrincipal, @Param('classId') classId: string, @Query('termId') termId?: string) {
    return this.classTeachers.progress(user, classId, termId);
  }

  @Get('classes/:classId/report-cards')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:reports:manage')
  @ApiOperation({ summary: 'Preview batch report cards for a selected school term' })
  reportCards(@CurrentUser() user: AuthPrincipal, @Param('classId') classId: string, @Query('termId') termId: string) {
    return this.classTeachers.reportCards(user, classId, termId);
  }

  @Patch('classes/:classId/report-cards/:learnerId/narrative')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:reports:manage')
  @ApiOperation({ summary: 'Save a versioned draft narrative for one learner report card' })
  saveNarrative(
    @CurrentUser() user: AuthPrincipal,
    @Param('classId') classId: string,
    @Param('learnerId') learnerId: string,
    @Query('termId') termId: string,
    @Body(zodPipe(classReportNarrativeSchema)) body: z.infer<typeof classReportNarrativeSchema>,
  ) {
    return this.classTeachers.saveNarrative(user, classId, learnerId, termId, body);
  }

  @Post('classes/:classId/report-cards/:learnerId/publish')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:reports:manage')
  @ApiOperation({ summary: 'Publish a report-card narrative version' })
  publishNarrative(@CurrentUser() user: AuthPrincipal, @Param('classId') classId: string, @Param('learnerId') learnerId: string, @Query('termId') termId: string) {
    return this.classTeachers.publishNarrative(user, classId, learnerId, termId);
  }

  @Get('classes/:classId/interventions')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:interventions:manage')
  @ApiOperation({ summary: 'List class-scoped learner support plans' })
  interventions(@CurrentUser() user: AuthPrincipal, @Param('classId') classId: string, @Query('status') status?: string) {
    return this.classTeachers.interventions(user, classId, status);
  }

  @Post('classes/:classId/interventions')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:interventions:manage')
  @ApiOperation({ summary: 'Create a class-scoped, auditable learner support plan' })
  createIntervention(
    @CurrentUser() user: AuthPrincipal,
    @Param('classId') classId: string,
    @Body(zodPipe(classTeacherInterventionSchema)) body: z.infer<typeof classTeacherInterventionSchema>,
  ) {
    return this.classTeachers.createIntervention(user, classId, body);
  }

  @Patch('interventions/:id')
  @Roles('ADMIN', 'CLASS_TEACHER')
  @RequirePermissions('class-teacher:interventions:manage')
  @ApiOperation({ summary: 'Update a support plan in the assigned class and retain audit history' })
  updateIntervention(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(classTeacherInterventionUpdateSchema)) body: z.infer<typeof classTeacherInterventionUpdateSchema>,
  ) {
    return this.classTeachers.updateIntervention(user, id, body);
  }
}
