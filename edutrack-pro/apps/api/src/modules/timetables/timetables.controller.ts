import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import {
  generateTimetableSchema, roomSchema, timetableBellScheduleSchema, timetableEntryMoveSchema, timetableEntrySchema, timetablePublishSchema, timetableSchema,
} from '@edutrack/validation';
import { TimetablesService } from './timetables.service';

@ApiTags('timetables')
@ApiBearerAuth()
@Controller('timetables')
export class TimetablesController {
  constructor(private readonly timetables: TimetablesService) {}

  /* --------------------------- configuration --------------------------- */

  @Get('periods')
  @ApiOperation({ summary: 'Bell schedule (periods, breaks, lunch) for an academic year' })
  periods(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId: string) {
    return this.timetables.listPeriods(user, academicYearId);
  }

  @Get('periods/default')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Propose a bell schedule built from the school profile (days, times, breaks, lunch)' })
  defaultSchedule(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId: string, @Query('termId') termId?: string) {
    return this.timetables.buildDefaultSchedule(user, { academicYearId, termId });
  }

  @Post('periods')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Save the bell schedule (replaces the existing grid for the academic year)' })
  savePeriods(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(timetableBellScheduleSchema)) body: z.infer<typeof timetableBellScheduleSchema>) {
    return this.timetables.saveBellSchedule(user, body);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'List rooms / facilities' })
  rooms(@CurrentUser() user: AuthPrincipal) {
    return this.timetables.listRooms(user);
  }

  @Post('rooms')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Create or update a room (optional room scheduling)' })
  upsertRoom(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(roomSchema.extend({ id: roomSchema.shape.name.optional() }) as never)) body: never) {
    return this.timetables.upsertRoom(user, body as never);
  }

  /* ----------------------------- generation ---------------------------- */

  @Get('preflight')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Step 1: inspect the data generation will use and any blocking problems' })
  preflight(
    @CurrentUser() user: AuthPrincipal,
    @Query('academicYearId') academicYearId: string,
    @Query('termId') termId?: string,
    @Query('classIds') classIds?: string,
  ) {
    return this.timetables.preflight(user, { academicYearId, termId, classIds: classIds ? classIds.split(',').filter(Boolean) : undefined });
  }

  @Post('generate')
  @RequirePermissions('timetable:generate')
  @ApiOperation({
    summary: 'Step 2: run the constraint-aware generator and save the result as a new draft version',
    description:
      'Hard constraints (teacher/class/room clashes, breaks, availability, workload caps, missing assignments) are never violated. ' +
      'Anything that cannot be placed is returned in `diagnostics` with a suggested remedy instead of being scheduled anyway.',
  })
  generate(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(generateTimetableSchema)) body: z.infer<typeof generateTimetableSchema>) {
    return this.timetables.generate(user, body);
  }

  @Post(':versionId/validate')
  @RequirePermissions('timetable:validate')
  @ApiOperation({ summary: 'Re-run validation, persist the conflict list and update the version status' })
  validate(@CurrentUser() user: AuthPrincipal, @Param('versionId') versionId: string) {
    return this.timetables.validateVersion(user, versionId, { persist: true });
  }

  @Get(':versionId/conflicts')
  @ApiOperation({ summary: 'Conflict panel data with class/teacher/period context and suggestions' })
  conflicts(@CurrentUser() user: AuthPrincipal, @Param('versionId') versionId: string) {
    return this.timetables.conflictContext(user, versionId);
  }

  /* -------------------------------- views ------------------------------ */

  @Get()
  @ApiOperation({ summary: 'List timetables with their version history' })
  list(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId?: string, @Query('termId') termId?: string, @Query('status') status?: string) {
    return this.timetables.list(user, { academicYearId, termId, status });
  }

  @Post()
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Create an empty timetable container (a version is created automatically)' })
  create(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(timetableSchema)) body: z.infer<typeof timetableSchema>) {
    return this.timetables.create(user, body);
  }

  @Get('me')
  @ApiOperation({ summary: 'My teaching timetable (teachers and admins)' })
  myTimetable(@CurrentUser() user: AuthPrincipal, @Query('academicYearId') academicYearId?: string, @Query('termId') termId?: string) {
    return this.timetables.myTimetable(user, { academicYearId, termId });
  }

  @Get('learner/:learnerId')
  @ApiOperation({ summary: 'Published class timetable for a linked learner (parents)' })
  learnerTimetable(@CurrentUser() user: AuthPrincipal, @Param('learnerId') learnerId: string, @Query('academicYearId') academicYearId?: string, @Query('termId') termId?: string) {
    return this.timetables.learnerTimetable(user, learnerId, { academicYearId, termId });
  }

  @Get('versions/:versionId')
  @ApiOperation({ summary: 'Weekly grid for a version, optionally filtered by class, teacher or room' })
  view(
    @CurrentUser() user: AuthPrincipal,
    @Param('versionId') versionId: string,
    @Query('classId') classId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.timetables.getVersionView(user, versionId, { classId, teacherId, roomId });
  }

  @Get('versions/:versionId/school-grid')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Whole-school grid (all classes) for administration review' })
  schoolGrid(@CurrentUser() user: AuthPrincipal, @Param('versionId') versionId: string) {
    return this.timetables.schoolGrid(user, versionId);
  }

  @Get('timetables/:timetableId/history')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Version history and audit trail for a timetable' })
  history(@CurrentUser() user: AuthPrincipal, @Param('timetableId') timetableId: string) {
    return this.timetables.versionHistory(user, timetableId);
  }

  /* --------------------------- manual editing -------------------------- */

  @Post('versions/:versionId/entries')
  @RequirePermissions('timetable:edit')
  @ApiOperation({ summary: 'Add a lesson to a draft version (validated immediately)' })
  addEntry(@CurrentUser() user: AuthPrincipal, @Param('versionId') versionId: string, @Body(zodPipe(timetableEntrySchema)) body: z.infer<typeof timetableEntrySchema>) {
    return this.timetables.addEntry(user, versionId, body);
  }

  @Patch('entries/move')
  @RequirePermissions('timetable:edit')
  @ApiOperation({ summary: 'Move a lesson or change its teacher; hard conflicts are rejected and the result is revalidated' })
  move(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(timetableEntryMoveSchema)) body: z.infer<typeof timetableEntryMoveSchema>) {
    return this.timetables.moveEntry(user, body);
  }

  @Patch('entries/:entryId/lock')
  @RequirePermissions('timetable:edit')
  @ApiOperation({ summary: 'Lock or unlock a lesson so regeneration keeps it in place' })
  lock(@CurrentUser() user: AuthPrincipal, @Param('entryId') entryId: string, @Body() body: { isLocked: boolean }) {
    return this.timetables.toggleLock(user, entryId, !!body.isLocked);
  }

  @Delete('entries/:entryId')
  @RequirePermissions('timetable:edit')
  @ApiOperation({ summary: 'Remove a lesson from a draft version' })
  deleteEntry(@CurrentUser() user: AuthPrincipal, @Param('entryId') entryId: string) {
    return this.timetables.deleteEntry(user, entryId);
  }

  /* ----------------------------- publication --------------------------- */

  @Post('publish')
  @RequirePermissions('timetable:publish')
  @ApiOperation({
    summary: 'Publish a validated version (only administrators)',
    description: 'Hard conflicts block publication unconditionally. Publishing supersedes the previous version, which is kept for audit.',
  })
  publish(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(timetablePublishSchema)) body: z.infer<typeof timetablePublishSchema>) {
    return this.timetables.publish(user, body);
  }

  @Post('versions/:versionId/unpublish')
  @RequirePermissions('timetable:publish')
  @ApiOperation({ summary: 'Withdraw a published version and notify affected teachers' })
  unpublish(@CurrentUser() user: AuthPrincipal, @Param('versionId') versionId: string, @Body() body: { reason: string }) {
    return this.timetables.unpublish(user, versionId, body?.reason ?? 'Withdrawn by administrator');
  }

  @Post('versions/:versionId/duplicate')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Duplicate a version (e.g. last term) into a new draft, revalidated from scratch' })
  duplicate(@CurrentUser() user: AuthPrincipal, @Param('versionId') versionId: string, @Body() body: { notes?: string }) {
    return this.timetables.duplicateVersion(user, versionId, body?.notes);
  }

  @Delete('timetables/:timetableId')
  @RequirePermissions('timetable:generate')
  @ApiOperation({ summary: 'Archive a timetable' })
  archive(@CurrentUser() user: AuthPrincipal, @Param('timetableId') timetableId: string, @Query('reason') reason?: string) {
    return this.timetables.archive(user, timetableId, reason);
  }
}
