import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, pdfFixture, pngFixture, resetDatabase, type TestSchool } from '../support/harness';

/**
 * Private document storage.
 *
 * The rules under test are the ones that keep child data safe: content (not the
 * file extension) decides the type, nothing is publicly reachable, and every
 * download is authorised per user and per school.
 */
describe('Secure file storage (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let school: TestSchool;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    school = await createSchool(app, api, 'Files');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('publishes the upload policy for client-side pickers', async () => {
    const response = await api.get('/files/policy', school.teacher.token);
    expect(response.status).toBe(200);
    const policy = response.data as unknown as { maxBytes: number; allowedMimeTypes: string[] };
    expect(policy.maxBytes).toBeGreaterThan(0);
    expect(policy.allowedMimeTypes).toContain('application/pdf');
    expect(policy.allowedMimeTypes).not.toContain('application/x-msdownload');
  });

  it('accepts a real PDF and a real PNG', async () => {
    const pdf = await api.upload('/files/upload', school.teacher.token, { name: 'notes.pdf', type: 'application/pdf', content: pdfFixture() });
    const png = await api.upload('/files/upload', school.teacher.token, { name: 'diagram.png', type: 'image/png', content: pngFixture() });
    expect(pdf.status).toBe(201);
    expect(png.status).toBe(201);
    expect((png.body.data as unknown as { mimeType: string }).mimeType).toBe('image/png');
  });

  it('rejects an executable disguised as a PDF (content sniffing, not extensions)', async () => {
    const response = await api.upload('/files/upload', school.teacher.token, {
      name: 'invoice.pdf',
      type: 'application/pdf',
      content: Buffer.from('MZ\x90\x00\x03\x00\x00\x00executable payload', 'latin1'),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a PNG renamed to .pdf (signature and name must agree)', async () => {
    const response = await api.upload('/files/upload', school.teacher.token, {
      name: 'photo.pdf',
      type: 'application/pdf',
      content: pngFixture(),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a file larger than the configured limit', async () => {
    const response = await api.upload('/files/upload', school.teacher.token, {
      name: 'huge.pdf',
      type: 'application/pdf',
      content: Buffer.concat([pdfFixture(), Buffer.alloc(16 * 1024 * 1024)]),
    });
    expect([400, 413]).toContain(response.status);
  });

  it('streams an authorised download with safe headers and never a public URL', async () => {
    const upload = await api.upload('/files/upload', school.teacher.token, { name: 'answer-key.pdf', type: 'application/pdf', content: pdfFixture('answer key') });
    const fileId = (upload.body.data as unknown as { id: string }).id;
    const downloadUrl = (upload.body.data as unknown as { downloadUrl: string }).downloadUrl;
    expect(downloadUrl).toContain('/api/v1/files/');
    expect(downloadUrl).not.toMatch(/https?:\/\/(?!localhost)/);

    const download = await api.get(`/files/${fileId}/download`, school.teacher.token);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['cache-control']).toContain('no-store');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-disposition']).toContain('inline');
  });

  it('refuses an unauthenticated download and hides files from other schools', async () => {
    const upload = await api.upload('/files/upload', school.teacher.token, { name: 'private.pdf', type: 'application/pdf', content: pdfFixture('private') });
    const fileId = (upload.body.data as unknown as { id: string }).id;

    const anonymous = await api.get(`/files/${fileId}/download`);
    expect(anonymous.status).toBe(401);

    const other = await createSchool(app, api, 'Files2');
    const foreign = await api.get(`/files/${fileId}/download`, other.admin.token);
    expect([403, 404]).toContain(foreign.status);
  });

  it('keeps an assignment-only document away from an unlinked parent until it is published', async () => {
    const upload = await api.upload('/files/upload?purpose=ASSESSMENT', school.teacher.token, {
      name: 'marked-script.pdf',
      type: 'application/pdf',
      content: pdfFixture('marked script'),
    });
    const fileId = (upload.body.data as unknown as { id: string }).id;

    const assessment = await api.post(
      '/assessments',
      {
        title: 'Term 1 CAT 1 - Fractions',
        academicYearId: school.academicYearId,
        termId: school.termId,
        classId: school.classId,
        learningAreaId: school.learningAreaId,
        categoryId: school.categoryId,
        assessmentDate: '2026-02-10',
        totalMarks: 40,
        usesMarks: true,
        usesRubric: false,
      },
      school.teacher.token,
    );
    const assessmentId = (assessment.body.data as unknown as { id: string }).id;
    await api.post(`/assessments/${assessmentId}/resources`, { fileId, title: 'Marked script', kind: 'DOCUMENT' }, school.teacher.token);

    const beforePublish = await api.get(`/files/${fileId}/download`, school.parent.token);
    expect([403, 404]).toContain(beforePublish.status);

    await api.post(`/results/grid/${assessmentId}`, { results: [{ learnerId: school.learnerId, numericScore: 30 }], saveAsDraft: true }, school.teacher.token);
    await api.post(`/assessments/${assessmentId}/publish`, { notifyParents: true }, school.teacher.token);

    const afterPublish = await api.get(`/files/${fileId}/download`, school.parent.token);
    expect(afterPublish.status).toBe(200);
  });

  it('will not delete a file while a live resource references it, but frees it once archived', async () => {
    const upload = await api.upload('/files/upload', school.teacher.token, { name: 'linked.pdf', type: 'application/pdf', content: pdfFixture('linked') });
    const fileId = (upload.body.data as unknown as { id: string }).id;

    const resource = await api.post(
      '/resources',
      { title: 'Fractions notes', type: 'FILE', classId: school.classId, learningAreaId: school.learningAreaId, fileId },
      school.teacher.token,
    );
    expect([200, 201]).toContain(resource.status);

    const blocked = await api.del(`/files/${fileId}`, school.teacher.token);
    expect(blocked.status).toBeGreaterThanOrEqual(400);

    // Archiving the resource is how a teacher detaches it; the file becomes
    // deletable again while the archived row keeps its history.
    const resourceId = (resource.body.data as unknown as { id: string }).id;
    const archive = await api.del(`/resources/${resourceId}`, school.teacher.token);
    expect([200, 204]).toContain(archive.status);
    const archived = await prisma.learningResource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.fileId).toBe(fileId);

    const removed = await api.del(`/files/${fileId}`, school.teacher.token);
    expect([200, 204]).toContain(removed.status);
    const gone = await api.get(`/files/${fileId}/download`, school.teacher.token);
    expect([403, 404]).toContain(gone.status);
  });

  it('never stores the original path traversal in an object key', async () => {
    const upload = await api.upload('/files/upload', school.teacher.token, {
      name: '../../../../etc/passwd.pdf',
      type: 'application/pdf',
      content: pdfFixture('traversal'),
    });
    expect(upload.status).toBe(201);
    const fileId = (upload.body.data as unknown as { id: string }).id;
    const record = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    expect(record.objectKey).not.toContain('..');
    expect(record.objectKey.startsWith(school.id)).toBe(true);
    expect(record.originalName).not.toContain('/');
  });
});
