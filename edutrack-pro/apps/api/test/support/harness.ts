import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PasswordService } from '../../src/modules/auth/password.service';

/**
 * Integration harness.
 *
 * Boots the real Nest application against the dedicated test database and talks
 * to it over real HTTP (supertest), so guards, pipes, filters, interceptors and
 * the Prisma layer are all exercised exactly as in production.
 */

export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
  schoolId: string;
}

export interface TestSchool {
  id: string;
  teacherProfileId: string;
  parentProfileId: string;
  teacherAssignmentId: string;
  admin: TestUser;
  teacher: TestUser;
  parent: TestUser;
  academicYearId: string;
  termId: string;
  gradeId: string;
  classId: string;
  learningAreaId: string;
  categoryId: string;
  learnerId: string;
  linkId: string;
}

export const TEST_PASSWORD = 'Integration-Test-Pass!2026';

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { docs: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready?.();
  const prisma = app.get(PrismaService);
  return { app, prisma };
}

/** Empties every application table (keeps the migration history). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Thin HTTP helper: unwraps the API's { success, data } envelope and adds the API prefix. */
export function http(app: INestApplication) {
  const server = app.getHttpServer();
  const prefix = (process.env.API_PREFIX ?? '/api/v1').replace(/\/$/, '');
  const call = async (method: 'get' | 'post' | 'patch' | 'delete', rawPath: string, options: { token?: string; body?: unknown } = {}) => {
    const path = rawPath.startsWith(prefix) ? rawPath : `${prefix}${rawPath}`;
    let req = request(server)[method](path);
    if (options.token) req = req.set('Authorization', `Bearer ${options.token}`);
    if (options.body !== undefined) req = req.send(options.body as object);
    const response = await req;
    return {
      status: response.status,
      headers: response.headers as Record<string, string>,
      body: response.body as Record<string, unknown>,
      // Raw response text — needed for CSV downloads, where supertest does not parse
      // a body for the caller.
      text: typeof response.text === 'string' ? response.text : Buffer.isBuffer(response.body) ? response.body.toString('utf8') : '',
      data: (response.body as { data?: unknown })?.data as never,
    };
  };
  return {
    get: (path: string, token?: string) => call('get', path, { token }),
    post: (path: string, body?: unknown, token?: string) => call('post', path, { body, token }),
    patch: (path: string, body?: unknown, token?: string) => call('patch', path, { body, token }),
    del: (path: string, token?: string) => call('delete', path, { token }),
    upload: async (rawPath: string, token: string, file: { name: string; type: string; content: Buffer }, fields: Record<string, string> = {}) => {
      const path = rawPath.startsWith(prefix) ? rawPath : `${prefix}${rawPath}`;
      const req = request(server).post(path).set('Authorization', `Bearer ${token}`).attach('file', file.content, { filename: file.name, contentType: file.type });
      for (const [key, value] of Object.entries(fields)) req.field(key, value);
      const response = await req;
      return {
        status: response.status,
        headers: response.headers as Record<string, string>,
        body: response.body as Record<string, unknown>,
        text: typeof response.text === 'string' ? response.text : Buffer.isBuffer(response.body) ? response.body.toString('utf8') : '',
        data: (response.body as { data?: unknown })?.data as never,
      };
    },
  };
}

/**
 * Creates an isolated school with one admin, one teacher, one parent, one class,
 * one learner and a verified parent–learner link. Used to prove tenant isolation:
 * nothing belonging to this school may be visible from another one.
 */
