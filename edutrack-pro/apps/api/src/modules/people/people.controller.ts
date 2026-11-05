import {
  BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '@edutrack/shared-config';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import {
  createParentSchema, createTeacherSchema, learnerSchema, parentLearnerLinkSchema, updateParentSchema, updateTeacherSchema,
} from '@edutrack/validation';
import { PeopleService } from './people.service';

const uploadStorage = memoryStorage();

@ApiTags('people')
@ApiBearerAuth()
@Controller()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  /* ------------------------------- teachers ---------------------------- */

  @Get('teachers')
  @ApiOperation({ summary: 'List teachers with assignment counts and availability' })
  listTeachers(
    @CurrentUser() user: AuthPrincipal,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.people.listTeachers(user, { search, includeInactive: includeInactive === 'true' });
  }

  @Post('teachers')
  @RequirePermissions('teacher:manage')
  @ApiOperation({ summary: 'Create a teacher account (returns a one-time temporary password)' })
  createTeacher(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(createTeacherSchema)) body: z.infer<typeof createTeacherSchema>) {
    return this.people.createTeacher(user, body);
  }

  @Patch('teachers/:id')
  @RequirePermissions('teacher:manage')
  @ApiOperation({ summary: 'Update teacher details and scheduling limits' })
  updateTeacher(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(updateTeacherSchema)) body: z.infer<typeof updateTeacherSchema>) {
    return this.people.updateTeacher(user, id, body);
  }

  @Delete('teachers/:id')
  @RequirePermissions('teacher:manage')
  @ApiOperation({ summary: 'Deactivate a teacher (revokes sessions and assignments)' })
  deactivate(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Query('reason') reason?: string) {
    return this.people.deactivateTeacher(user, id, reason);
  }

  @Post('teachers/:id/reset-password')
  @RequirePermissions('teacher:manage')
  @ApiOperation({ summary: 'Generate a new temporary password for a teacher' })
  resetTeacherPassword(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.people.resetTeacherPassword(user, id);
  }

  @Get('teachers/import/template')
  @RequirePermissions('teacher:manage')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="teacher-import-template.csv"')
  @ApiOperation({ summary: 'Download the teacher CSV template' })
  teacherTemplate(@Res() res: Response) {
    res.send(this.people.teacherTemplate());
  }

  @Post('teachers/import')
  @RequirePermissions('teacher:manage')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import teachers from CSV (dryRun=true validates without writing)' })
  async importTeachers(@CurrentUser() user: AuthPrincipal, @UploadedFile() file: { buffer: Buffer }, @Query('dryRun') dryRun?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a CSV file.');
    return this.people.importTeachers(user, file.buffer, dryRun === 'true');
  }

  /* -------------------------------- parents ---------------------------- */

  @Get('parents')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'List parent accounts and their linked learners' })
  listParents(@CurrentUser() user: AuthPrincipal, @Query('search') search?: string, @Query('includeInactive') includeInactive?: string) {
    return this.people.listParents(user, { search, includeInactive: includeInactive === 'true' });
  }

  @Post('parents')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Create a parent account (returns a one-time temporary password)' })
  createParent(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(createParentSchema)) body: z.infer<typeof createParentSchema>) {
    return this.people.createParent(user, body);
  }

  @Patch('parents/:id')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Update parent contact details' })
  updateParent(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(updateParentSchema)) body: z.infer<typeof updateParentSchema>) {
    return this.people.updateParent(user, id, body);
  }

  @Post('parents/:id/reset-password')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Generate a new temporary password for a parent' })
  resetParentPassword(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.people.resetParentPassword(user, id);
  }

  /* -------------------------- parent <-> learner ----------------------- */

  @Get('parent-links')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'List parent–learner relationships, including unverified requests' })
  listLinks(
    @CurrentUser() user: AuthPrincipal,
    @Query('verified') verified?: string,
    @Query('learnerId') learnerId?: string,
    @Query('parentProfileId') parentProfileId?: string,
  ) {
    return this.people.listLinks(user, {
      verified: verified === undefined ? undefined : verified === 'true',
      learnerId,
      parentProfileId,
    });
  }

  @Post('parent-links')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Create or update a parent–learner link (optionally verified)' })
  createLink(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(parentLearnerLinkSchema)) body: z.infer<typeof parentLearnerLinkSchema>) {
    return this.people.createLink(user, body);
  }

  @Post('parent-links/:id/verify')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Verify a parent–learner relationship, granting access' })
  verifyLink(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: { method?: 'ADMIN_RECORD' | 'DOCUMENT' | 'ASSESSMENT_NUMBER_AND_ID' },
  ) {
    return this.people.verifyLink(user, id, body?.method ?? 'ADMIN_RECORD');
  }

  @Patch('parent-links/:id')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Adjust link permissions (results / resources visibility)' })
  updateLink(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: { canViewResults?: boolean; canViewResources?: boolean; isPrimaryContact?: boolean; relationship?: string },
  ) {
    return this.people.updateLinkPermissions(user, id, body);
  }

  @Delete('parent-links/:id')
  @RequirePermissions('parent:manage')
  @ApiOperation({ summary: 'Revoke a parent–learner link' })
  revokeLink(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Query('reason') reason?: string) {
    return this.people.revokeLink(user, id, reason);
  }

  @Post('parent-links/:id/correction-request')
  @ApiOperation({ summary: 'Parent asks the school to correct an incorrect relationship' })
  correctionRequest(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() body: { message: string }) {
    if (!body?.message || body.message.length < 10) throw new BadRequestException('Describe the correction needed (at least 10 characters).');
    return this.people.requestRelationshipCorrection(user, id, body.message);
  }

  /* ------------------------------- learners ---------------------------- */

  @Get('learners')
  @ApiOperation({ summary: 'List learners visible to the caller (admins: whole school; teachers: their classes; parents: linked learners)' })
  listLearners(
    @CurrentUser() user: AuthPrincipal,
    @Query('search') search?: string,
    @Query('gradeId') gradeId?: string,
    @Query('classId') classId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.people.listLearners(user, {
      search, gradeId, classId, status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('learners/:id')
  @ApiOperation({ summary: 'Learner detail with guardians, enrolment history and result count' })
  getLearner(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.people.getLearner(user, id);
  }

  @Post('learners')
  @RequirePermissions('learner:manage')
  @ApiOperation({ summary: 'Register a learner' })
  createLearner(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(learnerSchema)) body: z.infer<typeof learnerSchema>) {
    return this.people.createLearner(user, body);
  }

  @Patch('learners/:id')
  @RequirePermissions('learner:manage')
  @ApiOperation({ summary: 'Update learner details' })
  updateLearner(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(learnerSchema.partial())) body: Partial<z.infer<typeof learnerSchema>>) {
    return this.people.updateLearner(user, id, body);
  }

  @Get('learners/import/template')
  @RequirePermissions('learner:manage')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="learner-import-template.csv"')
  @ApiOperation({ summary: 'Download the learner CSV template' })
  learnerTemplate(@Res() res: Response) {
    res.send(this.people.learnerTemplate());
  }

  @Post('learners/import')
  @RequirePermissions('learner:manage')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import learners from CSV (dryRun=true validates without writing)' })
  async importLearners(@CurrentUser() user: AuthPrincipal, @UploadedFile() file: { buffer: Buffer }, @Query('dryRun') dryRun?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a CSV file.');
    return this.people.importLearners(user, file.buffer, dryRun === 'true');
  }
}
