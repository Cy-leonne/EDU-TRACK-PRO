import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { loadConfig } from './common/config/configuration';
import { AuditModule } from './common/audit/audit.module';
import { CsvModule } from './common/csv/csv.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { AuthGuard } from './common/guards/auth.guard';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { AuditControllerModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClassesModule } from './modules/classes/classes.module';
import { ClassTeacherModule } from './modules/class-teacher/class-teacher.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { LearningAreasModule } from './modules/learning-areas/learning-areas.module';
import { PeopleModule } from './modules/people/people.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { SchoolModule } from './modules/school/school.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { TimetablesModule } from './modules/timetables/timetables.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadConfig()], cache: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('auth.rateLimitWindowMs') ?? 900_000,
          limit: config.get<number>('auth.globalRateLimitMax') ?? 600,
        },
      ],
    }),
    PrismaModule,
    AuditModule,
    CsvModule,
    TenancyModule,
    NotificationsModule,
    AuthModule,
    SchoolModule,
    PeopleModule,
    ClassesModule,
    ClassTeacherModule,
    LearningAreasModule,
    AssignmentsModule,
    SubmissionsModule,
    FilesModule,
    AssessmentsModule,
    ResourcesModule,
    TimetablesModule,
    DashboardsModule,
    AuditControllerModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    // Global: rate limiting first, then authentication + role/permission checks.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  /**
   * Attaches a request id to every request so an error a user reports can be
   * correlated with server logs without exposing internals in the response.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
        next();
      })
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
