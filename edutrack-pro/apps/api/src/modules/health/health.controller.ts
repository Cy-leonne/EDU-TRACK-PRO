import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { APP_VERSION } from '@edutrack/shared-config';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity probe' })
  async health() {
    let database = 'ok';
    let databaseError: string | null = null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      database = 'unavailable';
      // Never leak connection strings or credentials in the probe response.
      databaseError = (error as Error).name ?? 'DatabaseError';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      version: APP_VERSION,
      environment: process.env.NODE_ENV ?? 'development',
      time: new Date().toISOString(),
      checks: { database, databaseError },
    };
  }
}
