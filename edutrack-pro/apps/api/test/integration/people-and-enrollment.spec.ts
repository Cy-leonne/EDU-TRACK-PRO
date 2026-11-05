import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, listOf, resetDatabase, type TestSchool } from '../support/harness';

/** School admin workflows: staff, learners, classes, enrollment and parent links. */
describe('People, classes and enrollment (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let school: TestSchool;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    school = await createSchool(app, api, 'People');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects a malformed learner payload with field-level errors', async () => {
    const response = await api.post('/learners', { firstName: 'A', lastName: '' }, school.admin.token);
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    const message = JSON.stringify(response.body);
    expect(message).toContain('admissionNumber');
  });

  it('creates a teacher with a staff number and workload caps', async () => {
    const response = await api.post(
      '/teachers',
      {
        fullName: 'Jane Wanjiku',
        email: 'jane.wanjiku@people.test',
        phone: '+254712000111',
        staffNumber: 'T-104',
        tscNumber: 'TSC-778899',
        employmentType: 'TSC_EMPLOYED',
        maxPeriodsPerDay: 6,
        maxPeriodsPerWeek: 28,
        prefersFreeDays: [5],
      },
      school.admin.token,
    );
    expect(response.status).toBe(201);
    const created = response.body.data as unknown as { teacher: { id: string; fullName: string }; temporaryPassword: string };
    expect(created.teacher.fullName).toBe('Jane Wanjiku');
    // The one-time password is returned exactly once so the admin can hand it over,
    // and it already satisfies the shared password policy.
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(created.temporaryPassword).toMatch(/[a-z]/);
    expect(created.temporaryPassword).toMatch(/[A-Z]/);
    expect(created.temporaryPassword).toMatch(/\d/);

    const list = await api.get('/teachers', school.admin.token);
    expect(listOf<{ fullName: string }>(list.data).map((t) => t.fullName)).toContain('Jane Wanjiku');
  });

  it('rejects a duplicate staff e-mail (no duplicate accounts)', async () => {
    const response = await api.post(
      '/teachers',
      { fullName: 'Copy Cat', email: 'jane.wanjiku@people.test', staffNumber: 'T-999' },
      school.admin.token,
    );
    expect([400, 409]).toContain(response.status);
  });

  it('never lets a teacher create staff accounts', async () => {
    const response = await api.post(
      '/teachers',
      { fullName: 'Sneaky Teacher', email: 'sneaky@people.test', staffNumber: 'T-900' },
      school.teacher.token,
    );
    expect([401, 403]).toContain(response.status);
  });

  it('stores teacher availability as a full weekly grid and reads it back', async () => {
    const teachers = await api.get('/teachers', school.admin.token);
    const teacherId = listOf<{ id: string }>(teachers.data)[0]!.id;

    const saved = await api.post(
      '/teacher-assignments/availability',
      {
        teacherId,
        unavailable: [
          { dayOfWeek: 5, periodIndex: 1, reason: 'Assembly duty' },
          { dayOfWeek: 5, periodIndex: 2, reason: 'Assembly duty' },
        ],
      },
      school.admin.token,
    );
    expect([200, 201]).toContain(saved.status);

    const read = await api.get(`/teacher-assignments/availability/${teacherId}`, school.admin.token);
    const slots = listOf<{ dayOfWeek: number; periodIndex: number }>(read.data);
    expect(slots.length).toBe(2);
    // Saving again replaces the grid instead of duplicating it.
    await api.post(
      '/teacher-assignments/availability',
      { teacherId, unavailable: [{ dayOfWeek: 1, periodIndex: 1 }] },
      school.admin.token,
    );
    const afterReplace = await api.get(`/teacher-assignments/availability/${teacherId}`, school.admin.token);
    expect(listOf(afterReplace.data).length).toBe(1);
  });

  it('creates learners, refuses duplicate admission numbers, and finds them by search', async () => {
    const payload = {
      admissionNumber: 'ADM-7001',
      firstName: 'Amina',
      lastName: 'Chebet',
      gender: 'FEMALE',
      assessmentNumber: 'ASM-7001',
      gradeId: school.gradeId,
      currentClassId: school.classId,
    };
    const created = await api.post('/learners', payload, school.admin.token);
    expect(created.status).toBe(201);

    const duplicate = await api.post('/learners', { ...payload, firstName: 'Other' }, school.admin.token);
    expect([400, 409]).toContain(duplicate.status);

    const search = await api.get('/learners?search=Chebet', school.admin.token);
    expect(listOf<{ lastName: string }>(search.data).some((l) => l.lastName === 'Chebet')).toBe(true);
  });

  it('enrolls a learner into a class and blocks double enrollment in the same term', async () => {
    const learners = await api.get('/learners?search=Chebet', school.admin.token);
    const learnerId = listOf<{ id: string }>(learners.data)[0]!.id;

    const enroll = await api.post('/classes/enrollments', { learnerId, classId: school.classId, termId: school.termId }, school.admin.token);
    expect([200, 201]).toContain(enroll.status);

    const again = await api.post('/classes/enrollments', { learnerId, classId: school.classId, termId: school.termId }, school.admin.token);
    expect([400, 409]).toContain(again.status);
  });

  it('bulk-enrolls learners and reports the class roll', async () => {
    const created: string[] = [];
    for (const [i, name] of ['Brian', 'Cynthia', 'Dennis'].entries()) {
      const res = await api.post(
        '/learners',
        { admissionNumber: `ADM-70${10 + i}`, firstName: name, lastName: 'Otieno', gradeId: school.gradeId },
        school.admin.token,
      );
      expect(res.status).toBe(201);
      created.push((res.body.data as unknown as { id: string }).id);
    }

    const bulk = await api.post('/classes/enrollments/bulk', { classId: school.classId, learnerIds: created }, school.admin.token);
    expect([200, 201]).toContain(bulk.status);

    const roster = await api.get(`/classes/${school.classId}/learners`, school.admin.token);
    const names = listOf<{ learnerName: string }>(roster.data).map((l) => l.learnerName);
    expect(names.filter((n) => n.endsWith('Otieno')).length).toBe(3);

    const validation = await api.get('/classes/validation/enrollments', school.admin.token);
    expect(validation.status).toBe(200);
  });

  it('creates a parent, links them to a learner, and keeps the link unverified until an admin verifies it', async () => {
    const parent = await api.post(
      '/parents',
      { fullName: 'Mary Otieno', email: 'mary.otieno@people.test', phone: '+254733000222', relationship: 'Mother' },
      school.admin.token,
    );
    expect(parent.status).toBe(201);
    const parentProfileId = (parent.body.data as unknown as { parent: { id: string } }).parent.id;

    const learners = await api.get('/learners?search=Otieno', school.admin.token);
    const learnerId = listOf<{ id: string }>(learners.data)[0]!.id;

    const link = await api.post('/parent-links', { parentProfileId, learnerId, relationship: 'Mother' }, school.admin.token);
    expect(link.status).toBe(201);
    const linkId = (link.body.data as unknown as { id: string }).id;

    const pending = await api.get('/parent-links', school.admin.token);
    expect(listOf<{ id: string; isVerified: boolean }>(pending.data).find((l) => l.id === linkId)?.isVerified).toBe(false);

    const verified = await api.post(`/parent-links/${linkId}/verify`, { verificationMethod: 'DOCUMENT' }, school.admin.token);
    expect([200, 201]).toContain(verified.status);
    const afterVerify = await api.get('/parent-links', school.admin.token);
    expect(listOf<{ id: string; isVerified: boolean }>(afterVerify.data).find((l) => l.id === linkId)?.isVerified).toBe(true);
  });

  it('refuses to link a parent from another school to this school’s learner', async () => {
    const other = await createSchool(app, api, 'Other');
    const learners = await api.get('/learners?search=Chebet', school.admin.token);
    const learnerId = listOf<{ id: string }>(learners.data)[0]!.id;

    const foreignParent = await api.get('/parents', other.admin.token);
    const foreignParentProfileId = listOf<{ id: string }>(foreignParent.data)[0]!.id;

    const response = await api.post('/parent-links', { parentProfileId: foreignParentProfileId, learnerId }, school.admin.token);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('reproduces the stale family-selection failure while proving verified links still resolve and remain private', async () => {
    const initial = await api.get('/dashboard/parent', school.parent.token);
    expect(initial.status).toBe(200);
    expect((initial.data as { selectedLearnerId: string }).selectedLearnerId).toBe(school.learnerId);

    // The browser remembers a selected learner between visits. If that link is
    // revoked on another device, the stale id makes the dashboard return 404,
    // even though this parent still has a different valid child.
    const learnerRow = await prisma.learner.create({
      data: {
        schoolId: school.id, admissionNumber: 'ADM-STALE-001', firstName: 'Mumbi', lastName: 'Njeri',
        currentClassId: school.classId, gradeId: school.gradeId, status: 'ACTIVE',
      },
    });
    const staleLink = await prisma.parentLearnerLink.create({
      data: {
        schoolId: school.id, parentProfileId: school.parentProfileId, learnerId: learnerRow.id,
        isVerified: true, verificationMethod: 'ADMIN_RECORD', verifiedAt: new Date(),
      },
    });
    await prisma.parentLearnerLink.update({ where: { id: staleLink.id }, data: { revokedAt: new Date(), isVerified: false } });

    const staleSelection = await api.get(`/dashboard/parent?learnerId=${learnerRow.id}`, school.parent.token);
    expect(staleSelection.status).toBe(404);
    expect(JSON.stringify(staleSelection.body)).not.toContain('Mumbi');

    // An arbitrary learner id is also deliberately indistinguishable from a
    // revoked link; it must never reveal another family's records.
    const foreignSelection = await api.get('/dashboard/parent?learnerId=not-a-linked-learner', school.parent.token);
    expect(foreignSelection.status).toBe(404);
    expect(JSON.stringify(foreignSelection.body)).not.toContain('Mumbi');

    const stillLinked = await api.get('/dashboard/parent', school.parent.token);
    expect(stillLinked.status).toBe(200);
    expect((stillLinked.data as { selectedLearnerId: string }).selectedLearnerId).toBe(school.learnerId);
    expect((stillLinked.data as { learners: Array<{ id: string }> }).learners.map((item) => item.id)).not.toContain(learnerRow.id);
  });
});
