import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './common/config/configuration';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Structured logs only: request bodies (which can contain learner data) are never logged.
    logger: ['error', 'warn', 'log'],
    cors: {
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    },
    bodyParser: true,
  });

  configureApp(app);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API listening on http://0.0.0.0:${config.port}${config.apiPrefix}`);
  logger.log(`OpenAPI docs: http://localhost:${config.port}${config.apiPrefix}/docs`);
  logger.log(`Storage driver: ${config.storage.driver} | Email provider: ${config.email.provider}`);
  if (config.env !== 'production' && config.initialAdminSetupToken) {
    logger.warn('First-run admin setup is enabled (INITIAL_ADMIN_SETUP_TOKEN is set). Disable it in production.');
  }
}

void bootstrap();
