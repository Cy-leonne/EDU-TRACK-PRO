import { isTeacherRole } from '@edutrack/shared-config';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { assessmentSchema, assessmentStatusSchema, assessmentUpdateSchema, rubricSchema } from '@edutrack/validation';
import { AssessmentsService } from './assessments.service';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantIsolationException } from '../../common/errors/domain-errors';

@ApiTags('assessments')
@ApiBearerAuth()
@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ----------------------------- catalogue ----------------------------- */

  @Get('categories')
  @ApiOperation({ summary: 'School-configured assessment categories (CAT, quiz, project, ...)' })
  categories(@CurrentUser() user: AuthPrincipal) {
    return this.assessments.listCategories(user);
  }

  @Post('categories')
  @RequirePermissions('school:write')
  @ApiOperation({ summary: 'Create or update an assessment category' })
  upsertCategory(@CurrentUser() user: AuthPrincipal, @Body() body: { code: string; name: string; allowsMarks?: boolean; allowsRubric?: boolean; defaultMaxMarks?: number | null; description?: string }) {
    return this.assessments.upsertCategory(user, body);
  }

  @Get('achievement-levels')
  @ApiOperation({ summary: 'School-defined achievement bands (not official national levels)' })
  achievementLevels(@CurrentUser() user: AuthPrincipal) {
    return this.assessments.listAchievementLevels(user);
  }

  @Post('achievement-levels')
  @RequirePermissions('school:write')
  @ApiOperation({ summary: 'Create or update an achievement band' })
  upsertAchievementLevel(@CurrentUser() user: AuthPrincipal, @Body() body: { code: string; label: string; minPercent: number; maxPercent: number; description?: string }) {
    return this.assessments.upsertAchievementLevel(user, body);
  }

  @Get('rubrics')
  @ApiOperation({ summary: 'Rubric templates and criteria' })
  rubrics(@CurrentUser() user: AuthPrincipal, @Query('learningAreaId') learningAreaId?: string) {
    return this.assessments.listRubrics(user, learningAreaId);
  }

  @Post('rubrics')
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Create a rubric with criteria and achievement levels' })
  createRubric(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(rubricSchema)) body: z.infer<typeof rubricSchema>) {
    return this.assessments.createRubric(user, body);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Assessment dashboard: due soon, drafts, published, missing results' })
  dashboard(@CurrentUser() user: AuthPrincipal) {
    return this.assessments.dashboard(user);
  }

  /* ---------------------------- assessments ---------------------------- */

  @Get()
  @ApiOperation({ summary: 'List assessments visible to the caller' })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query('classId') classId?: string,
    @Query('learningAreaId') learningAreaId?: string,
    @Query('termId') termId?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.assessments.list(user, {
      classId, learningAreaId, termId, status, categoryId, search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Assessment detail including resources and completion summary' })
  get(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.assessments.get(user, id);
  }

  @Post()
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Create an assessment for a class + learning area you teach' })
  create(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(assessmentSchema)) body: z.infer<typeof assessmentSchema>) {
    return this.assessments.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Update a draft assessment' })
  update(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(assessmentUpdateSchema)) body: z.infer<typeof assessmentUpdateSchema>) {
    return this.assessments.update(user, id, body);
  }

  @Post(':id/status')
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Move an assessment through the lifecycle (draft → review → published → corrected)' })
  status(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(assessmentStatusSchema)) body: z.infer<typeof assessmentStatusSchema>) {
    return this.assessments.changeStatus(user, id, body);
  }

  @Post(':id/publish')
  @RequirePermissions('result:publish')
  @ApiOperation({ summary: 'Publish results so guardians can see them (transactional + audited + notified)' })
  publish(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: { reason?: string; notifyParents?: boolean },
  ) {
    return this.assessments.publish(user, id, body?.reason, body?.notifyParents ?? true);
  }

  /* ------------------------------ resources ---------------------------- */

  @Post(':id/resources')
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Attach an uploaded file or link to an assessment' })
  async attachResource(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: { fileId?: string; title?: string; kind?: string; externalUrl?: string },
  ) {
    const assessment = await this.prisma.assessment.findFirst({ where: { id, schoolId: user.schoolId }, include: { class: true, learningArea: true } });
    if (!assessment) throw new TenantIsolationException('Assessment');
    if (isTeacherRole(user.role) && assessment.createdById !== user.userId) {
      await this.prisma.teacherAssignment.findFirstOrThrow({ where: { teacherId: (await this.prisma.teacherProfile.findFirstOrThrow({ where: { userId: user.userId } })).id, classId: assessment.classId, learningAreaId: assessment.learningAreaId, isActive: true } });
    }
    if (assessment.status === 'PUBLISHED' || assessment.status === 'CORRECTED') {
      throw new TenantIsolationException('Published assessment (resources are locked; create a new assessment instead)');
    }
    const resource = await this.prisma.assessmentResource.create({
      data: {
        assessmentId: id,
        fileId: body.fileId || null,
        title: body.title || null,
        kind: body.kind ?? (body.fileId ? 'DOCUMENT' : 'LINK'),
        externalUrl: body.externalUrl || null,
      },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'assessment.resource.attached',
      entityType: 'AssessmentResource', entityId: resource.id, summary: `Attached to "${assessment.title}"`,
    });
    return resource;
  }

  @Delete('resources/:resourceId')
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Detach a resource from an assessment' })
  async removeResource(@CurrentUser() user: AuthPrincipal, @Param('resourceId') resourceId: string) {
    const resource = await this.prisma.assessmentResource.findFirst({
      where: { id: resourceId, assessment: { schoolId: user.schoolId } },
      include: { assessment: { select: { title: true, createdById: true } } },
    });
    if (!resource) throw new TenantIsolationException('Assessment resource');
    await this.prisma.assessmentResource.delete({ where: { id: resourceId } });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'assessment.resource.removed',
      entityType: 'AssessmentResource', entityId: resourceId, summary: `Detached from "${resource.assessment.title}"`,
    });
    return { removed: true };
  }

  @Post('resources/upload')
  @RequirePermissions('assessment:create')
  @ApiOperation({ summary: 'Upload a PDF/image for an assessment (private storage, signature-validated)' })
  async uploadResource() {
    // Multipart handling lives in FilesController; the client uploads first and
    // then calls POST :id/resources with the returned fileId.
    return { hint: 'POST /api/v1/files/upload (purpose=ASSESSMENT), then POST /api/v1/assessments/:id/resources with the fileId.' };
  }
}
