import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { teacherAssignmentSchema, teacherAvailabilitySchema } from '@edutrack/validation';
import { AssignmentsService } from './assignments.service';

@ApiTags('teacher-assignments')
@ApiBearerAuth()
@Controller('teacher-assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List teacher–class–learning-area assignments' })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query('teacherId') teacherId?: string,
    @Query('classId') classId?: string,
    @Query('learningAreaId') learningAreaId?: string,
  ) {
    return this.assignments.list(user, { teacherId, classId, learningAreaId });
  }

  @Post()
  @RequirePermissions('assignment:manage')
  @ApiOperation({ summary: 'Assign a teacher to a class + learning area (replaces an existing teacher for that pair)' })
  upsert(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(teacherAssignmentSchema)) body: z.infer<typeof teacherAssignmentSchema>) {
    return this.assignments.upsert(user, body);
  }

  @Delete(':id')
  @RequirePermissions('assignment:manage')
  @ApiOperation({ summary: 'Remove an assignment' })
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.assignments.remove(user, id);
  }

  @Get('me')
  @ApiOperation({ summary: 'My teaching profile: assignments, weekly load, limits' })
  me(@CurrentUser() user: AuthPrincipal) {
    return this.assignments.myTeachingProfile(user);
  }

  @Get('coverage')
  @RequirePermissions('assignment:manage')
  @ApiOperation({ summary: 'Validation: missing teachers, missing requirements, overloaded teachers' })
  coverage(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId: string) {
    return this.assignments.coverageCheck(user, academicYearId);
  }

  @Get('availability/:teacherId')
  @ApiOperation({ summary: 'Teacher availability grid' })
  availability(@CurrentUser() user: AuthPrincipal, @Param('teacherId') teacherId: string) {
    return this.assignments.getAvailability(user, teacherId);
  }

  @Post('availability')
  @RequirePermissions('teacher:manage')
  @ApiOperation({ summary: 'Replace a teacher’s weekly unavailable periods' })
  setAvailability(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(teacherAvailabilitySchema)) body: z.infer<typeof teacherAvailabilitySchema>) {
    return this.assignments.setAvailability(user, body);
  }
}
