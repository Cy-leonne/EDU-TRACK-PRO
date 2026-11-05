import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { CurrentUser } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import {
  academicYearSchema, academicYearUpdateSchema, schoolProfileUpdateSchema, termSchema, termUpdateSchema,
} from '@edutrack/validation';
import { SchoolService } from './school.service';

@ApiTags('school')
@ApiBearerAuth()
@Controller('school')
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  @Get('bootstrap')
  @ApiOperation({ summary: 'School profile, calendar and grades needed to render the app shell' })
  bootstrap(@CurrentUser() user: AuthPrincipal) {
    return this.school.bootstrap(user);
  }

  @Get('profile')
  @ApiOperation({ summary: 'School profile' })
  getProfile(@CurrentUser() user: AuthPrincipal) {
    return this.school.getProfile(user.schoolId);
  }

  @Patch('profile')
  @RequirePermissions('school:write')
  @ApiOperation({ summary: 'Update school profile, calendar defaults and bell-schedule preferences' })
  updateProfile(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(schoolProfileUpdateSchema)) body: never) {
    return this.school.updateProfile(user, body as never);
  }

  @Get('academic-years')
  @ApiOperation({ summary: 'List academic years with their terms' })
  years(@CurrentUser() user: AuthPrincipal) {
    return this.school.listAcademicYears(user.schoolId);
  }

  @Post('academic-years')
  @RequirePermissions('calendar:manage')
  @ApiOperation({ summary: 'Create an academic year' })
  createYear(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(academicYearSchema)) body: never) {
    return this.school.createAcademicYear(user, body as never);
  }

  @Patch('academic-years/:id')
  @RequirePermissions('calendar:manage')
  @ApiOperation({ summary: 'Update an academic year (including marking it current)' })
  updateYear(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(academicYearUpdateSchema)) body: never) {
    return this.school.updateAcademicYear(user, id, body as never);
  }

  @Get('terms')
  @ApiOperation({ summary: 'List terms, optionally filtered by academic year' })
  terms(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId?: string) {
    return this.school.listTerms(user.schoolId, academicYearId);
  }

  @Post('terms')
  @RequirePermissions('calendar:manage')
  @ApiOperation({ summary: 'Create a term' })
  createTerm(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(termSchema)) body: never) {
    return this.school.createTerm(user, body as never);
  }

  @Patch('terms/:id')
  @RequirePermissions('calendar:manage')
  @ApiOperation({ summary: 'Update a term (including marking it current)' })
  updateTerm(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(termUpdateSchema)) body: never) {
    return this.school.updateTerm(user, id, body as never);
  }

  @Post('terms/:id/results-publication')
  @RequirePermissions('calendar:manage')
  @ApiOperation({ summary: 'Flag term results as released / unreleased' })
  setResultsPublication(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() body: { published: boolean }) {
    return this.school.setTermResultsPublication(user, id, !!body.published);
  }

  @Get('grades')
  @ApiOperation({ summary: 'List Junior School grades (7, 8, 9)' })
  grades(@CurrentUser() user: AuthPrincipal) {
    return this.school.listGrades(user.schoolId);
  }
}
