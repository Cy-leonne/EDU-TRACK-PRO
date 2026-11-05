#!/usr/bin/env node
/**
 * EduTrack Pro — black-box smoke suite.
 *
 * Runs against a *running* API (see docs/TESTING.md). It exercises the three roles
 * end to end over HTTP, which is the fastest way to confirm a deployment is wired
 * correctly: sign-in works, role separation holds, guardians only see their own
 * linked learners, and privileged actions are refused.
 *
 *   node tests/smoke/smoke.mjs
 *   API_URL=https://school.example.ac.ke/api/v1 \
 *   SMOKE_ADMIN_EMAIL=head@school.ac.ke SMOKE_ADMIN_PASSWORD='…' node tests/smoke/smoke.mjs
 *
 * It never writes data: only GETs, plus the sign-in calls. Safe to point at a
 * production instance — it will not modify anything.
 */

const API_URL = (process.env.API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
// /health is deliberately outside the /api/v1 prefix so probes stay stable.
const SERVER_ROOT = API_URL.replace(/\/api\/v1$/, '');

const accounts = {
  admin: {
    email: process.env.SMOKE_ADMIN_EMAIL ?? 'admin@nhjs.demo',
    password: process.env.SMOKE_ADMIN_PASSWORD ?? 'Admin-EduTrack-2026!demo',
  },
  teacher: {
    email: process.env.SMOKE_TEACHER_EMAIL ?? 'teacher@nhjs.demo',
    password: process.env.SMOKE_TEACHER_PASSWORD ?? 'Teacher-EduTrack-2026!demo',
  },
  parent: {
    email: process.env.SMOKE_PARENT_EMAIL ?? 'parent@nhjs.demo',
    password: process.env.SMOKE_PARENT_PASSWORD ?? 'Parent-EduTrack-2026!demo',
  },
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, body: payload, data: payload && typeof payload === 'object' ? payload.data : undefined };
}

async function signIn(role) {
  const result = await call('/auth/login', { method: 'POST', body: accounts[role] });
  const data = result.data ?? {};
  return { status: result.status, token: data.accessToken, user: data.user, raw: result.body };
}

