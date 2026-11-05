import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { bulkEnrollmentSchema, classSchema, enrollmentSchema } from '@edutrack/validation';
import { ClassesService } from './classes.service';

@ApiTags('classes')
@ApiBearerAuth()
@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @ApiOperation({ summary: 'List classes visible to the caller (role-scoped)' })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query('academicYearId') academicYearId?: string,
    @Query('gradeId') gradeId?: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.classes.list(user, { academicYearId, gradeId, search, includeInactive: includeInactive === 'true' });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Class detail with assignments, requirements and roster count' })
  get(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.classes.get(user, id);
  }

  @Post()
  @RequirePermissions('class:manage')
  @ApiOperation({ summary: 'Create a class / stream' })
  create(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(classSchema)) body: z.infer<typeof classSchema>) {
    return this.classes.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('class:manage')
  @ApiOperation({ summary: 'Update a class' })
  update(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(classSchema.partial())) body: Partial<z.infer<typeof classSchema>>) {
    return this.classes.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('class:manage')
  @ApiOperation({ summary: 'Archive an empty class' })
  archive(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.classes.archive(user, id);
  }

  @Get(':id/learners')
  @ApiOperation({ summary: 'Active learners enrolled in the class' })
  learners(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.classes.listEnrollments(user, id);
  }

  @Post('enrollments')
  @RequirePermissions('learner:manage')
  @ApiOperation({ summary: 'Enrol a learner into a class (closes any previous active enrolment)' })
  enroll(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(enrollmentSchema)) body: z.infer<typeof enrollmentSchema>) {
    return this.classes.enroll(user, body);
  }

  @Post('enrollments/bulk')
  @RequirePermissions('learner:manage')
  @ApiOperation({ summary: 'Enrol several learners at once' })
  bulkEnroll(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(bulkEnrollmentSchema)) body: z.infer<typeof bulkEnrollmentSchema>) {
    return this.classes.bulkEnroll(user, body);
  }

  @Delete('enrollments/:id')
  @RequirePermissions('learner:manage')
  @ApiOperation({ summary: 'Withdraw / transfer an enrolment' })
  withdraw(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Query('status') status?: 'TRANSFERRED' | 'WITHDRAWN' | 'COMPLETED', @Query('reason') reason?: string) {
    return this.classes.withdrawEnrollment(user, id, status ?? 'TRANSFERRED', reason);
  }

  @Get('validation/enrollments')
  @RequirePermissions('class:manage')
  @ApiOperation({ summary: 'Detect duplicate or cross-year enrolments before timetable generation' })
  validateEnrollments(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId: string) {
    return this.classes.validateEnrollments(user, academicYearId);
  }
}
