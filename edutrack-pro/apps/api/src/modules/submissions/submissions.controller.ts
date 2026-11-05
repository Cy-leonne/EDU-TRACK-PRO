import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { submissionCreateSchema, submissionQuerySchema, submissionReviewSchema } from '@edutrack/validation';
import { SubmissionsService } from './submissions.service';

@ApiTags('submissions')
@ApiBearerAuth()
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  @RequirePermissions('submission:read')
  @ApiOperation({
    summary: 'Assignment hand-ins visible to me (guardians: only their linked learners; teachers: only their classes)',
  })
  list(@CurrentUser() user: AuthPrincipal, @Query(zodPipe(submissionQuerySchema)) query: z.infer<typeof submissionQuerySchema>) {
    return this.submissions.list(user, query);
  }

  @Get('summary/:assignmentId')
  @RequirePermissions('submission:read')
  @ApiOperation({ summary: 'Who has handed in for an assignment, who is missing, and how many were late' })
  summary(@CurrentUser() user: AuthPrincipal, @Param('assignmentId') assignmentId: string) {
    return this.submissions.assignmentSummary(user, assignmentId);
  }

  @Get(':id')
  @RequirePermissions('submission:read')
  @ApiOperation({ summary: 'One hand-in (file reference is authorised separately via /files/:id/download)' })
  get(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.submissions.get(user, id);
  }

  @Post()
  @RequirePermissions('submission:create')
  @ApiOperation({
    summary: 'Record a hand-in for a learner',
    description:
      'Learners have no logins, so a guardian (for a verified linked learner) or a teacher (for a class they teach) ' +
      'uploads the work on the learner’s behalf. Re-submitting replaces the previous hand-in until the teacher accepts it.',
  })
  create(@CurrentUser() user: AuthPrincipal, @Body(zodPipe(submissionCreateSchema)) body: z.infer<typeof submissionCreateSchema>) {
    return this.submissions.create(user, body);
  }

  @Patch(':id/review')
  @RequirePermissions('submission:review')
  @ApiOperation({ summary: 'Teacher decision: reviewed, accepted, or returned for rework (guardians are notified)' })
  review(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(submissionReviewSchema)) body: z.infer<typeof submissionReviewSchema>,
  ) {
    return this.submissions.review(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('submission:create')
  @ApiOperation({ summary: 'Withdraw a hand-in before the teacher accepts it (only your own upload)' })
  withdraw(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.submissions.withdraw(user, id);
  }
}
