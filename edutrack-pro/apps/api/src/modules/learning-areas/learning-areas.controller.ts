import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LEARNING_AREA_TEMPLATE } from '@edutrack/shared-config';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { bulkClassRequirementSchema, classRequirementSchema, learningAreaSchema, strandSchema, subStrandSchema } from '@edutrack/validation';
import type { z } from 'zod';
import { LearningAreasService } from './learning-areas.service';

@ApiTags('learning-areas')
@ApiBearerAuth()
@Controller('learning-areas')
export class LearningAreasController {
  constructor(private readonly service: LearningAreasService) {}

  @Get()
  @ApiOperation({ summary: 'List learning areas (school-configured catalogue)' })
  list(@CurrentUser() user: AuthPrincipal, @Query('search') search?: string) {
    return this.service.list(user, search);
  }

  @Post()
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Create a learning area' })
  create(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(learningAreaSchema)) body: z.infer<typeof learningAreaSchema>) {
    return this.service.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Update a learning area' })
  update(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(learningAreaSchema.partial())) body: Partial<z.infer<typeof learningAreaSchema>>) {
    return this.service.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Archive a learning area' })
  archive(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.service.archive(user, id);
  }

  @Get('template')
  @ApiOperation({ summary: 'Starter learning-area catalogue a school may import and then edit' })
  template() {
    return LEARNING_AREA_TEMPLATE;
  }

  @Post('import-template')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Import the starter catalogue (existing codes are left in place)' })
  importTemplate(@CurrentUser() user: AuthPrincipal, @Body() body: { areas?: { code: string; name: string; shortName?: string; colorHex?: string; isCore?: boolean }[] }) {
    return this.service.importTemplate(user, body.areas?.length ? body.areas : [...LEARNING_AREA_TEMPLATE]);
  }

  /* ------------------------------ strands ------------------------------ */

  @Get('strands')
  @ApiOperation({ summary: 'List strands and sub-strands (CBE curriculum structure)' })
  strands(@CurrentUser() user: AuthPrincipal, @Query('learningAreaId') learningAreaId?: string) {
    return this.service.listStrands(user, learningAreaId);
  }

  @Post('strands')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Create a strand' })
  createStrand(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(strandSchema)) body: Parameters<LearningAreasService['createStrand']>[1]) {
    return this.service.createStrand(user, body);
  }

  @Post('sub-strands')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Create a sub-strand' })
  createSubStrand(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(subStrandSchema)) body: Parameters<LearningAreasService['createSubStrand']>[1]) {
    return this.service.createSubStrand(user, body);
  }

  /* -------------------- weekly period requirements --------------------- */

  @Get('requirements')
  @ApiOperation({ summary: 'Weekly period allocation per class and learning area' })
  requirements(@CurrentUser() user: AuthPrincipal, @Query('classId') classId?: string) {
    return this.service.listRequirements(user, classId);
  }

  @Post('requirements')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Create or update one class/learning-area allocation' })
  upsertRequirement(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(classRequirementSchema)) body: Parameters<LearningAreasService['upsertRequirement']>[1]) {
    return this.service.upsertRequirement(user, body);
  }

  @Post('requirements/bulk')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Apply a set of allocations to several classes at once' })
  bulk(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(bulkClassRequirementSchema)) body: Parameters<LearningAreasService['bulkUpsertRequirements']>[1]) {
    return this.service.bulkUpsertRequirements(user, body);
  }

  @Delete('requirements/:id')
  @RequirePermissions('learning-area:manage')
  @ApiOperation({ summary: 'Remove an allocation' })
  deleteRequirement(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.service.deleteRequirement(user, id);
  }
}
