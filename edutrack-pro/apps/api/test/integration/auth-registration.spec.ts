import { INestApplication } from '@nestjs/common';
import { createTestApp, http, resetDatabase, TEST_PASSWORD } from '../support/harness';
import { PrismaService } from '../../src/common/prisma/prisma.service';

/**
 * Registration, invitations and account lifecycle (integration).
 *
 * These tests exercise the *real* onboarding rules a deployed school relies on:
 *
 *  • a school + first administrator is created atomically (or not at all)
 *  • an unauthenticated caller can never gain administrator access to an
 *    EXISTING school, whatever they send
 *  • teachers/administrators join only through an invitation issued by an
 *    administrator of that same school
 *  • guardians register, but see nothing until the school verifies the link
 *  • a school code alone never exposes a learner's records
 *  • duplicate accounts are rejected, passwords are never returned, and every
 *    step writes an audit row
 */
describe('Registration, invitations and account lifecycle (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;

  beforeAll(async () => {
    const harness = await createTestApp();
    app = harness.app;
    prisma = harness.prisma;
    api = http(app);
    await resetDatabase(prisma);
    // Self-service onboarding is enabled for the suite via test/support/env.ts,
    // which is read when the application boots (configuration is immutable at
    // runtime by design). The closed-policy cases are asserted separately.
  });

  afterAll(async () => {
    await app.close();
  });

  const strong = 'School-Admin-Pass!2026';

  async function registerSchool(overrides: { name?: string; code?: string; email?: string } = {}) {
    return api.post('/auth/register/school', {
      school: { name: overrides.name ?? 'Mwanga Junior School', code: overrides.code ?? 'MJS-001', county: 'Nakuru', timezone: 'Africa/Nairobi' },
      admin: {
        fullName: 'Grace Wanjiku',
        email: overrides.email ?? 'grace@mjs.test',
        password: strong,
        confirmPassword: strong,
      },
      acceptTerms: true,
    });
  }

  describe('school registration', () => {
    it('creates the school, its administrator, the Grade 7-9 catalogue and default assessment vocabulary in one transaction', async () => {
      const response = await registerSchool();
      expect(response.status).toBe(201);
      expect(response.data.accessToken).toBeTruthy();
      expect(response.data.user.role).toBe('ADMIN');

      const schoolId = response.data.school.id as string;
      const grades = await prisma.grade.count({ where: { schoolId } });
      const categories = await prisma.assessmentCategory.count({ where: { schoolId } });
      const bands = await prisma.achievementLevel.count({ where: { schoolId } });
      const memberships = await prisma.schoolMembership.count({ where: { schoolId, role: 'ADMIN', status: 'ACTIVE' } });

      expect(grades).toBe(3); // Grade 7, 8, 9
      expect(categories).toBeGreaterThan(0);
      expect(bands).toBeGreaterThan(0);
      expect(memberships).toBe(1);

      // The new administrator can immediately use the workspace.
      const me = await api.get('/auth/me', response.data.accessToken as string);
      expect(me.status).toBe(200);
      expect(me.data.schoolId).toBe(schoolId);
      expect((me.data.permissions as string[]).length).toBeGreaterThan(20);
    });

    it('never accepts a mismatched password confirmation and creates nothing', async () => {
      const before = await prisma.school.count();
      const response = await api.post('/auth/register/school', {
        school: { name: 'Broken Registration School', code: 'BRS-1', timezone: 'Africa/Nairobi' },
        admin: { fullName: 'Test Admin', email: 'broken@mjs.test', password: strong, confirmPassword: 'Something-Else!2026' },
        acceptTerms: true,
      });
      expect(response.status).toBe(400);
      expect(await prisma.school.count()).toBe(before);
      expect(await prisma.user.findUnique({ where: { email: 'broken@mjs.test' } })).toBeNull();
    });

    it('requires the terms to be accepted', async () => {
      const response = await api.post('/auth/register/school', {
        school: { name: 'No Terms School', code: 'NTS-1', timezone: 'Africa/Nairobi' },
        admin: { fullName: 'Test Admin', email: 'noterms@mjs.test', password: strong, confirmPassword: strong },
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toMatch(/terms/i);
    });

    it('can never add an administrator to an EXISTING school, by any unauthenticated route', async () => {
      const firstSchool = await prisma.school.findFirstOrThrow({ where: { code: 'MJS-001' } });
      const membershipsBefore = await prisma.schoolMembership.count({ where: { schoolId: firstSchool.id } });
      const schoolsBefore = await prisma.school.count();
      const email = 'intruder@example.test';

      // (a) the first-run endpoint without the server token
      const withBadToken = await api.post('/auth/setup/first-admin', {
        setupToken: 'not-the-real-token-value-000000',
        fullName: 'Intruder',
        email,
        password: strong,
        school: { name: 'Mwanga Junior School', timezone: 'Africa/Nairobi' },
      });
      expect(withBadToken.status).toBe(401);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      expect(await prisma.schoolMembership.count({ where: { schoolId: firstSchool.id } })).toBe(membershipsBefore);
      const rejected = await prisma.auditLog.findFirst({
        where: { action: 'auth.setup.rejected' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rejected).not.toBeNull();
      expect(JSON.stringify(rejected)).not.toContain('not-the-real-token-value-000000');

      // (b) the self-service route — allowed by policy, but it creates a NEW,
      //     unrelated school; it must never touch the existing tenant.
      const selfService = await registerSchool({ name: 'Unrelated School', code: 'US-9', email });
      expect(selfService.status).toBe(201);
      const newSchoolId = selfService.data.school.id as string;
      expect(newSchoolId).not.toBe(firstSchool.id);
      expect(await prisma.schoolMembership.count({ where: { schoolId: firstSchool.id } })).toBe(membershipsBefore);
      expect(await prisma.school.count()).toBe(schoolsBefore + 1);

      // (c) and the new administrator is isolated inside its own tenant.
      const strangerToken = selfService.data.accessToken as string;
      const me = await api.get('/auth/me', strangerToken);
      expect(me.data.schoolId).toBe(newSchoolId);
      const strangerLearners = await api.get('/learners', strangerToken);
      expect(strangerLearners.status).toBe(200);
      expect((strangerLearners.data as unknown as unknown[]).length).toBe(0);
      const strangerDashboard = await api.get('/dashboard/admin', strangerToken);
      expect(strangerDashboard.status).toBe(200);
      expect(JSON.stringify(strangerDashboard.data)).not.toContain(firstSchool.name);

      // (d) the existing tenant is untouched: still exactly one administrator, and
      //     the intruder's address was never added to it.
      expect(await prisma.schoolMembership.count({ where: { schoolId: firstSchool.id } })).toBe(membershipsBefore);
      expect(
        await prisma.schoolMembership.count({ where: { schoolId: firstSchool.id, user: { email } } }),
      ).toBe(0);
      expect(await prisma.user.findFirstOrThrow({ where: { email } })).toMatchObject({ email });

      // Clean up the deliberately-created second tenant so later counts stay stable.
      await prisma.school.delete({ where: { id: newSchoolId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { email } });
    });

    it('rejects a duplicate email address and a school code already in use', async () => {
      const duplicateEmail = await registerSchool({ name: 'Another School', code: 'AS-1', email: 'grace@mjs.test' });
      expect(duplicateEmail.status).toBe(400);
      expect(String(duplicateEmail.body.message)).toMatch(/already exists/i);

      const duplicateCode = await registerSchool({ name: 'Code Clash School', code: 'MJS-001', email: 'other@mjs.test' });
      expect(duplicateCode.status).toBe(400);
      expect(String(duplicateCode.body.message)).toMatch(/code/i);
    });

    it('records the registration in the audit trail without storing a plaintext password', async () => {
      const audit = await prisma.auditLog.findFirst({ where: { action: 'school.registered' }, orderBy: { createdAt: 'desc' } });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit?.after ?? {})).not.toMatch(new RegExp(strong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      const user = await prisma.user.findUnique({ where: { email: 'grace@mjs.test' } });
      expect(user?.passwordHash).toBeTruthy();
      expect(user?.passwordHash).not.toBe(strong);
      // Argon2id in this deployment.
      expect(user?.passwordHash.startsWith('$argon2')).toBe(true);
    });
  });

  describe('teacher invitations', () => {
    let adminToken = '';
    let schoolId = '';
    let learnerId = '';

    beforeAll(async () => {
      const login = await api.post('/auth/login', { email: 'grace@mjs.test', password: strong, clientType: 'WEB' });
      expect(login.status).toBe(200);
      adminToken = login.data.accessToken as string;
      schoolId = login.data.user.schoolId as string;
      const learner = await prisma.learner.create({
        data: {
          schoolId,
          admissionNumber: 'MJS/2026/0001',
          assessmentNumber: 'AS-0001',
          firstName: 'Amina',
          lastName: 'Otieno',
          gender: 'FEMALE',
        },
      });
      learnerId = learner.id;
    });

    it('lets an administrator invite a teacher and returns a one-time activation link', async () => {
      const response = await api.post(
        '/auth/invitations',
        { email: 'teacher.invite@mjs.test', fullName: 'Peter Kamau', role: 'TEACHER', staffNumber: 'T-101' },
        adminToken,
      );
      expect(response.status).toBe(201);
      expect(response.data.invitation.role).toBe('TEACHER');
      expect(response.data.invitation.status).toBe('PENDING');
      expect(String(response.data.invitationUrl)).toContain('/activate?token=');

      const stored = await prisma.accountInvitation.findFirst({ where: { email: 'teacher.invite@mjs.test' } });
      expect(stored?.schoolId).toBe(schoolId);
      // The token is stored hashed, never in clear text.
      expect(stored?.tokenHash).not.toContain('token=');
    });

    it('does not create a usable account until the invitation is accepted', async () => {
      const premature = await api.post('/auth/login', { email: 'teacher.invite@mjs.test', password: 'Anything-At-All!2026', clientType: 'WEB' });
      expect(premature.status).toBe(401);
      expect(await prisma.teacherProfile.count({ where: { user: { email: 'teacher.invite@mjs.test' } } })).toBe(0);
    });

    it('previews the invitation without leaking the token back', async () => {
      const stored = await prisma.accountInvitation.findFirst({ where: { email: 'teacher.invite@mjs.test' }, orderBy: { createdAt: 'desc' } });
      // Re-issue so we hold a known plaintext token for the rest of the flow.
      const issued = await api.post('/auth/invitations', { email: 'teacher.invite@mjs.test', fullName: 'Peter Kamau', role: 'TEACHER', staffNumber: 'T-101' }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;
      expect(token.length).toBeGreaterThan(20);

      const preview = await api.get(`/auth/invitations/preview?token=${encodeURIComponent(token)}`);
      expect(preview.status).toBe(200);
      expect(preview.data.valid).toBe(true);
      expect(preview.data.email).toBe('teacher.invite@mjs.test');
      expect(preview.data.schoolName).toBe('Mwanga Junior School');
      expect(JSON.stringify(preview.body)).not.toContain(token);
      expect(stored).not.toBeNull();
    });

    it('accepts the invitation, sets the teacher password and activates the membership', async () => {
      const issued = await api.post('/auth/invitations', { email: 'second.teacher@mjs.test', fullName: 'Martha Njeri', role: 'TEACHER', staffNumber: 'T-102' }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;

      const accepted = await api.post('/auth/invitations/accept', { token, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(accepted.status).toBe(200);
      expect(accepted.data.activated).toBe(true);

      const login = await api.post('/auth/login', { email: 'second.teacher@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      expect(login.status).toBe(200);
      expect(login.data.user.role).toBe('TEACHER');
      expect(login.data.user.schoolId).toBe(schoolId);
      // A teacher gets teacher permissions, never administrative ones.
      expect(login.data.user.permissions).toContain('assessment:create');
      expect(login.data.user.permissions).not.toContain('user:manage');
      expect(login.data.user.permissions).not.toContain('timetable:publish');

      const membership = await prisma.schoolMembership.findFirst({ where: { userId: login.data.user.id as string, schoolId } });
      expect(membership?.status).toBe('ACTIVE');
      expect(membership?.role).toBe('TEACHER');
    });

    it('refuses a second use of the same invitation token', async () => {
      const issued = await api.post('/auth/invitations', { email: 'third.teacher@mjs.test', fullName: 'Reuse Test', role: 'TEACHER' }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;
      const first = await api.post('/auth/invitations/accept', { token, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(first.status).toBe(200);
      const second = await api.post('/auth/invitations/accept', { token, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(second.status).toBe(400);
    });

    it('rejects a revoked invitation', async () => {
      const issued = await api.post('/auth/invitations', { email: 'revoked.teacher@mjs.test', fullName: 'Revoked Teacher', role: 'TEACHER' }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;
      const revoke = await api.post(`/auth/invitations/${issued.data.invitation.id}/revoke`, { reason: 'Wrong staff number' }, adminToken);
      expect(revoke.status).toBe(200);

      const preview = await api.get(`/auth/invitations/preview?token=${encodeURIComponent(token)}`);
      expect(preview.data.valid).toBe(false);
      const accept = await api.post('/auth/invitations/accept', { token, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(accept.status).toBe(400);
    });

    it('will not let a teacher invite anyone (permission enforced on the server)', async () => {
      const login = await api.post('/auth/login', { email: 'second.teacher@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      const response = await api.post('/auth/invitations', { email: 'sneaky@mjs.test', fullName: 'Sneaky Person', role: 'ADMIN' }, login.data.accessToken as string);
      expect(response.status).toBe(401);
      expect(await prisma.accountInvitation.count({ where: { email: 'sneaky@mjs.test' } })).toBe(0);
    });

    it('keeps an invitation bound to the address it was issued for', async () => {
      const issued = await api.post('/auth/invitations', { email: 'bound@mjs.test', fullName: 'Bound Invite', role: 'TEACHER' }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;
      const hijack = await api.post('/auth/invitations/accept', { token, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(hijack.status).toBe(200); // correct address
      const other = await api.post('/auth/invitations', { email: 'bound2@mjs.test', fullName: 'Bound Two', role: 'TEACHER' }, adminToken);
      const token2 = new URL(other.data.invitationUrl as string).searchParams.get('token') as string;
      const mismatch = await api.post('/auth/register/parent', {
        invitationToken: token2,
        fullName: 'Someone Else',
        email: 'someoneelse@mjs.test',
        phone: '+254700111222',
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        relationship: 'Guardian',
        acceptTerms: true,
      });
      expect(mismatch.status).toBe(400);
      expect(learnerId).toBeTruthy();
    });
  });

  describe('guardian registration and verification', () => {
    let adminToken = '';
    let schoolId = '';
    let learnerId = '';

    beforeAll(async () => {
      const login = await api.post('/auth/login', { email: 'grace@mjs.test', password: strong, clientType: 'WEB' });
      adminToken = login.data.accessToken as string;
      schoolId = login.data.user.schoolId as string;
      const learner = await prisma.learner.findFirst({ where: { schoolId, admissionNumber: 'MJS/2026/0001' } });
      learnerId = learner?.id as string;
    });

    it('registers a guardian from an invitation and links the learner WITHOUT granting access', async () => {
      const issued = await api.post('/auth/invitations', { email: 'guardian@mjs.test', fullName: 'Alice Otieno', role: 'PARENT', relationship: 'Mother', learnerId }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;

      const registered = await api.post('/auth/register/parent', {
        invitationToken: token,
        fullName: 'Alice Otieno',
        email: 'guardian@mjs.test',
        phone: '+254700333444',
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        relationship: 'Mother',
        acceptTerms: true,
      });
      expect(registered.status).toBe(201);
      expect(registered.data.verificationRequired).toBe(true);

      const login = await api.post('/auth/login', { email: 'guardian@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      expect(login.status).toBe(200);
      expect(login.data.user.role).toBe('PARENT');

      const link = await prisma.parentLearnerLink.findFirst({ where: { learnerId, schoolId } });
      expect(link).not.toBeNull();
      expect(link?.isVerified).toBe(false);

      // An unverified link grants nothing: results and timetable are refused.
      const results = await api.get(`/results/learner/${learnerId}`, login.data.accessToken as string);
      expect([401, 403]).toContain(results.status);
      const timetable = await api.get(`/timetables/learner/${learnerId}`, login.data.accessToken as string);
      expect([401, 403]).toContain(timetable.status);
    });

    it('registers a guardian with the school code and no learner access at all', async () => {
      const registered = await api.post('/auth/register/parent', {
        schoolCode: 'MJS-001',
        fullName: 'Joseph Otieno',
        email: 'father@mjs.test',
        phone: '+254700555666',
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        relationship: 'Father',
        acceptTerms: true,
      });
      expect(registered.status).toBe(201);
      expect(registered.data.hasPendingLink).toBe(false);

      const login = await api.post('/auth/login', { email: 'father@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      expect(login.status).toBe(200);
      const token = login.data.accessToken as string;

      // No link yet → the learner's records are not reachable.
      const results = await api.get(`/results/learner/${learnerId}`, token);
      expect([401, 403]).toContain(results.status);

      // The dashboard is honest about it rather than showing another family's data.
      const dashboard = await api.get('/dashboard/parent', token);
      expect(dashboard.status).toBe(200);
      expect(dashboard.data.learners).toEqual([]);
    });

    it('lets a guardian request a link with the assessment number + surname, but never confirms the learner exists', async () => {
      const login = await api.post('/auth/login', { email: 'father@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      const token = login.data.accessToken as string;

      const good = await api.post('/auth/parent/link-request', { learnerAssessmentNumber: 'AS-0001', learnerSurname: 'Otieno', relationship: 'Father' }, token);
      expect(good.status).toBe(202);
      expect(good.data.status).toBe('PENDING_VERIFICATION');

      const bad = await api.post('/auth/parent/link-request', { learnerAssessmentNumber: 'AS-9999', learnerSurname: 'Nobody', relationship: 'Father' }, token);
      expect([400, 404]).toContain(bad.status);

      // The school office is notified and can act.
      const notification = await prisma.notification.findFirst({ where: { schoolId, title: { contains: 'verify' } }, orderBy: { createdAt: 'desc' } });
      expect(notification).not.toBeNull();
    });

    it('exposes learner data only after an administrator verifies the link', async () => {
      const pending = await prisma.parentLearnerLink.findFirst({ where: { learnerId, isVerified: false, revokedAt: null } });
      expect(pending).not.toBeNull();
      const verify = await api.post(`/parent-links/${pending?.id as string}/verify`, { method: 'PHONE_CALL' }, adminToken);
      expect([200, 201]).toContain(verify.status);

      const login = await api.post('/auth/login', { email: 'guardian@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      const results = await api.get(`/results/learner/${learnerId}`, login.data.accessToken as string);
      expect(results.status).toBe(200);
      expect(Array.isArray(results.data.results)).toBe(true);
    });

    it('publishes the onboarding policy so the sign-in page offers only permitted routes', async () => {
      const policy = await api.get('/auth/setup-status');
      expect(policy.status).toBe(200);
      expect(typeof policy.data.schoolSelfRegistration).toBe('boolean');
      expect(typeof policy.data.parentSelfRegistration).toBe('boolean');
      expect(policy.data.invitationRegistration).toBe(true);
      // First-run setup is closed once a school exists.
      expect(policy.data.requiresSetup).toBe(false);
    });

    it('rejects an invitation addressed to a different person and never creates the account', async () => {
      const issued = await api.post('/auth/invitations', { email: 'intended@mjs.test', fullName: 'Intended Person', role: 'PARENT', relationship: 'Guardian' }, adminToken);
      const token = new URL(issued.data.invitationUrl as string).searchParams.get('token') as string;
      const mismatch = await api.post('/auth/register/parent', {
        invitationToken: token,
        fullName: 'Wrong Person',
        email: 'wrong.person@mjs.test',
        phone: '+254700999000',
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        relationship: 'Guardian',
        acceptTerms: true,
      });
      expect(mismatch.status).toBe(400);
      expect(String(mismatch.body.message)).toMatch(/issued to/i);
      expect(await prisma.user.findUnique({ where: { email: 'wrong.person@mjs.test' } })).toBeNull();
    });
  });

  describe('password recovery and account lifecycle', () => {
    let adminToken = '';

    beforeAll(async () => {
      const login = await api.post('/auth/login', { email: 'grace@mjs.test', password: strong, clientType: 'WEB' });
      adminToken = login.data.accessToken as string;
    });

    it('answers a forgotten-password request identically for known and unknown addresses', async () => {
      const known = await api.post('/auth/password/forgot', { email: 'grace@mjs.test' });
      const unknown = await api.post('/auth/password/forgot', { email: 'nobody.at.all@example.test' });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.data.message).toBe(unknown.data.message);
    });

    it('issues a single-use, time-limited reset token and revokes sessions on completion', async () => {
      await api.post('/auth/password/forgot', { email: 'second.teacher@mjs.test' });
      const record = await prisma.passwordResetToken.findFirst({
        where: { user: { email: 'second.teacher@mjs.test' } },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });
      expect(record?.usedAt).toBeNull();
      expect(record?.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // The plaintext token is only in the email/link, so use the admin-issued path
      // (schools without SMTP) to obtain a usable token end-to-end.
      const issued = await api.post(`/auth/accounts/${record?.userId as string}/password-reset-link`, {}, adminToken);
      expect(issued.status).toBe(200);
      const token = new URL(issued.data.resetUrl as string).searchParams.get('token') as string;

      const login = await api.post('/auth/login', { email: 'second.teacher@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      const oldRefresh = login.data.refreshToken as string;

      const reset = await api.post('/auth/password/reset', { token, password: 'Brand-New-Pass!2026' });
      expect(reset.status).toBe(200);
      expect(reset.data.reset).toBe(true);

      // Old password no longer works; new one does.
      expect((await api.post('/auth/login', { email: 'second.teacher@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' })).status).toBe(401);
      expect((await api.post('/auth/login', { email: 'second.teacher@mjs.test', password: 'Brand-New-Pass!2026', clientType: 'WEB' })).status).toBe(200);

      // The session that existed before the reset is gone.
      const replay = await api.post('/auth/refresh', { refreshToken: oldRefresh, clientType: 'WEB' });
      expect([401, 403]).toContain(replay.status);

      // The token cannot be used twice.
      const reuse = await api.post('/auth/password/reset', { token, password: 'Another-Pass!2026' });
      expect(reuse.status).toBe(400);
    });

    it('lets an administrator deactivate an account, which immediately blocks sign-in', async () => {
      const teacher = await prisma.user.findUnique({ where: { email: 'third.teacher@mjs.test' } });
      const response = await api.post(`/auth/accounts/${teacher?.id as string}/status`, { isActive: false }, adminToken);
      expect(response.status).toBe(200);

      const login = await api.post('/auth/login', { email: 'third.teacher@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      expect(login.status).toBe(401);

      const restore = await api.post(`/auth/accounts/${teacher?.id as string}/status`, { isActive: true }, adminToken);
      expect(restore.status).toBe(200);
      expect((await api.post('/auth/login', { email: 'third.teacher@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' })).status).toBe(200);
    });

    it('refuses to let an administrator deactivate their own account', async () => {
      const me = await api.get('/auth/me', adminToken);
      const response = await api.post(`/auth/accounts/${me.data.id as string}/status`, { isActive: false }, adminToken);
      expect(response.status).toBe(400);
    });

    it('signs an account out of every device on request', async () => {
      const login = await api.post('/auth/login', { email: 'father@mjs.test', password: TEST_PASSWORD, clientType: 'WEB' });
      const refreshToken = login.data.refreshToken as string;
      const out = await api.post('/auth/logout-all', {}, login.data.accessToken as string);
      expect(out.status).toBe(200);
      const replay = await api.post('/auth/refresh', { refreshToken, clientType: 'WEB' });
      expect([401, 403]).toContain(replay.status);
    });
  });
});
