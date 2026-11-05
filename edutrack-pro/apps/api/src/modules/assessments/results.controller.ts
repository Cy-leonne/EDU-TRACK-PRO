import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { amendResultSchema, bulkResultEntrySchema, feedbackSchema } from '@edutrack/validation';
import { ResultsService } from './results.service';

@ApiTags('results')
@ApiBearerAuth()
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('grid/:assessmentId')
  @RequirePermissions('result:enter')
  @ApiOperation({ summary: 'Spreadsheet-style results grid for an assessment (all enrolled learners)' })
  grid(@CurrentUser() user: AuthPrincipal, @Param('assessmentId') assessmentId: string) {
    return this.results.grid(user, assessmentId);
  }

  @Post('grid/:assessmentId')
  @RequirePermissions('result:enter')
  @ApiOperation({ summary: 'Save results (draft by default). Marks are validated against the assessment maximum.' })
  saveGrid(@CurrentUser() user: AuthPrincipal, @Param('assessmentId') assessmentId: string, @Body(zodPipe(bulkResultEntrySchema)) body: z.infer<typeof bulkResultEntrySchema>) {
    return this.results.saveGrid(user, assessmentId, body);
  }

  @Post('feedback')
  @RequirePermissions('result:enter')
  @ApiOperation({ summary: 'Add narrative feedback to a result' })
  feedback(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(feedbackSchema)) body: z.infer<typeof feedbackSchema>) {
    return this.results.addFeedback(user, body);
  }

  @Patch(':id/amend')
  @RequirePermissions('result:amend')
  @ApiOperation({ summary: 'Amend a published result with a mandatory reason (audited, guardians notified)' })
  amend(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body(zodPipe(amendResultSchema)) body: z.infer<typeof amendResultSchema>) {
    return this.results.amend(user, id, body);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Immutable change history for a result' })
  history(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.results.changeHistory(user, id);
  }

  @Get('learner/:learnerId')
  @ApiOperation({ summary: 'Results for a learner (parents: published only, linked learners only)' })
  learnerResults(
    @CurrentUser() user: AuthPrincipal,
    @Param('learnerId') learnerId: string,
    @Query('termId') termId?: string,
    @Query('learningAreaId') learningAreaId?: string,
  ) {
    return this.results.learnerResults(user, learnerId, { termId, learningAreaId });
  }

  @Get('learner/:learnerId/progress')
  @ApiOperation({ summary: 'Progress summary per learning area with trend' })
  progress(@CurrentUser() user: AuthPrincipal, @Param('learnerId') learnerId: string, @Query('termId') termId?: string) {
    return this.results.learnerProgress(user, learnerId, termId);
  }
}