export async function createSchool(
  app: INestApplication,
  api: ReturnType<typeof http>,
  label: string,
): Promise<TestSchool> {
  const prisma = app.get(PrismaService);
  const passwords = app.get(PasswordService);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const password = TEST_PASSWORD;

  const school = await prisma.school.create({
    data: {
      name: `Test School ${label}`,
      code: `TEST-${slug}`.slice(0, 32),
      workingDays: [1, 2, 3, 4, 5],
      schoolOpenTime: '07:30',
      schoolCloseTime: '15:30',
      defaultPeriodMinutes: 40,
      maxPeriodsPerDay: 6,
      timezone: 'Africa/Nairobi',
    },
  });

  const makeUser = async (role: 'ADMIN' | 'TEACHER' | 'PARENT', name: string) => {
    const email = `${role.toLowerCase()}.${slug}@test.school`;
    const user = await prisma.user.create({
      data: { email, fullName: name, passwordHash: await passwords.hash(password), memberships: { create: { schoolId: school.id, role, status: 'ACTIVE' } } },
    });
    return user;
  };

  const adminUser = await makeUser('ADMIN', `Admin ${label}`);
  const teacherUser = await makeUser('TEACHER', `Teacher ${label}`);
  const parentUser = await makeUser('PARENT', `Parent ${label}`);
  const teacherProfile = await prisma.teacherProfile.create({ data: { userId: teacherUser.id, schoolId: school.id, staffNumber: `T-${slug}`, maxPeriodsPerDay: 6, maxPeriodsPerWeek: 30 } });
  const parentProfile = await prisma.parentProfile.create({ data: { userId: parentUser.id, schoolId: school.id, relationship: 'Mother' } });

  const academicYear = await prisma.academicYear.create({ data: { schoolId: school.id, name: '2026', startDate: new Date('2026-01-05'), endDate: new Date('2026-10-30'), isCurrent: true } });
  const term = await prisma.term.create({ data: { schoolId: school.id, academicYearId: academicYear.id, number: 1, name: 'Term 1', startDate: new Date('2026-01-05'), endDate: new Date('2026-04-03'), isCurrent: true } });
  await prisma.school.update({ where: { id: school.id }, data: { currentAcademicYearId: academicYear.id, currentTermId: term.id } });

  const grade = await prisma.grade.create({ data: { schoolId: school.id, level: 7, name: 'Grade 7', order: 0 } });
  const klass = await prisma.class.create({ data: { schoolId: school.id, academicYearId: academicYear.id, gradeId: grade.id, name: `Grade 7 ${label}`, capacity: 40 } });
  const learningArea = await prisma.learningArea.create({ data: { schoolId: school.id, code: 'MAT', name: 'Mathematics', defaultPeriodsPerWeek: 5 } });
  const category = await prisma.assessmentCategory.create({ data: { schoolId: school.id, code: 'CAT', name: 'Continuous Assessment Test', allowsMarks: true, allowsRubric: true } });
  const learner = await prisma.learner.create({
    data: {
      schoolId: school.id, admissionNumber: `ADM-${slug}`.slice(0, 30), assessmentNumber: `AN-${slug}`.slice(0, 32),
      firstName: 'Achieng', lastName: `Otieno${label}`, gender: 'FEMALE', gradeId: grade.id, currentClassId: klass.id, status: 'ACTIVE',
    },
  });
  await prisma.classEnrollment.create({ data: { schoolId: school.id, learnerId: learner.id, classId: klass.id, academicYearId: academicYear.id, termId: term.id, createdById: adminUser.id } });
  // A teacher is assigned to the class + learning area so that "only teachers who
  // teach this class/area" rules can be exercised, not just the role check.
  const teacherAssignment = await prisma.teacherAssignment.create({
    data: { schoolId: school.id, teacherId: teacherProfile.id, classId: klass.id, learningAreaId: learningArea.id, isPrimary: true, lessonsPerWeek: 5 },
  });

  const link = await prisma.parentLearnerLink.create({
    data: { schoolId: school.id, parentProfileId: parentProfile.id, learnerId: learner.id, relationship: 'Mother', isVerified: true, verificationMethod: 'ADMIN_RECORD', verifiedAt: new Date(), verifiedById: adminUser.id },
  });

  const loginAs = async (email: string): Promise<TestUser> => {
    const response = await api.post('/auth/login', { email, password, clientType: 'MOBILE' });
    if (response.status !== 200) throw new Error(`login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
    const data = response.data as unknown as { accessToken: string; user: { id: string } };
    return { id: data.user.id, email, password, token: data.accessToken, schoolId: school.id };
  };

  return {
    id: school.id,
    teacherProfileId: teacherProfile.id,
    parentProfileId: parentProfile.id,
    teacherAssignmentId: teacherAssignment.id,
    admin: await loginAs(adminUser.email),
    teacher: await loginAs(teacherUser.email),
    parent: await loginAs(parentUser.email),
    academicYearId: academicYear.id,
    termId: term.id,
    gradeId: grade.id,
    classId: klass.id,
    learningAreaId: learningArea.id,
    categoryId: category.id,
    learnerId: learner.id,
    linkId: link.id,
  };
}

/**
 * Normalises list endpoints, which return either a bare array (simple lists) or
 * a `{ items, meta }` envelope (paginated lists).
 */
export function listOf<T = Record<string, unknown>>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const items = (data as { items?: T[] } | null)?.items;
  return Array.isArray(items) ? items : [];
}

/** A real 1x1 PNG (valid signature + IHDR/IDAT/IEND chunks) for upload tests. */
export function pngFixture(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** A tiny, valid PDF used for upload tests. */
export function pdfFixture(text = 'EduTrack Pro test document'): Buffer {
  const body = `BT /F1 12 Tf 60 780 Td (${text}) Tj ET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`, 'latin1');
}
