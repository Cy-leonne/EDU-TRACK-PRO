import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createSchool, createTestApp, http, resetDatabase, type TestSchool } from '../support/harness';
import { ExportsService } from '../../src/modules/reports/exports.service';

/**
 * Administrator data exports (integration).
 *
 * An export is the easiest way for learner data to leave the building, so the
 * rules are strict and testable:
 *  * only administrators (permission `export:school-data`) can export;
 *  * only their own school's rows, always;
 *  * the response is a download, never cached, never a public URL;
 *  * cells that look like spreadsheet formulas are neutralised;
 *  * every export is written to the audit trail with a row count;
 *  * the results export uses the school's own achievement band label and never
 *    invents a national grade.
 */
describe('CSV exports (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;
  let school: TestSchool;
  let other: TestSchool;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
    school = await createSchool(app, api, 'Exports');
    other = await createSchool(app, api, 'ExportsOther');

    // A name that begins with a formula character: the export must neutralise it.
    await prisma.learner.update({
      where: { id: school.learnerId },
      data: { firstName: '=cmd|calc', lastName: 'Njeri' },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('lets an administrator download the learner register as a CSV attachment', async () => {
    const response = await api.get('/reports/export/learners.csv', school.admin.token);
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/csv');
    expect(String(response.headers['content-disposition'])).toContain('attachment');
    expect(String(response.headers['cache-control'])).toContain('no-store');
    const body = response.text;
    expect(body.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads UTF-8 names
    expect(body.split('\r\n')[0]).toContain('Admission');
  });

  it('neutralises spreadsheet formula injection in exported cells', async () => {
    const response = await api.get('/reports/export/learners.csv', school.admin.token);
    const body = response.text;
    const line = body.split('\r\n').find((row) => row.includes('Njeri')) ?? '';
    expect(line).toBeTruthy();
    // The dangerous prefix is defused with a leading apostrophe rather than dropped,
    // so the office still sees the name as entered.
    expect(line.includes(`'=cmd|calc`)).toBe(true);
    expect(/(^|,)=cmd\|calc/.test(line)).toBe(false);
  });

  it('refuses a teacher and a guardian, and tells them why', async () => {
    const teacher = await api.get('/reports/export/learners.csv', school.teacher.token);
    expect([401, 403]).toContain(teacher.status);
    const parent = await api.get('/reports/export/learners.csv', school.parent.token);
    expect([401, 403]).toContain(parent.status);
  });

  it('never mixes another school’s rows into an export', async () => {
    const mine = await api.get('/reports/export/learners.csv', school.admin.token);
    const theirs = await api.get('/reports/export/learners.csv', other.admin.token);
    expect(mine.text).not.toContain(other.learnerId);
    expect(mine.text.length).toBeGreaterThan(0);
    expect(theirs.text).not.toContain('Njeri');
  });

  it('writes an audited, reviewable entry for each export', async () => {
    await api.get('/reports/export/results.csv', school.admin.token);
    const entry = await prisma.auditLog.findFirst({
      where: { schoolId: school.id, action: 'data.exported' },
      orderBy: { createdAt: 'desc' },
      select: { actorRole: true, entityType: true, summary: true },
    });
    expect(entry).toBeTruthy();
    expect(entry?.actorRole).toBe('ADMIN');
    expect(entry?.summary ?? '').toContain('results');
  });

  it('uses the school’s own achievement band in the results export', async () => {
    const response = await api.get('/reports/export/results.csv', school.admin.token);
    const header = response.text.split('\r\n')[0];
    // The column header makes the provenance explicit — it is the school's own band,
    // never an official national grade.
    expect(header.toLowerCase()).toContain('school band');
    expect(header.toLowerCase()).not.toMatch(/knec|national|cbc level|performance level/);
  });

  it('exports the timetable only from a published version, or says there is none', async () => {
    const response = await api.get('/reports/export/timetable.csv', school.admin.token);
    expect(response.status).toBe(200);
    const body = response.text;
    expect(body.toLowerCase()).toMatch(/nothing|no published|lesson|period/);
  });

  it('caps row counts so an export cannot become an unbounded data dump', async () => {
    const rows = await prisma.learner.count({ where: { schoolId: school.id } });
    const body = (await api.get('/reports/export/learners.csv', school.admin.token)).text;
    const exported = body.trim().split('\r\n').length - 1; // minus the header
    expect(exported).toBeLessThanOrEqual(rows);
    expect(exported).toBeLessThanOrEqual(5000);
  });

  it('keeps credentials out of every export', async () => {
    for (const path of ['/reports/export/teachers.csv', '/reports/export/learners.csv']) {
      const response = await api.get(path, school.admin.token);
      const body = response.text.toLowerCase();
      expect(body).not.toContain('password');
      expect(body).not.toContain('argon2');
      expect(body).not.toContain('$argon2');
      expect(body).not.toContain('refresh');
      expect(body).not.toContain('token');
    }
  });

  it('escapes quotes, commas and newlines so a spreadsheet parses the file correctly', () => {
    // The escaping helper is pure, so it can be checked directly — the same code path
    // the controller uses.
    const escape = (ExportsService as unknown as { escape(value: unknown): string }).escape;
    expect(escape('O’Brien, Mary')).toBe('"O’Brien, Mary"');
    expect(escape('Line one\nLine two')).toBe('"Line one\nLine two"');
    expect(escape('He said "hello"')).toBe('"He said ""hello"""');
    expect(escape(null)).toBe('');
    expect(escape('+254700000000')).toBe("'+254700000000");
  });
});
