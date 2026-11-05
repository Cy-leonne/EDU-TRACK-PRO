import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, listOf, resetDatabase, TEST_PASSWORD, type TestSchool } from '../support/harness';

/**
 * Authentication, session handling and school isolation.
 * Integration suite: real HTTP, real PostgreSQL, real guards.
 */
describe('Auth + school isolation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let schoolA: TestSchool;
  let schoolB: TestSchool;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    schoolA = await createSchool(app, api, 'Alpha');
    schoolB = await createSchool(app, api, 'Beta');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    const response = await api.get('/learners');
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a wrong password with a generic message (no account enumeration)', async () => {
    const wrongPassword = await api.post('/auth/login', { email: schoolA.admin.email, password: 'definitely-wrong-Pass1!', clientType: 'MOBILE' });
    const unknownUser = await api.post('/auth/login', { email: 'nobody@test.school', password: 'definitely-wrong-Pass1!', clientType: 'MOBILE' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(JSON.stringify(wrongPassword.body)).toContain('Incorrect email or password');
    expect(JSON.stringify(unknownUser.body)).toContain('Incorrect email or password');
  });

  it('signs a user in and returns their role, school and permissions', async () => {
    const response = await api.post('/auth/login', { email: schoolA.teacher.email, password: TEST_PASSWORD, clientType: 'MOBILE' });
    expect(response.status).toBe(200);
    const data = response.data as unknown as { user: { role: string; permissions: string[] }; accessToken: string };
    expect(data.user.role).toBe('TEACHER');
    expect(data.user.permissions).toContain('result:enter');
    expect(data.user.permissions).not.toContain('timetable:publish');
  });

  it('rotates the refresh token and revokes the whole family when a token is replayed', async () => {
    const login = await api.post('/auth/login', { email: schoolA.admin.email, password: TEST_PASSWORD, clientType: 'MOBILE' });
    const first = (login.data as unknown as { refreshToken: string }).refreshToken;

    const refresh = await api.post('/auth/refresh', { refreshToken: first, clientType: 'MOBILE' });
    expect(refresh.status).toBe(200);
    const second = (refresh.data as unknown as { refreshToken: string }).refreshToken;
    expect(second).not.toBe(first);

    // Replaying the already-rotated token must fail and kill the family.
    const replay = await api.post('/auth/refresh', { refreshToken: first, clientType: 'MOBILE' });
    expect(replay.status).toBe(401);

    const afterReplay = await api.post('/auth/refresh', { refreshToken: second, clientType: 'MOBILE' });
    expect(afterReplay.status).toBe(401);
  });

  it('never exposes password hashes or secrets through the API', async () => {
    const me = await api.get('/auth/me', schoolA.admin.token);
    expect(JSON.stringify(me.body)).not.toContain('$argon2');
    expect(JSON.stringify(me.body)).not.toContain('$2b$');
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  /* --------------------------- school isolation -------------------------- */

  it('hides another school’s learners, classes and teachers', async () => {
    const learners = await api.get('/learners', schoolA.admin.token);
    const payload = JSON.stringify(learners.data);
    expect(payload).not.toContain('OtienoBeta');
    expect(payload).toContain('OtienoAlpha');

    const classes = await api.get('/classes', schoolA.admin.token);
    expect(JSON.stringify(classes.data)).not.toContain('Beta');
    expect(JSON.stringify(classes.data)).toContain('Alpha');
  });

  it('returns 404 (not 403) when another school’s record id is requested by an administrator', async () => {
    const classes = await api.get('/classes', schoolB.admin.token);
    const foreignClassId = listOf<{ id: string }>(classes.data)[0]!.id;
    const response = await api.get(`/classes/${foreignClassId}`, schoolA.admin.token);
    expect(response.status).toBe(404);
  });

  it('refuses to let a parent read a learner from another school', async () => {
    const response = await api.get(`/results/learner/${schoolB.learnerId}`, schoolA.parent.token);
    expect([403, 404]).toContain(response.status);
  });

  it('refuses cross-role escalated calls', async () => {
    const parentToAdmin = await api.get('/dashboard/admin', schoolA.parent.token);
    const teacherToAudit = await api.get('/audit-logs', schoolA.teacher.token);
    const teacherToPublish = await api.post('/timetables/publish', { versionId: 'x' }, schoolA.teacher.token);
    expect([401, 403]).toContain(parentToAdmin.status);
    expect([401, 403]).toContain(teacherToAudit.status);
    expect([401, 403]).toContain(teacherToPublish.status);
  });

  it('records an audit trail entry for administrative actions', async () => {
    const response = await api.post('/learning-areas', { code: 'SCI', name: 'Integrated Science' }, schoolA.admin.token);
    expect(response.status).toBe(201);
    const logs = await api.get('/audit-logs?pageSize=20', schoolA.admin.token);
    const actions = listOf<{ action: string }>(logs.data).map((l) => l.action);
    expect(actions).toContain('learning-area.created');
    // The audit trail of one school is never visible from another.
    const otherLogs = await api.get('/audit-logs?pageSize=20', schoolB.admin.token);
    expect(JSON.stringify(otherLogs.data)).not.toContain('Integrated Science');
  });
});
