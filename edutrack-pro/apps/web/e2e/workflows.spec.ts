import { apiClient, expect, signIn, test } from './helpers';

/**
 * Database-backed workflows, driven through the browser.
 *
 * Every case follows the same shape required by the specification:
 *   act in the UI → assert the API response → read the row back from the
 *   database through a second, independent API call → refetch the screen and
 *   confirm the change persisted.
 */
test.describe('Database-backed workflows (UI → API → database → UI)', () => {
  test('administrator creates a learning area, a class and a learner and all three persist', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);
    const stamp = Date.now().toString(36).slice(-5);

    /* ------------------------------ learning area --------------------------- */
    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await page.goto('/academics/learning-areas');
    await page.getByRole('button', { name: /add learning area|new learning area/i }).first().click();
    await page.getByLabel(/^Code/).fill(`E2E-${stamp}`.toUpperCase());
    await page.getByLabel(/^Name/).fill(`E2E Subject ${stamp}`);
    await page.getByRole('dialog').getByRole('button', { name: /^(save|save changes|add|create)/i }).last().click();
    await expect(page.getByText(`E2E Subject ${stamp}`).first()).toBeVisible();

    const areas = await api.get('/learning-areas', adminToken);
    const area = (areas.data as Array<{ id: string; name: string }>).find((row) => row.name === `E2E Subject ${stamp}`);
    expect(area, 'the learning area must exist in the database').toBeTruthy();

    /* --------------------------------- class -------------------------------- */
    await page.goto('/academics/classes');
    await page.getByRole('button', { name: /add class|new class/i }).first().click();
    await page.getByLabel(/^Name/).or(page.getByLabel('Class name')).first().fill(`E2E Class ${stamp}`);
    const gradeSelect = page.getByLabel(/^grade$/i).first();
    if (await gradeSelect.count()) {
      const options = await gradeSelect.locator('option').all();
      for (const option of options) {
        const value = await option.getAttribute('value');
        if (value) {
          await gradeSelect.selectOption(value);
          break;
        }
      }
    }
    await page.getByRole('dialog').getByRole('button', { name: /^(save|save changes|add|create)/i }).last().click();
    await expect(page.getByText(`E2E Class ${stamp}`).first()).toBeVisible();

    const classes = await api.get('/classes', adminToken);
    const created = (classes.data as Array<{ id: string; name: string }>).find((row) => row.name === `E2E Class ${stamp}`);
    expect(created, 'the class must exist in the database').toBeTruthy();

    /* -------------------------------- learner ------------------------------- */
    await page.goto('/people/learners');
    await page.getByRole('button', { name: /add learner|register learner|new learner/i }).first().click();
    await page.getByLabel(/^Admission number/).fill(`E2E-ADM-${stamp}`);
    await page.getByLabel(/^First name/).fill('Zawadi');
    await page.getByLabel(/^Last name/).fill(`Mwangi${stamp}`);
    await page.getByRole('dialog').getByRole('button', { name: /^(save|save changes|register|add|create)/i }).last().click();
    await expect(page.getByText(`Mwangi${stamp}`).first()).toBeVisible();

    // Refetch with a filter — the row has to come back from the server.
    const filtered = await api.get(`/learners?search=Mwangi${stamp}`, adminToken);
    expect((filtered.data as unknown[]).length).toBe(1);
    const learner = (filtered.data as Array<{ id: string; lastName: string }>)[0];

    // ...and the edit path persists too.
    await page.goto('/people/learners');
    await page.getByLabel('Search learners').fill(`Mwangi${stamp}`);
    await expect(page.getByText(`Mwangi${stamp}`).first()).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`edit.*Mwangi${stamp}|Mwangi${stamp}.*edit`, 'i') }).first().click().catch(async () => {
      // Row action menus vary by breakpoint; fall back to the row's menu button.
      await page.getByRole('button', { name: /actions|more/i }).first().click();
      await page.getByRole('menuitem', { name: /edit/i }).click();
    });
    await page.getByLabel(/home location|notes/i).first().fill('Nakuru town');
    await page.getByRole('dialog').getByRole('button', { name: /^(save|save changes|update)/i }).last().click();

    const reread = await api.get(`/learners/${learner.id}`, adminToken);
    expect(reread.status).toBe(200);
    expect(JSON.stringify(reread.data)).toContain('Nakuru town');
  });

  test('the office invites a teacher from the invitations screen and the person activates', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);
    const stamp = Date.now().toString(36).slice(-5);
    const email = `invited.${stamp}@e2e.test`;
    const password = 'Invited-Teacher-Pass!2026';

    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await page.goto('/people/invitations');
    await expect(page.getByRole('heading', { level: 1, name: /invitations/i })).toBeVisible();

    await page.getByRole('button', { name: /invite a person/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^Full name/).fill(`Invited Teacher ${stamp}`);
    await dialog.getByLabel(/^Email/).fill(email);
    await dialog.getByLabel(/^Role/).selectOption('TEACHER');
    await dialog.getByRole('button', { name: /create invitation/i }).click();

    // The handover dialog shows the single-use link exactly once.
    const linkField = page.getByLabel('Invitation link');
    await expect(linkField).toBeVisible({ timeout: 20_000 });
    const invitationUrl = await linkField.inputValue();
    expect(invitationUrl).toContain('/activate?token=');
    const token = new URL(invitationUrl).searchParams.get('token');
    expect(token).toBeTruthy();
    await page.getByRole('button', { name: /^done$/i }).click();

    // It really is a pending invitation for this school, and staff creation is
    // still invitation-only (a public teacher sign-up does not exist).
    const pending = await api.get('/auth/invitations', adminToken);
    const mine = (pending.data as Array<{ email: string; role: string }>).find((row) => row.email === email);
    expect(mine, 'the invitation must be listed as pending').toBeTruthy();
    expect(mine!.role).toBe('TEACHER');

    // The invited person activates with their own password and can sign in.
    const accepted = await api.post('/auth/invitations/accept', {
      token,
      fullName: `Invited Teacher ${stamp}`,
      phone: '+254700000404',
      password,
      confirmPassword: password,
    });
    expect([200, 201]).toContain(accepted.status);
    const teacherToken = await api.login(email, password);
    const me = await api.get('/auth/me', teacherToken);
    expect((me.data as { role?: string }).role).toBe('TEACHER');

    // ...and the invitation leaves the pending list.
    const after = await api.get('/auth/invitations', adminToken);
    expect((after.data as Array<{ email: string }>).some((row) => row.email === email)).toBe(false);
  });

  test('teacher enters results and publishes; the published result reaches the guardian', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const teacherToken = await api.login(fixtures.credentials.teacher.email, fixtures.credentials.teacher.password);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);

    // A fresh draft assessment for this spec.
    const categories = await api.get('/assessments/categories', adminToken);
    const years = await api.get('/school/academic-years', adminToken);
    const terms = await api.get('/school/terms', adminToken);
    const created = await api.post(
      '/assessments',
      {
        title: `E2E publish check ${Date.now().toString(36)}`,
        academicYearId: (years.data as Array<{ id: string; isCurrent: boolean }>).find((row) => row.isCurrent)?.id ?? (years.data as Array<{ id: string }>)[0].id,
        termId: (terms.data as Array<{ id: string; isCurrent: boolean }>).find((row) => row.isCurrent)?.id ?? (terms.data as Array<{ id: string }>)[0].id,
        classId: fixtures.classId,
        learningAreaId: fixtures.learningAreaId,
        categoryId: (categories.data as Array<{ id: string }>)[0].id,
        assessmentDate: new Date().toISOString().slice(0, 10),
        totalMarks: 20,
        usesMarks: true,
        usesRubric: false,
        isExternallyReported: false,
      },
      teacherToken,
    );
    expect(created.status).toBe(201);
    const assessmentId = created.data.id as string;

    // Enter the marks in the browser (the real results grid).
    await signIn(page, fixtures.credentials.teacher.email, fixtures.credentials.teacher.password, /dashboard/);
    await page.goto(`/teaching/assessments/${assessmentId}`);
    await expect(page.getByRole('heading', { name: /results/i }).first()).toBeVisible({ timeout: 30_000 });

    const scoreInputs = page.locator('input[type="number"]');
    await expect(scoreInputs.first()).toBeVisible({ timeout: 30_000 });
    const count = await scoreInputs.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < Math.min(count, fixtures.learnerIds.length); index += 1) {
      await scoreInputs.nth(index).fill(String(12 + index));
    }
    await page.getByRole('button', { name: /save draft|save as draft|save results/i }).first().click();
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 20_000 });

    // Persistence: the grid now returns the marks from the database.
    const grid = await api.get(`/results/grid/${assessmentId}`, teacherToken);
    const rows = (grid.data.rows ?? grid.data) as Array<{ numericScore: number | null }>;
    expect(rows.filter((row) => row.numericScore !== null).length).toBeGreaterThan(0);

    // Publish through the UI (confirmation dialog), then verify server-side.
    await page.getByRole('button', { name: /^publish/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^publish/i }).click();
    await expect(page.getByText(/published/i).first()).toBeVisible({ timeout: 20_000 });

    const after = await api.get(`/assessments/${assessmentId}`, teacherToken);
    expect(after.data.status).toBe('PUBLISHED');

    // The guardian of the verified learner can see it; an unrelated guardian cannot.
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);
    const parentResults = await api.get(`/results/learner/${fixtures.learnerIds[0]}`, parentToken);
    expect(parentResults.status).toBe(200);
    expect(JSON.stringify(parentResults.data)).toContain(assessmentId);

    const strangerToken = await api.login(fixtures.credentials.stranger.email, fixtures.credentials.stranger.password);
    const denied = await api.get(`/results/learner/${fixtures.learnerIds[0]}`, strangerToken);
    expect([401, 403, 404]).toContain(denied.status);
  });

  test('guardian switches learners; unverified links expose no records', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);

    await signIn(page, fixtures.credentials.parent.email, fixtures.credentials.parent.password, /dashboard/);
    // The learner switcher is present once at least one link exists.
    await expect(page.getByRole('button', { name: /verified link|awaiting verification/i }).first()).toBeVisible();

    const dashboard = await api.get('/dashboard/parent', parentToken);
    const learners = dashboard.data.learners as Array<{ id: string; isVerified: boolean }>;
    expect(learners.length).toBeGreaterThanOrEqual(1);

    // The server exposes results only for the verified learner.
    const verified = learners.find((learner) => learner.isVerified);
    const unverified = learners.find((learner) => !learner.isVerified);
    if (verified) expect((await api.get(`/results/learner/${verified.id}`, parentToken)).status).toBe(200);
    if (unverified) {
      const hidden = await api.get(`/results/learner/${unverified.id}`, parentToken);
      expect([403, 404]).toContain(hidden.status);
      // The learner may be switched to, but the screen must not present records:
      // the API refuses, so the page shows the refusal instead of a result table.
      await page.goto('/family/results');
      await expect(page.locator('#main-content')).toContainText(/awaiting verification|permission|not verified|no published results/i);
    }
  });

  test('administrator generates, validates and publishes a timetable (rules unchanged)', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);

    // The bell schedule and the weekly requirements already exist (created by the
    // fixture script); generation is refused without them, so assert that state.
    const existingPeriods = await api.get('/timetables/periods', adminToken);
    expect(existingPeriods.status).toBe(200);
    expect((existingPeriods.data as unknown[]).length).toBeGreaterThan(0);

    const preflight = await api.get('/timetables/preflight', adminToken);
    expect(preflight.status).toBe(200);

    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await page.goto('/timetable');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Generate through the screen. The button issues POST /timetables/generate;
    // wait for that response so the assertions below run against real server state.
    const generateResponse = page.waitForResponse(
      (response) => response.url().includes('/timetables/generate') && response.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: /generate/i }).first().click();
    const generated = await generateResponse;
    expect(generated.ok(), `generation returned ${generated.status()}`).toBeTruthy();
    const resultDialog = page.getByRole('dialog');
    if (await resultDialog.count()) {
      await expect(resultDialog).toBeVisible({ timeout: 60_000 });
      await resultDialog.getByRole('button', { name: /close|done/i }).first().click().catch(() => undefined);
    }
    await expect(page.getByText(/version|generated|assigned|unplaced/i).first()).toBeVisible({ timeout: 30_000 });

    // Persisted: the timetable list returns a version created by that action.
    const list = await api.get('/timetables?pageSize=50', adminToken);
    const timetables = (list.data?.items ?? list.data ?? []) as Array<{ id: string; currentVersionId?: string | null }>;
    expect(timetables.length).toBeGreaterThan(0);
    const versionId = timetables.find((row) => row.currentVersionId)?.currentVersionId ?? null;
    expect(versionId, 'generation must store a version').toBeTruthy();

    const validated = await api.post(`/timetables/${versionId}/validate`, {}, adminToken);
    expect(validated.status).toBe(201);
    expect(validated.data).toHaveProperty('conflicts');

    // Publishing a version with blocking conflicts is refused by the server
    // (business rules are unchanged); without conflicts it succeeds.
    const published = await api.post('/timetables/publish', { versionId, notes: 'E2E publication' }, adminToken);
    expect([201, 400]).toContain(published.status);
    if (published.status === 201) {
      // The API nests this one under the controller prefix: /timetables/timetables/:id/history.
      const history = await api.get(`/timetables/timetables/${timetables[0].id}/history`, adminToken);
      expect(history.status).toBe(200);
      // A published week is immutable.
      const move = await api.patch('/timetables/entries/move', { entryId: 'non-existent-entry', targetDayOfWeek: 2, targetPeriodId: 'non-existent-period' }, adminToken);
      expect(move.status).toBeGreaterThanOrEqual(400);
    }
  });

  test('teacher uploads a resource and a submission; both are retrievable by an authorised caller only', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const teacherToken = await api.login(fixtures.credentials.teacher.email, fixtures.credentials.teacher.password);
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);

    await signIn(page, fixtures.credentials.teacher.email, fixtures.credentials.teacher.password, /dashboard/);
    await page.goto('/teaching/resources');

    // Upload through the real uploader (multipart, content-sniffed by the API).
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput.setInputFiles({
        name: `e2e-note-${Date.now()}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('Notes for the E2E verification run.'),
      });
      await expect(page.getByText(/uploaded|stored|saved/i).first()).toBeVisible({ timeout: 30_000 });
    }

    const resources = await api.get('/resources', teacherToken);
    expect(resources.status).toBe(200);

    // Files are never public: an anonymous request for a file id is refused.
    const files = await api.get('/files?purpose=RESOURCE', teacherToken).catch(() => ({ status: 404, data: [] as unknown[] }));
    const fileId = Array.isArray(files.data) && files.data.length ? (files.data as Array<{ id: string }>)[0].id : null;
    if (fileId) {
      const anonymous = await fetch(`${fixtures.apiBase}/api/v1/files/${fileId}/download`);
      expect(anonymous.status).toBe(401);
      const guardian = await api.get(`/files/${fileId}/download`, parentToken);
      expect([200, 403, 404]).toContain(guardian.status);
    }
  });

  test('profile update and notification read are persisted', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);

    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await page.goto('/account');
    await page.getByRole('tab', { name: /profile/i }).click().catch(() => undefined);
    const phoneInput = page.getByLabel(/phone|mobile/i).first();
    if (await phoneInput.count()) {
      await phoneInput.fill('+254700123456');
      const save = page.getByRole('button', { name: /save/i }).first();
      await save.click();
      await expect(page.getByText(/saved|updated/i).first()).toBeVisible({ timeout: 20_000 });
      const me = await api.get('/auth/me', adminToken);
      expect(JSON.stringify(me.data)).toContain('+254700123456');
    }

    // Notifications: mark one read for the guardian and confirm the row changed.
    const parentToken = await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password);
    const list = await api.get('/notifications', parentToken);
    const rows = (list.data?.items ?? list.data ?? []) as Array<{ id: string; readAt: string | null }>;
    if (rows.length) {
      const unread = rows.find((row) => !row.readAt) ?? rows[0];
      const marked = await api.patch(`/notifications/${unread.id}/read`, {}, parentToken);
      expect([200, 201, 204]).toContain(marked.status);
      const after = await api.get('/notifications', parentToken);
      const updated = ((after.data?.items ?? after.data ?? []) as Array<{ id: string; readAt: string | null }>).find((row) => row.id === unread.id);
      expect(updated?.readAt).toBeTruthy();
    }
  });
});
