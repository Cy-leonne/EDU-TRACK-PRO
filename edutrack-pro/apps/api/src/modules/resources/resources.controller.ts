import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { assignmentSchema, learningResourceSchema, learningResourceUpdateSchema } from '@edutrack/validation';
import { ResourcesService } from './resources.service';

@ApiTags('resources')
@ApiBearerAuth()
@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: 'Learning resources visible to the caller (parents: published, for their linked learners only)' })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query('classId') classId?: string,
    @Query('learningAreaId') learningAreaId?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.resources.list(user, { classId, learningAreaId, type, search, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Get('assignments')
  @ApiOperation({ summary: 'Assignments visible to the caller' })
  assignments(
    @CurrentUser() user: AuthPrincipal,
    @Query('classId') classId?: string,
    @Query('learningAreaId') learningAreaId?: string,
    @Query('upcomingOnly') upcomingOnly?: string,
  ) {
    return this.resources.listAssignments(user, { classId, learningAreaId, upcomingOnly: upcomingOnly === 'true' });
  }

  @Post('assignments')
  @RequirePermissions('resource:create')
  @ApiOperation({ summary: 'Create an assignment for a class and learning area you teach' })
  createAssignment(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(assignmentSchema)) body: z.infer<typeof assignmentSchema>) {
    return this.resources.createAssignment(user, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One learning resource (404 when out of scope)' })
  get(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.resources.get(user, id);
  }

  @Post()
  @RequirePermissions('resource:create')
  @ApiOperation({ summary: 'Publish a note, PDF/image or link to a class (attachments go through /files/upload first)' })
  create(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(learningResourceSchema)) body: z.infer<typeof learningResourceSchema>) {
    return this.resources.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('resource:create')
  @ApiOperation({ summary: 'Update a resource you published' })
  update(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(learningResourceUpdateSchema)) body: z.infer<typeof learningResourceUpdateSchema>) {
    return this.resources.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('resource:create')
  @ApiOperation({ summary: 'Archive a resource' })
  archive(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.resources.archive(user, id);
  }
}
