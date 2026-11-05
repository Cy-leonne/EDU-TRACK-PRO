import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, listOf, pdfFixture, resetDatabase, type TestSchool } from '../support/harness';

/**
 * Assignment hand-ins (integration).
 *
 * Learners have no accounts in this product, so a hand-in is always submitted by
 * somebody else *on behalf of* a learner: a guardian (normal case) or a teacher.
 * These tests pin the rules that make that safe —
 *  * only a verified guardian link may submit, and only for its own learner;
 *  * the guardian can only hand in for a published assignment in their child's class;
 *  * who submitted is recorded (proxy hand-ins are auditable);
 *  * late work is flagged, not rejected, because the school decides how to treat it;
 *  * returned work can be resubmitted, accepted work cannot be quietly replaced;
 *  * reviews notify the guardians and are visible to the teacher who owns the class.
 */
describe('Assignment submissions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let school: TestSchool;
  let other: TestSchool;
  let assignmentId: string;
  let submissionId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    school = await createSchool(app, api, 'Submissions');
    other = await createSchool(app, api, 'Other');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('lets the assigned teacher publish an assignment for their class', async () => {
    const response = await api.post(
      '/resources/assignments',
      {
        title: 'Notes pack exercises 1-10',
        instructions: 'Complete exercises 1 to 10 and photograph each page.',
        classId: school.classId,
        learningAreaId: school.learningAreaId,
        dueDate: '2026-03-01',
        maxScore: 20,
        publishNow: true,
      },
      school.teacher.token,
    );
    expect(response.status).toBe(201);
    assignmentId = (response.body.data as unknown as { id: string }).id;
  });

  it('accepts a hand-in from the linked guardian, with a file and who submitted it', async () => {
    const file = await api.upload(
      '/files/upload?purpose=SUBMISSION',
      school.parent.token,
      { name: 'exercise-book.pdf', type: 'application/pdf', content: pdfFixture() },
    );
    expect(file.status).toBe(201);
    const fileId = (file.body.data as unknown as { id: string }).id;

    const response = await api.post(
      '/submissions',
      { assignmentId, learnerId: school.learnerId, fileId, note: 'Photographed all ten exercises.' },
      school.parent.token,
    );
    expect(response.status).toBe(201);
    const created = response.body.data as unknown as {
      id: string;
      status: string;
      submittedByName: string | null;
      submitterRole: string;
      file: { id: string } | null;
    };
    submissionId = created.id;
    expect(['SUBMITTED', 'LATE']).toContain(created.status);
    expect(created.submitterRole).toBe('PARENT');
    expect(created.submittedByName).toBeTruthy();
    expect(created.file?.id).toBe(fileId);
  });

  it('never exposes the hand-in to a different school', async () => {
    const mine = await api.get('/submissions', other.parent.token);
    expect(mine.status).toBe(200);
    expect(listOf<{ id: string }>(mine.data)).toHaveLength(0);
    const direct = await api.get(`/submissions/${submissionId}`, other.admin.token);
    expect([403, 404]).toContain(direct.status);
  });

  it('refuses a hand-in for a learner the guardian is not linked to', async () => {
    const response = await api.post(
      '/submissions',
      { assignmentId, learnerId: other.learnerId, note: 'Trying another school’s learner.' },
      school.parent.token,
    );
    expect([403, 404]).toContain(response.status);
  });

  it('refuses a hand-in with neither a file, a link nor a note', async () => {
    const response = await api.post('/submissions', { assignmentId, learnerId: school.learnerId }, school.parent.token);
    expect(response.status).toBe(400);
  });

  it('shows the hand-in to the teacher who owns the class, with a completion summary', async () => {
    const summary = await api.get(`/submissions/summary/${assignmentId}`, school.teacher.token);
    expect(summary.status).toBe(200);
    const data = summary.body.data as unknown as {
      // The summary is keyed per enrolled learner, so a learner without a hand-in is
      // present with status MISSING and a null submissionId. The UI relies on this to
      // show who is outstanding, which is why the identity field is `submissionId`.
      rows: Array<{ learnerId: string; learnerName: string; status: string; submissionId: string | null }>;
      completion: { expected: number; handedIn: number; missing: number; late: number; completionPercent: number };
    };
    expect(data.completion.expected).toBeGreaterThanOrEqual(1);
    expect(data.completion.handedIn).toBe(1);
    expect(data.completion.missing).toBe(data.completion.expected - 1);
    expect(data.rows.map((row) => row.submissionId)).toContain(submissionId);
  });

  it('lets the teacher return the work with a reason the guardian can read', async () => {
    const response = await api.patch(
      `/submissions/${submissionId}/review`,
      { status: 'RETURNED', returnedReason: 'Page 4 is missing — photograph it again.' },
      school.teacher.token,
    );
    expect(response.status).toBe(200);
    const reviewed = response.body.data as unknown as { status: string; returnedReason: string };
    expect(reviewed.status).toBe('RETURNED');
    expect(reviewed.returnedReason).toContain('Page 4');

    const guardianView = await api.get(`/submissions?learnerId=${school.learnerId}`, school.parent.token);
    const rows = listOf<{ id: string; status: string; returnedReason: string | null }>(guardianView.data);
    const row = rows.find((item) => item.id === submissionId);
    expect(row?.status).toBe('RETURNED');
    expect(row?.returnedReason).toContain('Page 4');
  });

  it('refuses to return work without a reason', async () => {
    const response = await api.patch(`/submissions/${submissionId}/review`, { status: 'RETURNED' }, school.teacher.token);
    expect(response.status).toBe(400);
  });

  it('lets the guardian resubmit after a return and then the teacher accept it', async () => {
    const resubmit = await api.post(
      '/submissions',
      { assignmentId, learnerId: school.learnerId, note: 'Added page 4 as requested.' },
      school.parent.token,
    );
    expect([200, 201]).toContain(resubmit.status);
    submissionId = (resubmit.body.data as unknown as { id: string }).id;

    const accept = await api.patch(
      `/submissions/${submissionId}/review`,
      { status: 'ACCEPTED', score: 18, feedback: 'Complete and neatly labelled.' },
      school.teacher.token,
    );
    expect(accept.status).toBe(200);
    const accepted = accept.body.data as unknown as { status: string; score: number };
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.score).toBe(18);
    // The review response returns the record; the reviewer's name is resolved by the
    // list read model the UI actually renders.
    const asTeacher = await api.get('/submissions?pageSize=50', school.teacher.token);
    const reviewedRow = listOf<{ id: string; reviewedByName: string | null }>(asTeacher.data).find((row) => row.id === submissionId);
    expect(reviewedRow?.reviewedByName).toBeTruthy();
  });

  it('refuses to hand in over an acceptance (the teacher must return it first)', async () => {
    const response = await api.post(
      '/submissions',
      { assignmentId, learnerId: school.learnerId, note: 'Trying to replace accepted work.' },
      school.parent.token,
    );
    expect(response.status).toBe(400);
  });

  it('notifies the guardians in-app when work is reviewed', async () => {
    const notifications = await api.get('/notifications?pageSize=50', school.parent.token);
    const items = listOf<{ type: string; title: string; entityType?: string | null }>(notifications.data);
    const reviewNotices = items.filter((item) => item.type === 'SUBMISSION_REVIEWED');
    expect(reviewNotices.length).toBeGreaterThan(0);
    expect(reviewNotices.some((item) => item.entityType === 'AssignmentSubmission')).toBe(true);
  });

  it('records the workflow in the audit trail', async () => {
    const actions = await prisma.auditLog.findMany({
      where: { schoolId: school.id, entityType: 'AssignmentSubmission' },
      select: { action: true },
    });
    const seen = new Set(actions.map((entry) => entry.action));
    expect(seen.has('submission.created')).toBe(true);
    expect(seen.has('submission.reviewed')).toBe(true);
  });

  it('refuses a submitter from another school entirely', async () => {
    const response = await api.post(
      '/submissions',
      { assignmentId, learnerId: school.learnerId, note: 'Cross-tenant attempt.' },
      other.teacher.token,
    );
    expect([403, 404]).toContain(response.status);
  });
});
