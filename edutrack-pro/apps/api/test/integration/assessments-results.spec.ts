import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, listOf, pdfFixture, resetDatabase, type TestSchool } from '../support/harness';

/** Assessment lifecycle: create → attach evidence → enter results → publish → correct. */
describe('Assessment lifecycle and results (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let school: TestSchool;
  let assessmentId: string;
  let fileId: string;

  const assessmentPayload = (overrides: Record<string, unknown> = {}) => ({
    title: 'Term 1 CAT 1 - Fractions',
    description: 'Continuous assessment test on fractions and decimals.',
    academicYearId: school.academicYearId,
    termId: school.termId,
    classId: school.classId,
    learningAreaId: school.learningAreaId,
    categoryId: school.categoryId,
    assessmentDate: '2026-02-10',
    totalMarks: 40,
    usesMarks: true,
    usesRubric: false,
    ...overrides,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    school = await createSchool(app, api, 'Assess');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('lets the assigned teacher create a draft assessment', async () => {
    const response = await api.post('/assessments', assessmentPayload(), school.teacher.token);
    expect(response.status).toBe(201);
    const created = response.body.data as unknown as { id: string; status: string; totalMarks: number };
    assessmentId = created.id;
    expect(created.status).toBe('DRAFT');
    expect(created.totalMarks).toBe(40);
  });

  it('refuses an assessment for a class the teacher does not teach', async () => {
    const otherClass = await api.post(
      '/classes',
      { name: 'Grade 8 Unassigned', gradeId: school.gradeId, academicYearId: school.academicYearId },
      school.admin.token,
    );
    const otherClassId = (otherClass.body.data as unknown as { id: string }).id;

    const response = await api.post('/assessments', assessmentPayload({ classId: otherClassId, title: 'Not mine' }), school.teacher.token);
    expect([403, 404]).toContain(response.status);
  });

  it('validates the assessment payload (marks target required when marks are used)', async () => {
    const response = await api.post('/assessments', assessmentPayload({ totalMarks: null }), school.teacher.token);
    expect(response.status).toBe(400);
  });

  it('uploads a PDF to private storage and attaches it as evidence', async () => {
    const upload = await api.upload('/files/upload?purpose=ASSESSMENT', school.teacher.token, {
      name: 'cat1-question-paper.pdf',
      type: 'application/pdf',
      content: pdfFixture('CAT 1 question paper'),
    });
    expect(upload.status).toBe(201);
    fileId = (upload.body.data as unknown as { id: string }).id;
    expect((upload.body.data as unknown as { downloadUrl: string }).downloadUrl).toContain('/files/');

    const attach = await api.post(`/assessments/${assessmentId}/resources`, { fileId, title: 'Question paper', kind: 'DOCUMENT' }, school.teacher.token);
    expect(attach.status).toBe(201);

    const detail = await api.get(`/assessments/${assessmentId}`, school.teacher.token);
    const resources = (detail.data as unknown as { resources: { id: string }[] }).resources;
    expect(resources.length).toBe(1);
  });

  it('moves the assessment through draft → ready for review', async () => {
    const response = await api.post(`/assessments/${assessmentId}/status`, { status: 'READY_FOR_REVIEW' }, school.teacher.token);
    expect([200, 201]).toContain(response.status);
    const detail = await api.get(`/assessments/${assessmentId}`, school.teacher.token);
    expect((detail.data as unknown as { status: string }).status).toBe('READY_FOR_REVIEW');
  });

  it('saves a draft results grid and rejects a mark above the maximum', async () => {
    const grid = await api.get(`/results/grid/${assessmentId}`, school.teacher.token);
    expect(grid.status).toBe(200);
    const gridData = grid.data as unknown as { assessment: { totalMarks: number }; rows: { learnerId: string; resultId: string | null }[] };
    expect(gridData.assessment.totalMarks).toBe(40);
    // The grid pre-loads every enrolled learner, even before any marks exist.
    expect(gridData.rows.map((r) => r.learnerId)).toContain(school.learnerId);

    const tooHigh = await api.post(
      `/results/grid/${assessmentId}`,
      { results: [{ learnerId: school.learnerId, numericScore: 95 }], saveAsDraft: true },
      school.teacher.token,
    );
    expect(tooHigh.status).toBe(400);
    expect(JSON.stringify(tooHigh.body)).toContain('exceeds the assessment maximum');

    const valid = await api.post(
      `/results/grid/${assessmentId}`,
      { results: [{ learnerId: school.learnerId, numericScore: 34, comment: 'Good working' }], saveAsDraft: true },
      school.teacher.token,
    );
    expect([200, 201]).toContain(valid.status);

    const savedGrid = await api.get(`/results/grid/${assessmentId}`, school.teacher.token);
    const row = (savedGrid.data as unknown as { rows: { learnerId: string; numericScore: number | null; resultId: string | null }[] }).rows.find(
      (r) => r.learnerId === school.learnerId,
    );
    expect(row?.numericScore).toBe(34);
    expect(row?.resultId).toBeTruthy();
  });

  it('hides unpublished results from the parent', async () => {
    const response = await api.get(`/results/learner/${school.learnerId}`, school.parent.token);
    expect(response.status).toBe(200);
    // Draft marks in another term/assessment must not leak; the learner only ever
    // sees published results through this endpoint.
    const visible = JSON.stringify(response.data);
    expect(visible).toContain('"results":[]');
  });

  it('publishes the assessment, notifies guardians and exposes results to the linked parent only', async () => {
    const publish = await api.post(`/assessments/${assessmentId}/publish`, { notifyParents: true }, school.teacher.token);
    expect([200, 201]).toContain(publish.status);

    const detail = await api.get(`/assessments/${assessmentId}`, school.teacher.token);
    expect((detail.data as unknown as { status: string }).status).toBe('PUBLISHED');

    const parentResults = await api.get(`/results/learner/${school.learnerId}`, school.parent.token);
    const parentPayload = parentResults.data as unknown as {
      results: { assessmentTitle: string; numericScore: number; percent: number; status: string; reportingBasis: string }[];
    };
    const published = parentPayload.results.find((r) => r.assessmentTitle.includes('Fractions'));
    expect(published).toBeTruthy();
    expect(published?.numericScore).toBe(34);
    expect(published?.percent).toBe(85);
    expect(published?.status).toBe('PUBLISHED');
    // The school's own band, never a national/KNEC grade.
    expect(published?.reportingBasis).toBe('SCHOOL_DEFINED_ACHIEVEMENT_BAND');

    const notifications = await api.get('/notifications', school.parent.token);
    expect(listOf(notifications.data).length).toBeGreaterThan(0);

    // Notification rows are per-school: the other school's admin sees nothing.
    const other = await createSchool(app, api, 'Assess2');
    const otherNotifications = await api.get('/notifications', other.admin.token);
    expect(listOf(otherNotifications.data).length).toBe(0);
  });

  it('locks resources once the assessment is published', async () => {
    const response = await api.post(`/assessments/${assessmentId}/resources`, { title: 'Late addition' }, school.teacher.token);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('appends a narrative comment to a published result so guardians see teacher feedback', async () => {
    const grid = await api.get(`/results/grid/${assessmentId}`, school.teacher.token);
    const resultId = (grid.data as unknown as { rows: { learnerId: string; resultId: string }[] }).rows.find(
      (r) => r.learnerId === school.learnerId,
    )!.resultId;

    const feedback = await api.post('/results/feedback', { resultId, narrative: 'Amina shows strong understanding of equivalent fractions.', isPublished: true }, school.teacher.token);
    expect([200, 201]).toContain(feedback.status);

    const parentResults = await api.get(`/results/learner/${school.learnerId}`, school.parent.token);
    expect(JSON.stringify(parentResults.data)).toContain('strong understanding of equivalent fractions');
  });

  it('amends a published result only with a reason, and keeps an immutable history', async () => {
    const grid = await api.get(`/results/grid/${assessmentId}`, school.teacher.token);
    const resultId = (grid.data as unknown as { rows: { learnerId: string; resultId: string }[] }).rows.find(
      (r) => r.learnerId === school.learnerId,
    )!.resultId;
    expect(resultId).toBeTruthy();

    const noReason = await api.patch(`/results/${resultId}/amend`, { numericScore: 36 }, school.teacher.token);
    expect(noReason.status).toBe(400);

    const amended = await api.patch(
      `/results/${resultId}/amend`,
      { numericScore: 36, reason: 'Re-marked question 4 after moderation', notifyParents: true },
      school.teacher.token,
    );
    expect([200, 201]).toContain(amended.status);

    const history = await api.get(`/results/${resultId}/history`, school.teacher.token);
    const entries = listOf<{ toValue?: unknown; reason?: string }>(history.data);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(history.data)).toContain('Re-marked question 4');

    const audit = await api.get('/audit-logs?pageSize=50', school.admin.token);
    expect(JSON.stringify(audit.data)).toContain('result.amended');
  });

  it('shows the assessment dashboard counts for the term', async () => {
    const response = await api.get('/assessments/dashboard', school.admin.token);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.data).length).toBeGreaterThan(10);
  });

  it('denies parents the ability to enter or publish results', async () => {
    const enter = await api.post(
      `/results/grid/${assessmentId}`,
      { results: [{ learnerId: school.learnerId, numericScore: 40 }], saveAsDraft: true },
      school.parent.token,
    );
    const publish = await api.post(`/assessments/${assessmentId}/publish`, {}, school.parent.token);
    expect([401, 403]).toContain(enter.status);
    expect([401, 403]).toContain(publish.status);
  });
});
