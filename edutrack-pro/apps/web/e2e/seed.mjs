/**
 * End-to-end test fixtures.
 *
 * Runs against a **dedicated test database** (see playwright.config.ts) and
 * creates one tenant with a realistic teaching chain by calling the real API —
 * the same endpoints the UI uses — so the browser tests always work with data
 * that the application itself produced.
 *
 * The credentials below are test fixtures for the isolated E2E database. They
 * are NOT the development seed accounts and never exist in a deployed school.
 *
 * Usage: node e2e/seed.mjs <apiBaseUrl> <outputJsonPath>
 */
import { writeFileSync } from 'node:fs';

const API = process.argv[2] ?? 'http://127.0.0.1:4101';
const OUT = process.argv[3] ?? new URL('./.seed.json', import.meta.url).pathname;

const RUN = Date.now().toString(36);
export const CREDENTIALS = {
  admin: { email: `head.${RUN}@e2e.test`, password: 'E2E-Admin-Pass!2026' },
  teacher: { email: `teacher.${RUN}@e2e.test`, password: 'E2E-Teacher-Pass!2026' },
  parent: { email: `guardian.${RUN}@e2e.test`, password: 'E2E-Guardian-Pass!2026' },
  stranger: { email: `stranger.${RUN}@e2e.test`, password: 'E2E-Stranger-Pass!2026' },
};

