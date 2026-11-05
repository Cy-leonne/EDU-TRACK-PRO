import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RawResponse, RequirePermissions } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { ExportsService } from './exports.service';

/**
 * Authorised data exports.
 *
 * Exporting a whole school's records is a sensitive, auditable action: every
 * download below requires `export:school-data` (administrators only), writes an
 * audit row, and streams a CSV that contains no password material. Everything is
 * scoped to the caller's own school.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/export')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('learners.csv')
  @RawResponse()
  @RequirePermissions('export:school-data')
  @ApiOperation({ summary: 'Learner register (admission, assessment number, class, guardian links)' })
  async learners(@CurrentUser() user: AuthPrincipal, @Res({ passthrough: true }) res: Response) {
    return this.send(res, user, 'learners', await this.exports.learnersCsv(user));
  }

  @Get('teachers.csv')
  @RawResponse()
  @RequirePermissions('export:school-data')
  @ApiOperation({ summary: 'Teaching staff with weekly workload and assignment counts' })
  async teachers(@CurrentUser() user: AuthPrincipal, @Res({ passthrough: true }) res: Response) {
    return this.send(res, user, 'teachers', await this.exports.teachersCsv(user));
  }

  @Get('results.csv')
  @RawResponse()
  @RequirePermissions('export:school-data')
  @ApiQuery({ name: 'termId', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiOperation({ summary: 'Assessment results (published and draft) with a school-defined band column' })
  async results(
    @CurrentUser() user: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
    @Query('termId') termId?: string,
    @Query('classId') classId?: string,
  ) {
    return this.send(res, user, 'results', await this.exports.resultsCsv(user, { termId, classId }));
  }

  @Get('timetable.csv')
  @RawResponse()
  @RequirePermissions('export:school-data')
  @ApiQuery({ name: 'versionId', required: false, description: 'Defaults to the currently published version' })
  @ApiOperation({ summary: 'Published timetable as one row per lesson' })
  async timetable(@CurrentUser() user: AuthPrincipal, @Res({ passthrough: true }) res: Response, @Query('versionId') versionId?: string) {
    return this.send(res, user, 'timetable', await this.exports.timetableCsv(user, versionId));
  }

  private async send(res: Response, user: AuthPrincipal, name: string, csv: { filename: string; body: string }) {
    await this.exports.recordExport(user, name, csv.filename);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return csv.body;
  }
}
