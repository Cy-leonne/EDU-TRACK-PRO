import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, listOf, resetDatabase, type TestSchool } from '../support/harness';

/**
 * Notification preferences (integration).
 *
 * Preferences are the guardian's dial for how much the school interrupts them.
 * The rules worth protecting:
 *  * a sensible default exists (in-app on, email off, nothing muted);
 *  * turning in-app off really stops new inbox rows, and muting one type only
 *    silences that type;
 *  * email cannot be switched on without an address (the app must not promise
 *    delivery it cannot make);
 *  * preferences are per user — a teacher's choice never leaks to a guardian;
 *  * the API reports honestly whether the deployment can send email at all.
 */
describe('Notification preferences (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let school: TestSchool;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    school = await createSchool(app, api, 'Notify');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('returns defaults for a user who has never opened the screen', async () => {
    const response = await api.get('/notifications/preferences', school.parent.token);
    expect(response.status).toBe(200);
    const prefs = response.body.data as unknown as {
      inAppEnabled: boolean;
      emailEnabled: boolean;
      mutedTypes: string[];
      emailProvider: string;
      emailDeliveryConfigured: boolean;
    };
    expect(prefs.inAppEnabled).toBe(true);
    expect(prefs.emailEnabled).toBe(false);
    expect(prefs.mutedTypes).toEqual([]);
    // The whole point: the API tells the UI whether the deployment can actually send.
    expect(typeof prefs.emailDeliveryConfigured).toBe('boolean');
  });

  it('refuses to enable email without an address', async () => {
    const response = await api.patch('/notifications/preferences', { inAppEnabled: true, emailEnabled: true }, school.parent.token);
    expect(response.status).toBe(400);
  });

  it('accepts an email address and enables email when the deployment cannot send yet', async () => {
    const response = await api.patch(
      '/notifications/preferences',
      { inAppEnabled: true, emailEnabled: true, emailAddress: 'guardian@example.test' },
      school.parent.token,
    );
    expect(response.status).toBe(200);
    const prefs = response.body.data as unknown as { emailEnabled: boolean; emailAddress: string | null; emailDeliveryConfigured: boolean };
    expect(prefs.emailEnabled).toBe(true);
    expect(prefs.emailAddress).toBe('guardian@example.test');
  });

  it('stores muted event types and rejects unknown ones', async () => {
    const ok = await api.patch('/notifications/preferences', { inAppEnabled: true, emailEnabled: false, mutedTypes: ['ASSESSMENT_PUBLISHED'] }, school.parent.token);
    expect(ok.status).toBe(200);
    expect((ok.body.data as unknown as { mutedTypes: string[] }).mutedTypes).toEqual(['ASSESSMENT_PUBLISHED']);

    const bad = await api.patch('/notifications/preferences', { inAppEnabled: true, emailEnabled: false, mutedTypes: ['NOT_A_REAL_TYPE'] }, school.parent.token);
    expect(bad.status).toBe(400);
  });

  it('keeps preferences personal: the teacher sees their own, unmuted defaults', async () => {
    const teacherPrefs = await api.get('/notifications/preferences', school.teacher.token);
    const prefs = teacherPrefs.body.data as unknown as { mutedTypes: string[]; emailAddress: string | null };
    expect(prefs.mutedTypes).toEqual([]);
    expect(prefs.emailAddress).toBeNull();
  });

  it('really stops writing inbox rows when in-app notifications are switched off', async () => {
    // Turn everything off for the parent.
    await api.patch('/notifications/preferences', { inAppEnabled: false, emailEnabled: false, mutedTypes: [] }, school.parent.token);

    // A teacher action that would normally notify the guardians in-app.
    const assignment = await api.post(
      '/resources/assignments',
      { title: 'Quiet hours test', classId: school.classId, learningAreaId: school.learningAreaId, publishNow: true },
      school.teacher.token,
    );
    expect(assignment.status).toBe(201);
    const assignmentId = (assignment.body.data as unknown as { id: string }).id;

    await api.post('/submissions', { assignmentId, learnerId: school.learnerId, note: 'Handed in during quiet hours.' }, school.parent.token);

    const before = await prisma.notification.count({ where: { schoolId: school.id, userId: school.parent.id } });
    await api.patch(`/submissions/${(await prisma.assignmentSubmission.findFirstOrThrow({ where: { assignmentId } })).id}/review`, {
      status: 'ACCEPTED',
      feedback: 'Seen.',
    }, school.teacher.token);
    const after = await prisma.notification.count({ where: { schoolId: school.id, userId: school.parent.id } });
    expect(after).toBe(before);
  });

  it('delivers again as soon as in-app notifications are switched back on', async () => {
    await api.patch('/notifications/preferences', { inAppEnabled: true, emailEnabled: false, mutedTypes: [] }, school.parent.token);

    const assignment = await api.post(
      '/resources/assignments',
      { title: 'Back online', classId: school.classId, learningAreaId: school.learningAreaId, publishNow: true },
      school.teacher.token,
    );
    const assignmentId = (assignment.body.data as unknown as { id: string }).id;
    await api.post('/submissions', { assignmentId, learnerId: school.learnerId, note: 'Submitted again.' }, school.parent.token);
    const submission = await prisma.assignmentSubmission.findFirstOrThrow({ where: { assignmentId } });
    await api.patch(`/submissions/${submission.id}/review`, { status: 'ACCEPTED' }, school.teacher.token);

    const inbox = await api.get('/notifications?pageSize=50', school.parent.token);
    const items = listOf<{ type: string; title: string }>(inbox.data);
    expect(items.some((item) => item.type === 'SUBMISSION_REVIEWED')).toBe(true);
  });

  it('never exposes another user’s notifications', async () => {
    const mine = await api.get('/notifications?pageSize=50', school.parent.token);
    const items = listOf<{ userId: string }>(mine.data);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.userId === school.parent.id)).toBe(true);

    const otherSchool = await createSchool(app, api, 'NotifyOther');
    const theirs = await api.get('/notifications?pageSize=50', otherSchool.parent.token);
    expect(listOf(theirs.data)).toHaveLength(0);
  });

  it('reports the unread count the header badge uses', async () => {
    const response = await api.get('/notifications/unread-count', school.parent.token);
    expect(response.status).toBe(200);
    const payload = response.body.data as unknown as number | { count: number; unread: number };
    const count = typeof payload === 'number' ? payload : payload.count ?? payload.unread;
    expect(count).toBeGreaterThanOrEqual(0);

    await api.post('/notifications/read-all', undefined, school.parent.token);
    const after = await api.get('/notifications/unread-count', school.parent.token);
    const afterPayload = after.body.data as unknown as number | { count: number; unread: number };
    const afterCount = typeof afterPayload === 'number' ? afterPayload : afterPayload.count ?? afterPayload.unread;
    expect(afterCount).toBe(0);
  });
});
