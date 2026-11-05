import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadConfig } from './common/config/configuration';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/**
 * Everything that turns a bare Nest application into the EduTrack Pro API.
 * Shared by `main.ts` (production/dev) and the automated tests, so the tests
 * exercise exactly the same middleware, prefix, validation and error shape.
 */
export function configureApp(app: INestApplication, options: { docs?: boolean } = {}): void {
  const config = loadConfig();
  const embedAncestors = config.embedAncestors;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'"], // Swagger UI ships its own bundle
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          // Framing is refused unless EMBED_ALLOWED_ORIGINS names the parent
          // origin (hosted preview/sandbox environments only).
          frameAncestors: embedAncestors.length ? ["'self'", ...embedAncestors] : ["'none'"],
        },
      },
      // X-Frame-Options has no wildcard syntax, so it is dropped only when an
      // explicit ancestor allow-list is configured (CSP still governs framing).
      frameguard: embedAncestors.length ? false : { action: 'sameorigin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.setGlobalPrefix(config.apiPrefix.replace(/^\//, ''), { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false, forbidUnknownValues: false }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (options.docs === false) return;

  // A tiny service banner at "/" so that opening the API host in a browser
  // explains what it is instead of showing a bare 404. No scripts, no external
  // assets, so the strict CSP above needs no exceptions.
  const expressInstance = app.getHttpAdapter().getInstance() as {
    get: (path: string, handler: (req: unknown, res: { type: (v: string) => { send: (b: string) => void } }) => void) => void;
  };
  expressInstance.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EduTrack Pro API</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem; }
      h1 { font-size: 1.6rem; margin: 0 0 .25rem; color: #12304a; }
      p { line-height: 1.6; color: #334155; }
      ul { line-height: 2; }
      a { color: #0f766e; }
      code { background: #e2e8f0; padding: .1rem .35rem; border-radius: 4px; }
      .tag { display: inline-block; font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: #0f766e; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <span class="tag">Kenyan Junior School · Grades 7–9</span>
      <h1>EduTrack Pro API</h1>
      <p>
        This is the REST API of the EduTrack Pro platform (school administration, competency-based
        assessment records, learning resources and the timetable engine). It returns JSON only —
        the user interface is a separate Next.js app.
      </p>
      <ul>
        <li><a href="${config.apiPrefix}/docs">Interactive API documentation (Swagger UI)</a> — start here</li>
        <li><a href="${config.apiPrefix}/health">Health probe</a></li>
      </ul>
      <p>
        Assessment numbers, marks and achievement bands in this system are the school's own internal
        records. They are not official KNEC/KICD outcomes.
      </p>
    </main>
  </body>
</html>`);
  });

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('EduTrack Pro API')
    .setDescription(
      [
        'Kenyan Junior School (Grade 7–9) assessment, learning and timetable platform.',
        '',
        '**Authentication** — email + password returns a short-lived access token and a rotating refresh token.',
        'The web client keeps them in httpOnly cookies set by the Next.js server; the mobile client stores them in secure storage and sends `Authorization: Bearer <token>`.',
        '',
        '**Authorization** — every endpoint enforces the caller’s role, permissions AND their relationship to the requested school/class/learner/assessment.',
        'A caller who guesses another school’s or another family’s id receives 404 or 403, never data.',
        '',
        '**Assessment records** — internal school assessments only. Nothing in this API represents official KNEC/KICD outcomes.',
        'Achievement bands are school-defined and configurable.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('auth', 'Sign-in, sessions, password reset, first-run setup')
    .addTag('school', 'School profile, academic calendar, grades')
    .addTag('people', 'Teachers, parents, learners, parent–learner links, CSV import')
    .addTag('classes', 'Classes, enrolment, class roster')
    .addTag('learning-areas', 'Learning areas, strands, weekly period requirements')
    .addTag('teacher-assignments', 'Teaching assignments, availability, coverage validation')
    .addTag('assessments', 'Assessment lifecycle, categories, rubrics, achievement bands')
    .addTag('results', 'Result entry grid, publication, amendment history')
    .addTag('resources', 'Learning resources and assignments')
    .addTag('timetables', 'Bell schedule, generation, validation, editing, publication, versioning')
    .addTag('files', 'Private uploads and authorised downloads')
    .addTag('dashboards', 'Role-specific dashboards and school reports')
    .addTag('notifications', 'In-app notification inbox')
    .addTag('audit-logs', 'Sensitive-operation audit trail')
    .addTag('health', 'Service probes')
    .build(), { operationIdFactory: (controller, method) => `${controller}_${method}` });

  SwaggerModule.setup(`${config.apiPrefix.replace(/^\//, '')}/docs`, app, document, {
    customSiteTitle: 'EduTrack Pro API',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true },
  });
}
