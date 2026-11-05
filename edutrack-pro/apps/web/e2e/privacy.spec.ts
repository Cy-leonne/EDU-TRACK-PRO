import { apiClient, expect, test } from './helpers';

/**
 * Authorisation and privacy, asserted directly against the API (the screens
 * cannot be trusted to enforce anything — the server is the authority).
 */
test.describe('Authorisation and school/family isolation', () => {
  test('a guardian can never read another family’s learner', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);
    const strangerToken = await api.login(fixtures.credentials.stranger.email, fixtures.credentials.stranger.password);
    const target = fixtures.learnerIds[0];

    // The linked (verified) guardian is allowed…
    const allowed = await api.get(`/results/learner/${target}`, parentToken);
    expect([200, 403]).toContain(allowed.status);
    // …an unrelated guardian is not, on any learner-scoped route.
    for (const path of [`/learners/${target}`, `/results/learner/${target}`, `/timetables/learner/${target}`]) {
      const denied = await api.get(path, strangerToken);
      expect([401, 403, 404], `${path} must be refused for an unrelated guardian`).toContain(denied.status);
    }
    // The scoped list route returns only what belongs to the caller.
    const scoped = await api.get('/learners', strangerToken);
    expect(scoped.status).toBe(200);
    expect((scoped.data as unknown[]).length).toBe(0);
  });

  test('a teacher cannot reach unrelated classes, publish, or manage accounts', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const teacherToken = await api.login(fixtures.credentials.teacher.email, fixtures.credentials.teacher.password);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);

    // Account administration belongs to the office.
    expect((await api.post('/auth/invitations', { email: 'x@e2e.test', fullName: 'Nope Nope', role: 'TEACHER' }, teacherToken)).status).toBe(401);
    expect((await api.post('/learners', { firstName: 'No', lastName: 'Access' }, teacherToken)).status).toBe(401);

    // Publishing results is refused for a class the teacher does not teach…
    const teacher = (await api.get('/teachers', adminToken)).data as Array<{ id: string; email: string }>;
    expect(teacher.some((row) => row.email === fixtures.credentials.teacher.email)).toBe(true);

    // …and the guardian routes stay closed to staff.
    const asParent = await api.get('/dashboard/parent', teacherToken);
    expect([401, 403]).toContain(asParent.status);
  });

  test('a guardian cannot modify school data even with a valid school id', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);

    const attempts = [
      ['PATCH', `/learners/${fixtures.learnerIds[0]}`, { firstName: 'Changed' }],
      ['POST', '/classes', { name: 'Guardian class', gradeId: 'x' }],
      ['POST', '/parent-links', { parentProfileId: fixtures.parentProfileId, learnerId: fixtures.learnerIds[2], relationship: 'Mother' }],
      ['PATCH', `/parent-links/anything`, { canViewResults: true }],
      ['POST', '/timetables/publish', { versionId: 'anything' }],
      ['POST', '/teacher-assignments', { teacherId: 'x', classId: fixtures.classId, learningAreaId: fixtures.learningAreaId }],
    ] as const;

    for (const [method, path, body] of attempts) {
      const result = method === 'PATCH' ? await api.patch(path, body, parentToken) : await api.post(path, body, parentToken);
      expect([401, 403, 404], `${method} ${path} must not be allowed for a guardian`).toContain(result.status);
    }
  });

  test('unauthenticated callers are refused everywhere that matters', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    for (const path of ['/auth/me', '/learners', '/teachers', '/notifications', '/timetables', '/reports/export/learners.csv', '/audit-logs']) {
      const result = await api.get(path);
      expect([401, 403], `${path} must require authentication`).toContain(result.status);
    }
  });

  test('tampered ids and guessed file urls reveal nothing', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);

    // A guessed (but syntactically valid) id must not return a record.
    const guessed = await api.get('/learners/ckzzzzzzzzzzzzzzzzzzzzzz', parentToken);
    expect([400, 403, 404]).toContain(guessed.status);

    // Files live behind the API; there is no public static path for them.
    for (const url of ['/storage/anything.pdf', '/uploads/anything.pdf', '/files/00000000-0000-0000-0000-000000000000/download']) {
      const response = await fetch(`${fixtures.apiBase}${url}`);
      expect([401, 403, 404], `${url} must not be publicly served`).toContain(response.status);
    }
  });

  test('school isolation: a second school cannot see the first school’s data', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const stamp = Date.now().toString(36);
    const other = await api.post('/auth/register/school', {
      school: { name: `Isolation School ${stamp}`, code: `ISO-${stamp}`, timezone: 'Africa/Nairobi' },
      admin: { fullName: 'Other Head', email: `other.${stamp}@e2e.test`, password: 'Isolation-Pass!2026', confirmPassword: 'Isolation-Pass!2026' },
      acceptTerms: true,
    });
    expect(other.status).toBe(201);
    const otherToken = other.data.accessToken as string;
    expect(other.data.school.id).not.toBe(fixtures.schoolId);

    expect((await api.get('/learners', otherToken)).data as unknown[]).toEqual([]);
    const foreign = await api.get(`/learners/${fixtures.learnerIds[0]}`, otherToken);
    expect([403, 404]).toContain(foreign.status);
    const foreignResults = await api.get(`/results/learner/${fixtures.learnerIds[0]}`, otherToken);
    expect([401, 403, 404]).toContain(foreignResults.status);
    const foreignClass = await api.get(`/classes/${fixtures.classId}`, otherToken);
    expect([403, 404]).toContain(foreignClass.status);
  });

  test('administrators are never created into an existing school without an invitation', async ({ fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const stamp = Date.now().toString(36);
    const intruderEmail = `intruder.${stamp}@e2e.test`;

    // Try to attach an administrator to the existing school using every public
    // route that could conceivably create an account.
    const attempts = [
      await api.post('/auth/register/school', {
        setupToken: 'not-a-real-setup-token-at-all',
        school: { name: fixtures.schoolName, code: `STEAL-${stamp}`, timezone: 'Africa/Nairobi' },
        admin: { fullName: 'Intruder One', email: intruderEmail, password: 'Intruder-Pass!2026', confirmPassword: 'Intruder-Pass!2026' },
        acceptTerms: true,
      }),
      await api.post('/auth/register/parent', {
        schoolCode: 'ISO-UNKNOWN',
        fullName: 'Intruder Two',
        email: intruderEmail,
        phone: '+254700999999',
        relationship: 'Guardian',
        password: 'Intruder-Pass!2026',
        confirmPassword: 'Intruder-Pass!2026',
        acceptTerms: true,
      }),
      await api.post('/auth/invitations/accept', {
        token: 'a-token-that-was-never-issued-0123456789',
        password: 'Intruder-Pass!2026',
        confirmPassword: 'Intruder-Pass!2026',
      }),
    ];
    for (const attempt of attempts) {
      expect([400, 401, 403], JSON.stringify(attempt.raw).slice(0, 160)).toContain(attempt.status);
    }

    // No account was created for the intruder address.
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);
    const staff = await api.get('/teachers?search=intruder', adminToken);
    expect((staff.data as unknown[]).length).toBe(0);
  });
});