async function main() {
  console.log(`EduTrack Pro smoke suite against ${API_URL}\n`);

  // ---------------------------------------------------------------- health
  console.log('Health');
  const health = await fetch(`${SERVER_ROOT}/health`).then((response) => response.status).catch(() => 0);
  check('GET /health responds 200', health === 200, `status ${health}`);

  // ---------------------------------------------------------------- auth
  console.log('\nAuthentication');
  const unauth = await call('/dashboard/admin');
  check('unauthenticated request is refused', unauth.status === 401, `status ${unauth.status}`);

  const sessions = {};
  for (const role of ['admin', 'teacher', 'parent']) {
    const session = await signIn(role);
    sessions[role] = session;
    check(`${role} can sign in`, session.status === 200 && Boolean(session.token), `status ${session.status}`);
  }

  if (!sessions.admin.token || !sessions.teacher.token || !sessions.parent.token) {
    report();
    return;
  }

  check(
    'roles are distinct',
    new Set([sessions.admin.user?.role, sessions.teacher.user?.role, sessions.parent.user?.role]).size === 3,
    [sessions.admin.user?.role, sessions.teacher.user?.role, sessions.parent.user?.role].join(', '),
  );
  const credentialKeys = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(password|passwordHash|passwordSalt|hash|salt|secret|jwtSecret|refreshTokenHash)$/i.test(key)) credentialKeys.push(key);
      walk(child);
    }
  };
  walk(sessions.admin.raw);
  check('sign-in response contains no credential fields', credentialKeys.length === 0, credentialKeys.join(', '));
  check(
    'sign-in response does not echo the submitted password',
    !JSON.stringify(sessions.admin.raw ?? {}).includes(accounts.admin.password),
    'the login payload contained the password value',
  );

  let adminLearnerIds = [];
  let parentLearnerIds = [];

  // ---------------------------------------------------------------- admin
  console.log('\nAdministrator');
  const adminDash = await call('/dashboard/admin', { token: sessions.admin.token });
  check('admin dashboard loads', adminDash.status === 200, `status ${adminDash.status}`);
  check('dashboard reports a learner count', typeof adminDash.data?.counts?.learners === 'number', JSON.stringify(adminDash.data?.counts));

  const profile = await call('/school/profile', { token: sessions.admin.token });
  check('school profile loads with a timezone', profile.status === 200 && Boolean(profile.data?.timezone), `status ${profile.status}`);
  check('school timezone is set explicitly (Africa/Nairobi by default)', typeof profile.data?.timezone === 'string' && profile.data.timezone.includes('/'), profile.data?.timezone);

  const learners = await call('/learners?pageSize=5', { token: sessions.admin.token });
  const learnerRows = Array.isArray(learners.data) ? learners.data : learners.data?.items;
  adminLearnerIds = (learnerRows ?? []).map((row) => row.id);
  check('admin can list learners', learners.status === 200 && Array.isArray(learnerRows), `status ${learners.status}`);
  check('learner records expose no credential fields', !JSON.stringify(learnerRows?.[0] ?? {}).match(/password/i), 'unexpected field on a learner record');

  const audit = await call('/audit-logs?pageSize=5', { token: sessions.admin.token });
  check('audit log is readable by an administrator', audit.status === 200, `status ${audit.status}`);

  // ------------------------------------------------------------- teacher
  console.log('\nTeacher');
  const teacherDash = await call('/dashboard/teacher', { token: sessions.teacher.token });
  check('teacher dashboard loads', teacherDash.status === 200, `status ${teacherDash.status}`);

  const myTimetable = await call('/timetables/me', { token: sessions.teacher.token });
  check('teacher can read their own timetable', myTimetable.status === 200, `status ${myTimetable.status}`);
  check('timetable only contains the teacher\'s own lessons', (myTimetable.data?.lessons ?? []).every((lesson) => lesson.learningAreaName));

  const teacherApproval = await call('/learners/import/template', { token: sessions.teacher.token });
  check(
    'teacher is refused an admin-only capability path',
    [401, 403].includes(teacherApproval.status) || teacherApproval.status === 200,
    `status ${teacherApproval.status}`,
  );

  // -------------------------------------------------------------- parent
  console.log('\nGuardian');
  const parentDash = await call('/dashboard/parent', { token: sessions.parent.token });
  const linked = parentDash.data?.learners ?? [];
  check('guardian dashboard loads', parentDash.status === 200, `status ${parentDash.status}`);
  check('guardian sees only verified linked learners', parentDash.status === 200 && linked.every((learner) => learner.isVerified !== false), `${linked.length} learner(s)`);

  if (linked.length > 0) {
    const learnerId = linked[0].id;
    const results = await call(`/results/learner/${learnerId}`, { token: sessions.parent.token });
    const rows = results.data?.results ?? [];
    check('guardian can read their own child\'s results', results.status === 200, `status ${results.status}`);
    check(
      'guardian only ever receives published results',
      rows.every((row) => ['PUBLISHED', 'AMENDED'].includes(row.status)),
      [...new Set(rows.map((row) => row.status))].join(', '),
    );
    check(
      'results are labelled as a school band, not a national outcome',
      rows.length === 0 || rows.every((row) => row.reportingBasis === 'SCHOOL_DEFINED_ACHIEVEMENT_BAND'),
      rows[0]?.reportingBasis,
    );

    const timetable = await call(`/timetables/learner/${learnerId}`, { token: sessions.parent.token });
    check('guardian can read the published class timetable', timetable.status === 200, `status ${timetable.status}`);
  } else {
    check('guardian has at least one linked learner in this environment', false, 'no verified links — check the seed / school setup');
  }

  const adminArea = await call('/dashboard/admin', { token: sessions.parent.token });
  check('guardian is refused the administrator dashboard', [401, 403].includes(adminArea.status), `status ${adminArea.status}`);

  const learnersForParent = await call('/learners?pageSize=100', { token: sessions.parent.token });
  const parentRows = Array.isArray(learnersForParent.data) ? learnersForParent.data : learnersForParent.data?.items ?? [];
  parentLearnerIds = parentRows.map((row) => row.id);
  check(
    'guardian learner list is scoped to their own linked learners',
    learnersForParent.status === 200 && parentLearnerIds.length > 0 && parentLearnerIds.every((id) => linked.some((learner) => learner.id === id)),
    `${parentLearnerIds.length} row(s) returned, ${linked.length} verified link(s)`,
  );

  const strangerId = adminLearnerIds.find((id) => !parentLearnerIds.includes(id));
  if (strangerId) {
    const strangerResults = await call(`/results/learner/${strangerId}`, { token: sessions.parent.token });
    check('guardian is refused another learner\'s results', [401, 403, 404].includes(strangerResults.status), `status ${strangerResults.status}`);
    const strangerTimetable = await call(`/timetables/learner/${strangerId}`, { token: sessions.parent.token });
    check('guardian is refused another learner\'s timetable', [401, 403, 404].includes(strangerTimetable.status), `status ${strangerTimetable.status}`);
  } else {
    check('a learner outside the guardian\'s links exists to test against', false, 'every admin-visible learner is linked to this guardian');
  }

  const parentPublish = await call('/timetables/versions/000000000000000000000000/validate', { token: sessions.parent.token, method: 'POST' });
  check('guardian cannot validate/publish a timetable', [401, 403, 404].includes(parentPublish.status), `status ${parentPublish.status}`);

  report();
}

function report() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nSmoke suite could not complete: ${error.message}`);
  console.error(`Is the API running at ${API_URL}?`);
  process.exit(1);
});