let failures = 0;

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    failures += 1;
    console.error(`  ✗ ${method} ${path} -> ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
    return { ok: false, status: response.status, payload };
  }
  return { ok: true, status: response.status, data: payload?.data ?? payload };
}

const log = (message) => console.log(`  • ${message}`);

async function main() {
  console.log(`E2E fixtures -> ${API}`);

  /* ------------------------------- the school ------------------------------ */
  const school = await call('POST', '/auth/register/school', {
    body: {
      school: { name: 'E2E Verification Junior School', code: `E2E-${RUN}`, county: 'Nakuru', timezone: 'Africa/Nairobi' },
      admin: { fullName: 'Ada Admin', email: CREDENTIALS.admin.email, password: CREDENTIALS.admin.password, confirmPassword: CREDENTIALS.admin.password },
      acceptTerms: true,
    },
  });
  if (!school.ok) throw new Error('could not register the fixture school');
  const admin = school.data.accessToken;
  const schoolId = school.data.school.id;
  log(`school ${schoolId}`);

  /* ------------------------------- the calendar ---------------------------- */
  const year = new Date().getFullYear();
  let years = await call('GET', '/school/academic-years', { token: admin });
  let academicYearId = years.data?.find((row) => row.isCurrent)?.id;
  if (!academicYearId) {
    const created = await call('POST', '/school/academic-years', {
      token: admin,
      body: { name: `${year}`, startDate: `${year}-01-05`, endDate: `${year}-11-28`, isCurrent: true },
    });
    academicYearId = created.data?.id;
  }
  let terms = await call('GET', '/school/terms', { token: admin });
  let termId = terms.data?.find((row) => row.isCurrent)?.id ?? terms.data?.[0]?.id;
  if (!termId) {
    const created = await call('POST', '/school/terms', {
      token: admin,
      body: { academicYearId, number: 1, name: 'Term 1', startDate: `${year}-01-05`, endDate: `${year}-04-10`, isCurrent: true },
    });
    termId = created.data?.id;
  }
  log(`calendar ${academicYearId} / ${termId}`);

  const grades = await call('GET', '/school/grades', { token: admin });
  const gradeId = grades.data?.[0]?.id;

  /* -------------------------- learning area + teacher ---------------------- */
  const area = await call('POST', '/learning-areas', {
    token: admin,
    body: { code: 'E2E-MAT', name: 'Mathematics', shortName: 'Maths', colorHex: '#2457C5', isCore: true, isExamined: true, defaultPeriodsPerWeek: 5 },
  });
  const learningAreaId = area.data?.id ?? area.data?.learningArea?.id;
  log(`learning area ${learningAreaId}`);

  // Teachers join through an invitation (never public self-registration): the
  // office issues the link, the teacher accepts it and chooses their password.
  const teacherInvite = await call('POST', '/auth/invitations', {
    token: admin,
    body: { email: CREDENTIALS.teacher.email, fullName: 'Tito Teacher', role: 'TEACHER', phone: '+254700000101', staffNumber: `E2E-STF-${RUN}`, employmentType: 'TSC_EMPLOYED', expiresInDays: 7 },
  });
  const teacherTokenFromInvite = new URL(teacherInvite.data.invitationUrl).searchParams.get('token');
  const teacherAccepted = await call('POST', '/auth/invitations/accept', {
    body: { token: teacherTokenFromInvite, fullName: 'Tito Teacher', phone: '+254700000101', password: CREDENTIALS.teacher.password, confirmPassword: CREDENTIALS.teacher.password },
  });
  if (!teacherAccepted.ok) throw new Error('the fixture teacher could not activate their invitation');
  const teacherList = await call('GET', '/teachers', { token: admin });
  const teacherRow = (teacherList.data ?? []).find((row) => row.email === CREDENTIALS.teacher.email);
  const teacherId = teacherRow?.id;
  log(`teacher ${teacherId} (via invitation)`);

  const klass = await call('POST', '/classes', {
    token: admin,
    body: { name: 'Grade 7 Tumaini', stream: 'Tumaini', gradeId, academicYearId, classTeacherId: teacherId, capacity: 45, isActive: true },
  });
  const classId = klass.data?.id ?? klass.data?.class?.id;
  log(`class ${classId}`);

  await call('POST', '/teacher-assignments', {
    token: admin,
    body: { teacherId, classId, learningAreaId, isPrimary: true, lessonsPerWeek: 5 },
  });

  // Weekly period requirements: generation is refused without them.
  await call('POST', '/learning-areas/requirements/bulk', {
    token: admin,
    body: {
      classIds: [classId],
      requirements: [{ learningAreaId, periodsPerWeek: 5, preferDoubleLesson: false, preferMorning: true }],
    },
  });

  // The bell schedule (periods, break and lunch) for the teaching week.
  const periods = [];
  let sequence = 1;
  const day = [
    ['08:00', '08:40', false, false],
    ['08:40', '09:20', false, false],
    ['10:00', '10:20', true, false],
    ['10:20', '11:00', false, false],
    ['12:20', '13:00', false, true],
    ['13:00', '13:40', false, false],
  ];
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    for (const [startTime, endTime, isBreak, isLunch] of day) {
      periods.push({
        dayOfWeek: weekday,
        sequence,
        label: isBreak ? 'Break' : isLunch ? 'Lunch' : `Period ${sequence}`,
        startTime,
        endTime,
        isBreak,
        isLunch,
      });
      sequence += 1;
    }
  }
  const bell = await call('POST', '/timetables/periods', {
    token: admin,
    body: { academicYearId, termId, periods },
  });
  log(`bell schedule: ${bell.ok}`);

  /* --------------------------------- learners ------------------------------ */
  const learnerIds = [];
  const learners = [
    { firstName: 'Amani', lastName: 'Njoroge', admissionNumber: `E2E-${RUN}-1`, assessmentNumber: `900${RUN}1` },
    { firstName: 'Baraka', lastName: 'Otieno', admissionNumber: `E2E-${RUN}-2`, assessmentNumber: `900${RUN}2` },
    { firstName: 'Chausiku', lastName: 'Mwikali', admissionNumber: `E2E-${RUN}-3`, assessmentNumber: `900${RUN}3` },
  ];
  for (const learner of learners) {
    const created = await call('POST', '/learners', {
      token: admin,
      body: { ...learner, currentClassId: classId, enrolledOn: `${year}-01-08`, dateOfBirth: '2013-04-12', gender: 'FEMALE' },
    });
    learnerIds.push(created.data?.id ?? created.data?.learner?.id);
  }
  await call('POST', '/classes/enrollments/bulk', { token: admin, body: { classId, learnerIds } });
  log(`learners ${learnerIds.length}`);

  /* ------------------------------- assessment ------------------------------ */
  const categories = await call('GET', '/assessments/categories', { token: admin });
  const category = categories.data?.[0];
  const assessment = await call('POST', '/assessments', {
    token: admin,
    body: {
      title: `Numbers and algebra CAT (${RUN})`,
      description: 'Fixture assessment created by the E2E seeding script.',
      academicYearId,
      termId,
      classId,
      learningAreaId,
      categoryId: category?.id,
      assessmentDate: `${year}-02-14`,
      totalMarks: 20,
      usesMarks: true,
      usesRubric: false,
      isExternallyReported: false,
    },
  });
  const assessmentId = assessment.data?.id ?? assessment.data?.assessment?.id;
  log(`assessment ${assessmentId}`);

  // Enter and publish results as the teacher (the real workflow, same endpoints
  // the assessment screen uses).
  const teacherLogin = await call('POST', '/auth/login', {
    body: { email: CREDENTIALS.teacher.email, password: CREDENTIALS.teacher.password, clientType: 'WEB' },
  });
  const teacherToken = teacherLogin.data?.accessToken;
  if (!teacherToken) throw new Error('the fixture teacher could not sign in');

  await call('POST', `/results/grid/${assessmentId}`, {
    token: teacherToken,
    body: {
      results: learnerIds.map((learnerId, index) => ({ learnerId, numericScore: 14 + index })),
      saveAsDraft: true,
    },
  });
  const published = await call('POST', `/assessments/${assessmentId}/publish`, {
    token: teacherToken,
    body: { notifyParents: true, publishFeedback: true },
  });
  log(`assessment published: ${published.ok}`);

  /* --------------------------- guardians and links ------------------------- */
  // Guardians register for themselves and are linked to a learner by the school.
  // Two learners are claimed provisionally; the office verifies exactly one of
  // them, so the privacy spec can assert what an *unverified* link may see.
  // (1) guardian registers with the school code, then requests a link using the
  //     learner's assessment number plus surname — the workflow the UI exposes.
  await call('POST', '/auth/register/parent', {
    body: {
      schoolCode: `E2E-${RUN}`,
      fullName: 'Mary Guardian',
      email: CREDENTIALS.parent.email,
      phone: '+254700000202',
      relationship: 'Mother',
      password: CREDENTIALS.parent.password,
      confirmPassword: CREDENTIALS.parent.password,
      acceptTerms: true,
    },
  });
  const parentLogin = await call('POST', '/auth/login', {
    body: { email: CREDENTIALS.parent.email, password: CREDENTIALS.parent.password, clientType: 'WEB' },
  });
  const parentToken = parentLogin.data?.accessToken;
  if (!parentToken) throw new Error('the fixture guardian could not sign in');
  await call('POST', '/auth/parent/link-request', {
    token: parentToken,
    body: { learnerAssessmentNumber: learners[0].assessmentNumber, learnerSurname: learners[0].lastName, relationship: 'Mother' },
  });

  const parents = await call('GET', '/parents', { token: admin });
  const parentRow = (parents.data ?? []).find((row) => row.email === CREDENTIALS.parent.email);
  const parentProfileId = parentRow?.id;

  // (2) the same guardian claims a second child — this link stays unverified,
  //     so the privacy specs can prove that an unverified link exposes nothing.
  await call('POST', '/auth/parent/link-request', {
    token: parentToken,
    body: { learnerAssessmentNumber: learners[1].assessmentNumber, learnerSurname: learners[1].lastName, relationship: 'Mother' },
  });

  // (3) the office verifies exactly one of the two links (learner #1).
  const links = await call('GET', '/parent-links', { token: admin });
  const pendingLink = (links.data ?? []).find((row) => row.parent?.id === parentProfileId && row.learner?.id === learnerIds[0]);
  if (!pendingLink) throw new Error('the guardian link request did not create a pending link');
  await call('POST', `/parent-links/${pendingLink.id}/verify`, { token: admin, body: { method: 'ADMIN_RECORD' } });
  log(`verified link ${pendingLink.id} for ${learnerIds[0]}`);

  // (4) a guardian with no link at all — used for the isolation checks.
  const strangerInvite = await call('POST', '/auth/invitations', {
    token: admin,
    body: { email: CREDENTIALS.stranger.email, fullName: 'Sam Stranger', role: 'PARENT', relationship: 'Guardian', expiresInDays: 7 },
  });
  const strangerTokenFromInvite = new URL(strangerInvite.data.invitationUrl).searchParams.get('token');
  await call('POST', '/auth/invitations/accept', {
    body: { token: strangerTokenFromInvite, fullName: 'Sam Stranger', phone: '+254700000303', password: CREDENTIALS.stranger.password, confirmPassword: CREDENTIALS.stranger.password },
  });
  log(`guardians created (${parentProfileId} + stranger)`);

  /* --------------------------------- output -------------------------------- */
  writeFileSync(
    OUT,
    JSON.stringify(
      { apiBase: API, schoolId, schoolName: school.data.school.name, academicYearId, termId, gradeId, classId, learningAreaId, teacherId, learnerIds, assessmentId, parentProfileId, credentials: CREDENTIALS },
      null,
      2,
    ),
  );
  console.log(`Fixture creation finished with ${failures} failed call(s) — wrote ${OUT}`);
  if (failures > 0) process.exit(1);
}

await main();
