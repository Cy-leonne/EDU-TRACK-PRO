import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createTestApp, http, listOf, pdfFixture, resetDatabase } from '../support/harness';

/**
 * End-to-end journeys (1–10).
 *
 * These follow the acceptance criteria in the brief as a single narrative, on one
 * empty school, in order — the way a real school would actually on-board. The
 * integration suites test each module in depth; this file answers the different
 * question: *can a school run its term from start to finish on this build?*
 *
 *  1  Admin signs in and sets up the school profile
 *  2  Admin creates a teacher and the teacher signs in
 *  3  Admin registers learners (incl. CSV import with a dry run) and a class
 *  4  Admin assigns the teacher to the class + learning area
 *  5  Admin sets the calendar and the bell schedule
 *  6  Admin generates → validates → adjusts → publishes the timetable
 *  7  Teacher sees their timetable, creates an assessment, attaches a PDF/image,
 *     enters results and publishes them
 *  8  Parent sees the published result and the timetable
 *  9  Parent (an unauthorised one) is denied
 * 10  The whole chain is auditable
 */
describe('End-to-end journeys (1–10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof http>;

  const password = 'Journey-EduTrack-2026!pass';
  const state: Record<string, string> = {};

  const TEACHER_CSV = ['first name,last name,email,staff number,phone,employment type', 'Amina,Kiptoo,amina.kiptoo@journey.test,STF-001,+254700000001,Permanent'].join('\n');
  const LEARNER_CSV = [
    'admission number,first name,last name,gender,date of birth,assessment number,grade,class,home location',
    'ADM-001,Atieno,Njoroge,FEMALE,2014-06-28,700001,Grade 7,Grade 7 Tumaini,Nakuru',
    'ADM-002,Brian,Kimani,MALE,2014-03-11,700002,Grade 7,Grade 7 Tumaini,Gilgil',
  ].join('\n');

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    api = http(app);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /* ------------------------------------------------------------------ 1 --- */

  it('journey 1 — the first administrator sets up the school and signs in', async () => {
    const school = await prisma.school.create({
      data: { name: 'Journey Junior School', code: 'JOURNEY-001', workingDays: [1, 2, 3, 4, 5], schoolOpenTime: '07:30', schoolCloseTime: '15:30' },
    });
    state.schoolId = school.id;

    const adminUser = await prisma.user.create({
      data: {
        email: 'principal@journey.test',
        fullName: 'Grace Wanjiru',
        passwordHash: await app.get(require('../../src/modules/auth/password.service').PasswordService).hash(password),
        memberships: { create: { schoolId: school.id, role: 'ADMIN', status: 'ACTIVE' } },
      },
    });
    state.adminUserId = adminUser.id;

    const login = await api.post('/auth/login', { email: 'principal@journey.test', password, clientType: 'WEB' });
    expect(login.status).toBe(200);
    state.adminToken = (login.data as unknown as { accessToken: string }).accessToken;

    // The administrator can configure the school profile (name, colours, timezone…).
    const profile = await api.patch(
      '/school/profile',
      {
        name: 'Journey Junior School',
        timezone: 'Africa/Nairobi',
        primaryColor: '#14532d',
        workingDays: [1, 2, 3, 4, 5],
        schoolOpenTime: '07:30',
        schoolCloseTime: '15:30',
        defaultPeriodMinutes: 40,
        maxPeriodsPerDay: 6,
        lunchAfterPeriod: 4,
        lunchMinutes: 45,
        breaks: [{ label: 'Short break', afterPeriod: 2, minutes: 20 }],
      },
      state.adminToken,
    );
    expect(profile.status).toBe(200);
    const profileBody = profile.data as unknown as { timezone: string; workingDays: number[] };
    expect(profileBody.timezone).toBe('Africa/Nairobi');
    expect(profileBody.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  /* ------------------------------------------------------------------ 2 --- */

  it('journey 2 — the administrator creates a teacher, who then signs in and sees an empty but working workspace', async () => {
    const imported = await api.post(
      '/teachers/import',
      { csv: TEACHER_CSV, defaultPassword: 'Teacher-Start-2026!pass' },
      state.adminToken,
    );
    // The route is a multipart upload; if the JSON path is not accepted the API says so
    // rather than 500s, and the create route below is the canonical path.
    if (imported.status !== 201) {
      expect([400, 415]).toContain(imported.status);
    }

    const created = await api.post(
      '/teachers',
      {
        email: 'amina.kiptoo@journey.test',
        fullName: 'Amina Kiptoo',
        staffNumber: 'STF-001',
        phone: '+254700000001',
        employmentType: 'TSC_EMPLOYED',
        maxPeriodsPerWeek: 28,
        temporaryPassword: 'Teacher-Start-2026!pass',
      },
      state.adminToken,
    );
    expect(created.status).toBe(201);
    // POST /teachers answers { teacher, temporaryPassword } — the office needs the
    // one-time password to hand over, so it is returned exactly once, here.
    const teacher = created.data as unknown as { teacher: { id: string; userId: string }; temporaryPassword: string };
    expect(teacher.teacher.id).toBeTruthy();
    expect(teacher.temporaryPassword).toBeTruthy();
    state.teacherProfileId = teacher.teacher.id;
    state.teacherUserId = teacher.teacher.userId;

    // A newly created teacher must change the temporary password before doing work.
    const firstLogin = await api.post('/auth/login', { email: 'amina.kiptoo@journey.test', password: 'Teacher-Start-2026!pass', clientType: 'WEB' });
    expect(firstLogin.status).toBe(200);
    const loginData = firstLogin.data as unknown as { accessToken: string; user: { role: string; mustChangePassword?: boolean } };
    expect(loginData.user.role).toBe('TEACHER');
    expect(loginData.user.mustChangePassword).toBe(true);
    state.teacherToken = loginData.accessToken;

    const dashboard = await api.get('/dashboard/teacher', state.teacherToken);
    expect(dashboard.status).toBe(200);

    const passwordChange = await api.post(
      '/auth/password/change',
      { currentPassword: 'Teacher-Start-2026!pass', newPassword: 'Nakuru-Teacher-2026!ok' },
      state.teacherToken,
    );
    expect(passwordChange.status).toBe(200);
    const reLogin = await api.post('/auth/login', { email: 'amina.kiptoo@journey.test', password: 'Nakuru-Teacher-2026!ok', clientType: 'WEB' });
    expect(reLogin.status).toBe(200);
    state.teacherToken = (reLogin.data as unknown as { accessToken: string }).accessToken;
  });

  /* ------------------------------------------------------------------ 3 --- */

  it('journey 3 — the administrator creates the class, imports learners by CSV (dry run first), then links a guardian', async () => {
    const year = await prisma.academicYear.create({
      data: { schoolId: state.schoolId, name: '2026', startDate: new Date('2026-01-05'), endDate: new Date('2026-10-30'), isCurrent: true },
    });
    state.academicYearId = year.id;
    const term = await prisma.term.create({
      data: { schoolId: state.schoolId, academicYearId: year.id, number: 1, name: 'Term 1', startDate: new Date('2026-01-05'), endDate: new Date('2026-04-03'), isCurrent: true },
    });
    state.termId = term.id;
    await prisma.school.update({ where: { id: state.schoolId }, data: { currentAcademicYearId: year.id, currentTermId: term.id } });

    // Grade 7 already exists in the school's structure (created with the school profile);
    // the CSV references it by name so the importer can resolve it.
    const grade = await prisma.grade.create({ data: { schoolId: state.schoolId, level: 7, name: 'Grade 7', order: 0 } });
    state.gradeId = grade.id;

    const klass = await api.post(
      '/classes',
      { name: 'Grade 7 Tumaini', gradeId: grade.id, academicYearId: year.id, capacity: 45, roomName: 'Block A' },
      state.adminToken,
    );
    expect(klass.status).toBe(201);
    state.classId = (klass.data as unknown as { id: string }).id;

    // A dry run reports per-row problems and writes nothing at all.
    const csvWithBadRow = `${LEARNER_CSV}\nADM-003,,,,,,,,`;
    const dryRun = await api.upload('/learners/import?dryRun=true', state.adminToken, {
      name: 'learners.csv',
      type: 'text/csv',
      content: Buffer.from(csvWithBadRow, 'utf8'),
    });
    expect(dryRun.status).toBe(201);
    const dry = dryRun.data as unknown as { total: number; created: number; errors: Array<{ row: number; message: string }>; preview: unknown[] };
    expect(dry.total).toBe(3);
    expect(dry.created).toBe(0);
    expect(dry.errors.length).toBeGreaterThan(0); // the incomplete third row
    expect(dry.preview).toHaveLength(2); // the two valid rows, previewed but not written
    expect(await prisma.learner.count({ where: { schoolId: state.schoolId } })).toBe(0);

    const imported = await api.upload('/learners/import', state.adminToken, {
      name: 'learners.csv',
      type: 'text/csv',
      content: Buffer.from(LEARNER_CSV, 'utf8'),
    });
    expect(imported.status).toBe(201);
    const outcome = imported.data as unknown as { created: number; updated: number; errors: unknown[] };
    expect(outcome.created).toBe(2);
    expect(outcome.errors).toHaveLength(0);

    const learners = await prisma.learner.findMany({ where: { schoolId: state.schoolId }, orderBy: { admissionNumber: 'asc' } });
    expect(learners).toHaveLength(2);
    expect(learners[0].assessmentNumber).toBe('700001');
    // The class column was resolved, and the learner is enrolled, not just filed.
    expect(learners[0].currentClassId).toBe(state.classId);
    state.learnerId = learners[0].id;
    state.otherLearnerId = learners[1].id;

    const roster = await api.get(`/classes/${state.classId}/learners`, state.adminToken);
    expect(listOf(roster.data)).toHaveLength(2);

    // The guardian account + verified link: the supported administrative flow.
    const parent = await api.post(
      '/parents',
      {
        fullName: 'Mary Njoroge',
        email: 'mary.njoroge@journey.test',
        phone: '+254700000002',
        relationship: 'Mother',
        temporaryPassword: 'Guardian-Start-2026!pass',
      },
      state.adminToken,
    );
    expect(parent.status).toBe(201);
    const parentData = parent.data as unknown as { parent: { id: string }; temporaryPassword: string };
    expect(parentData.parent.id).toBeTruthy();
    expect(parentData.temporaryPassword).toBeTruthy();
    state.parentProfileId = parentData.parent.id;

    const link = await api.post(
      '/parent-links',
      { parentProfileId: state.parentProfileId, learnerId: state.learnerId, relationship: 'Mother', isVerified: true, isPrimaryContact: true },
      state.adminToken,
    );
    expect([200, 201]).toContain(link.status);

    const guardianLogin = await api.post('/auth/login', { email: 'mary.njoroge@journey.test', password: 'Guardian-Start-2026!pass', clientType: 'WEB' });
    expect(guardianLogin.status).toBe(200);
    const guardian = guardianLogin.data as unknown as { accessToken: string; mustChangePassword?: boolean; user: { role: string } };
    expect(guardian.user.role).toBe('PARENT');
    state.guardianToken = guardian.accessToken;

    const guardianChange = await api.post(
      '/auth/password/change',
      { currentPassword: 'Guardian-Start-2026!pass', newPassword: 'Nakuru-Guardian-2026!ok' },
      state.guardianToken,
    );
    expect(guardianChange.status).toBe(200);
    const guardianReLogin = await api.post('/auth/login', { email: 'mary.njoroge@journey.test', password: 'Nakuru-Guardian-2026!ok', clientType: 'WEB' });
    state.guardianToken = (guardianReLogin.data as unknown as { accessToken: string }).accessToken;
  });

  /* ------------------------------------------------------------------ 4 --- */

  it('journey 4 — the administrator creates the learning area and assigns the teacher', async () => {
    const area = await api.post(
      '/learning-areas',
      { code: 'MAT', name: 'Mathematics', defaultPeriodsPerWeek: 5, colorHex: '#B91C1C' },
      state.adminToken,
    );
    expect(area.status).toBe(201);
    state.learningAreaId = (area.data as unknown as { id: string }).id;

    const assignment = await api.post(
      '/teacher-assignments',
      { teacherId: state.teacherProfileId, classId: state.classId, learningAreaId: state.learningAreaId, lessonsPerWeek: 5 },
      state.adminToken,
    );
    expect(assignment.status).toBe(201);

    // The weekly lesson requirement is what the timetable engine actually schedules.
    const requirement = await api.post(
      '/learning-areas/requirements',
      { classId: state.classId, learningAreaId: state.learningAreaId, periodsPerWeek: 5, preferMorning: true },
      state.adminToken,
    );
    expect([200, 201]).toContain(requirement.status);

    // The teacher's own view now reflects the class and area.
    const mine = await api.get('/teacher-assignments/me', state.teacherToken);
    expect(mine.status).toBe(200);
    const payload = mine.data as unknown as { assignments?: unknown[] } | unknown[];
    expect(JSON.stringify(payload)).toContain('Grade 7 Tumaini');
  });

  /* ------------------------------------------------------------------ 5 --- */

  it('journey 5 — the administrator sets the bell schedule (periods, break, lunch)', async () => {
    const response = await api.get('/timetables/periods/default', state.adminToken);
    expect(response.status).toBe(200);
    const suggested = (response.data as unknown as { periods: Array<Record<string, unknown>> }).periods;
    expect(suggested.length).toBeGreaterThan(0);

    const saved = await api.post(
      '/timetables/periods',
      {
        academicYearId: state.academicYearId,
        termId: state.termId,
        periods: suggested.map((period) => ({
          dayOfWeek: period.dayOfWeek,
          sequence: period.sequence,
          label: period.label,
          startTime: period.startTime,
          endTime: period.endTime,
          isBreak: period.isBreak,
          isLunch: period.isLunch,
        })),
      },
      state.adminToken,
    );
    expect([200, 201]).toContain(saved.status);

    const stored = await api.get(`/timetables/periods?academicYearId=${state.academicYearId}`, state.adminToken);
    const periods = listOf<{ dayOfWeek: number; sequence: number; isBreak: boolean; isLunch: boolean; isTeaching: boolean }>(stored.data);
    expect(periods.length).toBeGreaterThan(10);
    expect(periods.some((period) => period.isLunch)).toBe(true);
    expect(periods.some((period) => period.isBreak)).toBe(true);
    // Five working days, and every day has the same shape.
    expect(new Set(periods.map((period) => period.dayOfWeek)).size).toBe(5);
    // No lesson may ever be scheduled into a break or lunch slot.
    expect(periods.filter((period) => period.isBreak || period.isLunch).every((period) => !period.isTeaching)).toBe(true);
  });

  /* ------------------------------------------------------------------ 6 --- */

  it('journey 6 — the administrator generates, validates, adjusts and publishes the timetable', async () => {
    const preflight = await api.get(`/timetables/preflight?academicYearId=${state.academicYearId}&termId=${state.termId}`, state.adminToken);
    expect(preflight.status).toBe(200);
    const checks = preflight.data as unknown as { issues: Array<{ code: string; message: string }>; classes: unknown[] };
    expect(checks.classes.length).toBeGreaterThan(0);

    const generated = await api.post(
      '/timetables/generate',
      { academicYearId: state.academicYearId, termId: state.termId, classIds: [state.classId], name: 'Term 1 2026 — whole school' },
      state.adminToken,
    );
    expect(generated.status).toBe(201);
    const result = generated.data as unknown as {
      status: string;
      timetableId?: string;
      versionId?: string;
      assigned: number;
      unplaced: number;
      conflicts: unknown[];
      diagnostics: Array<{ code: string; message: string }>;
      message?: string;
    };
    state.versionId = result.versionId ?? '';
    state.timetableId = result.timetableId ?? '';

    // If the engine says the request is infeasible it must explain itself — a school can
    // act on diagnostics; it can never be handed a silently invalid grid.
    if (result.status === 'FAILED') {
      expect(result.versionId).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      throw new Error(`Engine reported infeasible for a trivially satisfiable setup: ${JSON.stringify(result.diagnostics)}`);
    }

    expect(result.versionId).toBeTruthy();
    expect(result.assigned).toBeGreaterThan(0);
    expect(result.conflicts).toHaveLength(0);

    const validation = await api.post(`/timetables/${result.versionId}/validate`, undefined, state.adminToken);
    expect([200, 201]).toContain(validation.status);
    const { summary } = validation.data as unknown as { summary: { errors: number; warnings: number } };
    expect(summary.errors).toBe(0);

    // Manual adjustment: move one lesson into a free slot, then re-validate.
    const view = await api.get(`/timetables/versions/${result.versionId}`, state.adminToken);
    const detail = view.data as unknown as {
      periods: Array<{ id: string; sequence: number; dayOfWeek: number; isTeaching: boolean; isBreak: boolean; isLunch: boolean }>;
      entries: Array<{ id: string; classId: string; learningAreaId: string; dayOfWeek: number; sequence: number; periodId: string; learningAreaName: string }>;
    };
    const entry = detail.entries[0];
    const freeSlot = detail.periods.find(
      (period) =>
        period.isTeaching &&
        !period.isBreak &&
        !period.isLunch &&
        !detail.entries.some((item) => item.classId === entry.classId && item.periodId === period.id),
    );
    expect(freeSlot).toBeTruthy();

    const moved = await api.patch(
      '/timetables/entries/move',
      {
        versionId: result.versionId,
        entryId: entry.id,
        targetPeriodId: freeSlot!.id,
        targetDayOfWeek: freeSlot!.dayOfWeek,
        targetSequence: freeSlot!.sequence,
        reason: 'Adjusted after review: moved away from the last period of the day.',
      },
      state.adminToken,
    );
    expect([200, 201]).toContain(moved.status);

    // A published version is read-only: the same move must now be refused.
    // (Checked after publishing, below.)

    const revalidated = await api.post(`/timetables/${result.versionId}/validate`, undefined, state.adminToken);
    const reSummary = (revalidated.data as unknown as { summary: { errors: number } }).summary;
    expect(reSummary.errors).toBe(0);

    const published = await api.post('/timetables/publish', { versionId: result.versionId, notes: 'Term 1 published by the principal.' }, state.adminToken);
    expect([200, 201]).toContain(published.status);

    const afterPublish = await api.patch(
      '/timetables/entries/move',
      { versionId: result.versionId, entryId: entry.id, targetPeriodId: freeSlot!.id, targetDayOfWeek: freeSlot!.dayOfWeek, targetSequence: freeSlot!.sequence },
      state.adminToken,
    );
    expect(afterPublish.status).toBe(400);

    // Teachers and guardians can never publish — only administrators.
    const teacherPublish = await api.post('/timetables/publish', { versionId: result.versionId }, state.teacherToken);
    expect([401, 403]).toContain(teacherPublish.status);
    const parentPublish = await api.post('/timetables/publish', { versionId: result.versionId }, state.guardianToken);
    expect([401, 403]).toContain(parentPublish.status);

    const conflicts = await api.get(`/timetables/${result.versionId}/conflicts`, state.adminToken);
    expect(listOf(conflicts.data).filter((item) => (item as { severity: string }).severity === 'ERROR')).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ 7 --- */

  it('journey 7 — the teacher sees the timetable, creates an assessment, attaches evidence, enters and publishes results', async () => {
    const myTimetable = await api.get('/timetables/me', state.teacherToken);
    expect(myTimetable.status).toBe(200);
    const timetable = myTimetable.data as unknown as { published: boolean; lessons: Array<{ learningAreaName: string; className: string }> };
    expect(timetable.published).toBe(true);
    expect(timetable.lessons.length).toBeGreaterThan(0);
    expect(timetable.lessons.every((lesson) => lesson.className === 'Grade 7 Tumaini')).toBe(true);

    const created = await api.post(
      '/assessments',
      {
        title: 'Numbers and algebra CAT 1',
        academicYearId: state.academicYearId,
        termId: state.termId,
        classId: state.classId,
        learningAreaId: state.learningAreaId,
        categoryId: await (async () => {
          const existing = await prisma.assessmentCategory.findFirst({ where: { schoolId: state.schoolId } });
          if (existing) return existing.id;
          const made = await prisma.assessmentCategory.create({
            data: { schoolId: state.schoolId, code: 'CAT', name: 'Continuous Assessment Test', allowsMarks: true, allowsRubric: true },
          });
          return made.id;
        })(),
        assessmentDate: '2026-02-12',
        totalMarks: 30,
        usesMarks: true,
        usesRubric: false,
      },
      state.teacherToken,
    );
    expect(created.status).toBe(201);
    state.assessmentId = (created.data as unknown as { id: string }).id;

    // Attach a PDF and an image to the assessment (private storage, signature checked).
    const pdf = await api.upload('/files/upload?purpose=ASSESSMENT', state.teacherToken, {
      name: 'cat-1-question-paper.pdf',
      type: 'application/pdf',
      content: pdfFixture('Numbers and algebra CAT 1'),
    });
    expect(pdf.status).toBe(201);
    const png = await api.upload('/files/upload?purpose=ASSESSMENT', state.teacherToken, {
      name: 'mark-scheme.png',
      type: 'image/png',
      content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'),
    });
    expect(png.status).toBe(201);
    for (const file of [pdf, png]) {
      const attached = await api.post(
        `/assessments/${state.assessmentId}/resources`,
        { fileId: (file.data as unknown as { id: string }).id, title: (file.data as unknown as { fileName: string }).fileName, kind: 'ATTACHMENT' },
        state.teacherToken,
      );
      expect([200, 201]).toContain(attached.status);
    }

    // A file that only *claims* to be a PDF is refused (content sniffing, not extension).
    const fake = await api.upload('/files/upload?purpose=ASSESSMENT', state.teacherToken, {
      name: 'sneaky.pdf',
      type: 'application/pdf',
      content: Buffer.from('MZ\x90\x00\x03executable', 'latin1'),
    });
    expect(fake.status).toBe(400);

    // Results: one mark above the maximum must be rejected, the valid set accepted.
    const tooHigh = await api.post(
      `/results/grid/${state.assessmentId}`,
      { results: [{ learnerId: state.learnerId, numericScore: 99 }], saveAsDraft: true },
      state.teacherToken,
    );
    expect(tooHigh.status).toBe(400);

    const saved = await api.post(
      `/results/grid/${state.assessmentId}`,
      {
        results: [
          { learnerId: state.learnerId, numericScore: 24, comment: 'Strong on fractions.' },
          { learnerId: state.otherLearnerId, numericScore: 18 },
        ],
        saveAsDraft: true,
      },
      state.teacherToken,
    );
    expect([200, 201]).toContain(saved.status);

    const grid = await api.get(`/results/grid/${state.assessmentId}`, state.teacherToken);
    const gridData = grid.data as unknown as { summary: { entered: number; expected: number; missing: number } };
    expect(gridData.summary.entered).toBe(2);
    expect(gridData.summary.missing).toBe(0);

    const published = await api.post(`/assessments/${state.assessmentId}/publish`, { notifyParents: true }, state.teacherToken);
    expect([200, 201]).toContain(published.status);

    // Corrections after publication are allowed *with a reason*, and are audited.
    const resultId = (await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId: state.assessmentId, learnerId: state.learnerId } })).id;
    const noReason = await api.patch(`/results/${resultId}/amend`, { numericScore: 25, notifyParents: false }, state.teacherToken);
    expect(noReason.status).toBe(400);
    const amended = await api.patch(
      `/results/${resultId}/amend`,
      { numericScore: 25, reason: 'Re-marked question 4 after moderation.', notifyParents: true },
      state.teacherToken,
    );
    expect(amended.status).toBe(200);
    state.resultId = resultId;
  });

  /* ------------------------------------------------------------------ 8 --- */

  it('journey 8 — the guardian sees the published result, the class timetable and their child’s progress', async () => {
    const token = state.guardianToken;
    expect(token).toBeTruthy();

    const dashboard = await api.get('/dashboard/parent', token);
    expect(dashboard.status).toBe(200);
    const summary = dashboard.data as unknown as { learners: Array<{ id: string; fullName: string }>; latestResults: Array<{ assessmentTitle: string }> };
    expect(summary.learners.map((learner) => learner.id)).toContain(state.learnerId);
    expect(summary.latestResults.some((result) => result.assessmentTitle.includes('Numbers and algebra'))).toBe(true);

    const results = await api.get(`/results/learner/${state.learnerId}`, token);
    const body = results.data as unknown as { results: Array<{ assessmentTitle: string; numericScore: number; wasCorrected: boolean; status: string }> };
    const cat = body.results.find((result) => result.assessmentTitle.includes('Numbers and algebra'));
    expect(cat).toBeTruthy();
    // A result that was corrected after publication carries the AMENDED mark: it is
    // still visible to the guardian, and it is flagged as having changed.
    expect(['PUBLISHED', 'AMENDED']).toContain(cat!.status);
    expect(cat!.numericScore).toBe(25); // the corrected mark is the one the guardian sees
    expect(cat!.wasCorrected).toBe(true);

    const progress = await api.get(`/results/learner/${state.learnerId}/progress`, token);
    expect(progress.status).toBe(200);
    expect(Array.isArray(progress.data)).toBe(true);

    const timetable = await api.get(`/timetables/learner/${state.learnerId}`, token);
    const classTimetable = timetable.data as unknown as { published: boolean; className: string; lessons: unknown[]; periods: unknown[] };
    expect(classTimetable.published).toBe(true);
    expect(classTimetable.className).toBe('Grade 7 Tumaini');
    expect(classTimetable.lessons.length).toBeGreaterThan(0);
    expect(classTimetable.periods.length).toBeGreaterThan(0);

    // The guardian was told, in-app, that results were published, and can act on it.
    const notifications = await api.get('/notifications?pageSize=50', token);
    const items = listOf<{ type: string; readAt: string | null }>(notifications.data);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.type === 'ASSESSMENT_PUBLISHED')).toBe(true);
    expect(items.every((item) => item.readAt === null || typeof item.readAt === 'string')).toBe(true);

    // Only published data: a draft assessment in the same class must not appear.
    const draft = await api.post(
      '/assessments',
      {
        title: 'Draft — not for guardians',
        academicYearId: state.academicYearId,
        termId: state.termId,
        classId: state.classId,
        learningAreaId: state.learningAreaId,
        categoryId: (await prisma.assessmentCategory.findFirstOrThrow({ where: { schoolId: state.schoolId } })).id,
        assessmentDate: '2026-03-01',
        totalMarks: 20,
        usesMarks: true,
        usesRubric: false,
      },
      state.teacherToken,
    );
    expect(draft.status).toBe(201);
    await api.post(
      `/results/grid/${(draft.data as unknown as { id: string }).id}`,
      { results: [{ learnerId: state.learnerId, numericScore: 15 }], saveAsDraft: true },
      state.teacherToken,
    );
    const afterDraft = await api.get(`/results/learner/${state.learnerId}`, token);
    const titles = (afterDraft.data as unknown as { results: Array<{ assessmentTitle: string }> }).results.map((result) => result.assessmentTitle);
    expect(titles).not.toContain('Draft — not for guardians');
  });

  /* ------------------------------------------------------------------ 9 --- */

  it('journey 9 — an unrelated guardian is denied the child’s results, timetable and file downloads', async () => {
    // A second school with its own guardian: nothing of this school may be visible.
    const otherSchool = await prisma.school.create({ data: { name: 'Elsewhere School', code: 'ELSE-001', workingDays: [1, 2, 3, 4, 5] } });
    const outsider = await prisma.user.create({
      data: {
        email: 'outsider@elsewhere.test',
        fullName: 'Outsider',
        passwordHash: await app.get(require('../../src/modules/auth/password.service').PasswordService).hash(password),
        memberships: { create: { schoolId: otherSchool.id, role: 'PARENT', status: 'ACTIVE' } },
      },
    });
    await prisma.parentProfile.create({ data: { userId: outsider.id, schoolId: otherSchool.id, relationship: 'Guardian' } });
    const outsiderLogin = await api.post('/auth/login', { email: 'outsider@elsewhere.test', password, clientType: 'MOBILE' });
    const outsiderToken = (outsiderLogin.data as unknown as { accessToken: string }).accessToken;

    const outsiderParentProfile = await prisma.parentProfile.findFirstOrThrow({ where: { userId: outsider.id } });
    // The outsider is linked to their own school's learner only.
    const ownLearner = await prisma.learner.create({
      data: {
        schoolId: otherSchool.id, admissionNumber: 'ELSE-1', assessmentNumber: '900001',
        firstName: 'Own', lastName: 'Child', gender: 'FEMALE', status: 'ACTIVE',
      },
    });
    await prisma.parentLearnerLink.create({
      data: {
        schoolId: otherSchool.id, parentProfileId: outsiderParentProfile.id, learnerId: ownLearner.id,
        relationship: 'Mother', isVerified: true, verificationMethod: 'ADMIN_RECORD', verifiedAt: new Date(),
      },
    });

    for (const path of [
      `/results/learner/${state.learnerId}`,
      `/timetables/learner/${state.learnerId}`,
      `/dashboard/parent?learnerId=${state.learnerId}`,
    ]) {
      const response = await api.get(path, outsiderToken);
      expect([403, 404]).toContain(response.status);
    }

    // The same guardian account, in its own school, is also refused a learner it is not
    // linked to — guard against "linked to someone" being mistaken for "linked to this one".
    const unlinked = await prisma.learner.create({
      data: {
        schoolId: state.schoolId, admissionNumber: 'ADM-999', assessmentNumber: '799999',
        firstName: 'Unlinked', lastName: 'Child', gender: 'MALE', gradeId: state.gradeId, status: 'ACTIVE',
      },
    });
    const denied = await api.get(`/results/learner/${unlinked.id}`, state.guardianToken);
    expect([403, 404]).toContain(denied.status);

    // Uploaded evidence is not downloadable by a guardian from another school either.
    const file = await prisma.fileObject.findFirst({ where: { schoolId: state.schoolId } });
    if (!file) throw new Error('Journey 7 should have uploaded assessment evidence before this journey runs.');
    const download = await api.get(`/files/${file.id}/download`, outsiderToken);
    expect([403, 404]).toContain(download.status);
  });

  /* ----------------------------------------------------------------- 10 --- */

  it('journey 10 — the whole chain is auditable and no secrets were ever written out', async () => {
    const actions = await prisma.auditLog.findMany({ where: { schoolId: state.schoolId }, select: { action: true } });
    const seen = new Set(actions.map((entry) => entry.action));
    for (const expected of ['auth.login', 'result.amended', 'assessment.published']) {
      expect([...seen].some((action) => action.startsWith(expected) || action === expected)).toBe(true);
    }

    // Exports and result changes leave a trail the administrator can review.
    const audit = await api.get('/audit-logs?pageSize=100', state.adminToken);
    expect(audit.status).toBe(200);

    // The audit trail must not contain password material.
    const logs = await prisma.auditLog.findMany({ where: { schoolId: state.schoolId } });
    const serialised = JSON.stringify(logs);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('$argon2');
    expect(serialised).not.toContain('refreshToken');
    expect(serialised).not.toContain('Nakuru-Teacher-2026!ok');
  });
});
