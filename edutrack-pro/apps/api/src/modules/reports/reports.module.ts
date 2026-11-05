import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * Reporting and exports.
 *
 *  * DashboardsModule exposes /reports/school plus the per-role dashboards.
 *  * AssessmentsModule exposes /results/learner/:id/progress for learner reports.
 *  * This module owns the audited administrator CSV exports (/reports/export/*).
 */
@Module({ controllers: [ExportsController], providers: [ExportsService] })
export class ReportsModule {}
