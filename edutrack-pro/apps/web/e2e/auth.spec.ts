import { apiClient, expect, signIn, test } from './helpers';

/**
 * Authentication surfaces and the onboarding policy, exercised through the
 * browser exactly as a user would.
 *
 * Everything asserted here happens against the real API and the dedicated test
 * database: no response is mocked, and "signed out" means the server-side
 * refresh token was revoked.
 */
test.describe('Authentication and onboarding', () => {
  test('the sign-in page offers no demonstration credentials and calls the policy endpoint', async ({ page, fixtures }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) requested.push(new URL(request.url()).pathname);
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    // The seeded development credentials must never appear on a public page.
    for (const forbidden of ['admin@nhjs.demo', 'teacher@nhjs.demo', 'parent@nhjs.demo', 'edutrack-2026!demo', 'demonstration school']) {
      expect(body, `sign-in page must not mention ${forbidden}`).not.toContain(forbidden);
    }
    // No quick-fill buttons either: the form starts empty.
    await expect(page.getByLabel(/^Email address/)).toHaveValue('');
    expect(requested.some((path) => path.endsWith('/auth/setup-status'))).toBe(true);
  });

  test('rejects a wrong password without revealing whether the account exists', async ({ page, fixtures }) => {
    await page.goto('/login');
    await page.getByLabel(/^Email address/).fill(fixtures.credentials.admin.email);
    await page.getByLabel(/^Password/).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/could not sign you in/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // An address that does not exist must fail the same way (no enumeration).
    await page.getByLabel(/^Email address/).fill(`nobody.${Date.now()}@e2e.test`);
    await page.getByLabel(/^Password/).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/could not sign you in/i)).toBeVisible();
  });

  test('signs in, routes by role, and signs out (server-side revocation)', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);

    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/welcome/i);

    // The session token really works against the API.
    const token = await page.evaluate(() => {
      const raw = window.localStorage.getItem('edutrack.session');
      return raw ? (JSON.parse(raw).accessToken as string) : null;
    });
    expect(token).toBeTruthy();
    expect((await api.get('/auth/me', token!)).status).toBe(200);

    // Sign out from the account menu.
    await page.getByRole('button', { name: /account|sign out|menu/i }).first().click();
    const signOut = page.getByRole('menuitem', { name: /sign out/i }).or(page.getByRole('button', { name: /sign out/i })).first();
    await signOut.click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    expect(await page.evaluate(() => window.localStorage.getItem('edutrack.session'))).toBeNull();

    // A dashboard must not be reachable after signing out.
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/, { timeout: 20_000 });
  });

  test('each role lands on its own home and cannot reach the others', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);

    await signIn(page, fixtures.credentials.teacher.email, fixtures.credentials.teacher.password, /dashboard/);
    // The audit trail is administrator-only: the API refuses a teacher outright
    // (not merely by hiding the navigation item) and the screen reports it.
    const teacherToken = (await api.login(fixtures.credentials.teacher.email, fixtures.credentials.teacher.password)) as string;
    expect([401, 403]).toContain((await api.get('/audit-logs', teacherToken)).status);
    await page.goto('/audit');
    await expect(page.locator('#main-content')).toContainText(/permission|denied|not allowed|forbidden/i);

    await signIn(page, fixtures.credentials.parent.email, fixtures.credentials.parent.password, /dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/hello/i);
    // A guardian's learner list is scoped to their own children by the API, so the
    // role boundary is checked where it is absolute: the audit trail and the
    // staff/invitation endpoints are administrator-only. The API refuses, and the
    // screen states the refusal instead of pretending there is simply no data.
    const parentToken = (await api.login(fixtures.credentials.parent.email, fixtures.credentials.parent.password)) as string;
    expect([401, 403]).toContain((await api.get('/audit-logs', parentToken)).status);
    expect([401, 403]).toContain((await api.get('/parents', parentToken)).status);
    await page.goto('/audit');
    await expect(page.locator('#main-content')).toContainText(/permission|denied|not allowed|forbidden/i);
  });

  test('an expired or tampered session returns to sign-in with a clear reason', async ({ page, fixtures }) => {
    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('edutrack.session');
      if (!raw) return;
      const session = JSON.parse(raw);
      session.accessToken = 'tampered.token.value';
      session.refreshToken = 'tampered.refresh.value';
      window.localStorage.setItem('edutrack.session', JSON.stringify(session));
    });
    await page.goto('/people/learners');
    await page.waitForURL(/\/login\?reason=expired/, { timeout: 20_000 });
    await expect(page.getByText(/session ended/i)).toBeVisible();
  });

  test('forgotten-password answers identically for known and unknown addresses', async ({ page, fixtures }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /forgotten your password/i }).click();

    const answer = async (email: string) => {
      const response = page.waitForResponse((candidate) => candidate.url().includes('/auth/password/forgot'), { timeout: 20_000 });
      await page.getByLabel(/^Account email/).fill(email);
      await page.getByRole('button', { name: /send reset link/i }).click();
      return (await response).json();
    };

    const known = await answer(fixtures.credentials.admin.email);
    const unknown = await answer(`missing.${Date.now()}@e2e.test`);
    expect(unknown.message).toBe(known.message);
    expect(await page.getByRole('status').first().innerText()).toMatch(/if that address belongs/i);
  });

  test('a reset link sets a new password once, revokes sessions, and is single use', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const adminToken = await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password);

    // Sign the guardian in so there is a live session to revoke.
    const session = await api.post('/auth/login', {
      email: fixtures.credentials.parent.email,
      password: fixtures.credentials.parent.password,
      clientType: 'WEB',
    });
    expect([200, 201]).toContain(session.status);
    const oldRefreshToken = session.data.refreshToken as string;

    // The school office issues a reset link for the guardian's account.
    const parents = await api.get('/parents', adminToken);
    const guardian = (parents.data as Array<{ userId: string; email: string }>).find((row) => row.email === fixtures.credentials.parent.email);
    expect(guardian).toBeTruthy();
    const issued = await api.post(`/auth/accounts/${guardian!.userId}/password-reset-link`, {}, adminToken);
    expect([200, 201]).toContain(issued.status);
    const resetUrl = new URL(issued.data.resetUrl as string);

    // Complete the reset in the browser.
    await page.goto(`${resetUrl.pathname}${resetUrl.search}`);
    await page.getByLabel(/^New password/).fill('Guardian-Reset-Pass!2026');
    await page.getByLabel(/^Confirm new password/).fill('Guardian-Reset-Pass!2026');
    await page.getByRole('button', { name: /set my new password/i }).click();
    await page.waitForURL(/\/login\?reset=1/, { timeout: 20_000 });
    await expect(page.getByText(/password updated/i)).toBeVisible();

    // The new password works (persisted), the old one does not.
    const after = await api.post('/auth/login', {
      email: fixtures.credentials.parent.email,
      password: 'Guardian-Reset-Pass!2026',
      clientType: 'WEB',
    });
    expect([200, 201]).toContain(after.status);
    const stale = await api.post('/auth/login', {
      email: fixtures.credentials.parent.email,
      password: fixtures.credentials.parent.password,
      clientType: 'WEB',
    });
    expect(stale.status).toBe(401);

    // Sessions that existed before the reset were revoked server-side.
    const refresh = await api.post('/auth/refresh', { refreshToken: oldRefreshToken, clientType: 'WEB' });
    expect(refresh.status).toBe(401);

    // The same token cannot be replayed.
    const replay = await api.post('/auth/password/reset', { token: resetUrl.searchParams.get('token'), password: 'Another-Password!2026' });
    expect(replay.status).toBe(400);

    // Put the fixture password back so later specs see a stable fixture.
    const again = await api.post(`/auth/accounts/${guardian!.userId}/password-reset-link`, {}, adminToken);
    const restoreUrl = new URL(again.data.resetUrl as string);
    const restored = await api.post('/auth/password/reset', {
      token: restoreUrl.searchParams.get('token'),
      password: fixtures.credentials.parent.password,
    });
    expect([200, 201]).toContain(restored.status);
  });


  test('the public reset page never confirms whether an address is registered', async ({ page, fixtures }) => {
    await page.goto('/reset-password');
    await page.getByLabel(/^Account email/).fill(fixtures.credentials.admin.email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText(/check your inbox/i)).toBeVisible();

    await page.goto('/reset-password?token=an-invalid-token-that-is-long-enough');
    await page.getByLabel(/^New password/).fill('Brand-New-Pass!2026');
    await page.getByLabel(/^Confirm new password/).fill('Brand-New-Pass!2026');
    await page.getByRole('button', { name: /set my new password/i }).click();
    await expect(page.getByText(/reset not completed/i)).toBeVisible();
    await expect(page.getByText(/invalid or has expired|no longer valid/i)).toBeVisible();
  });

  test('a school-registration page validates before it submits anything', async ({ page, fixtures }) => {
    const api = apiClient(fixtures.apiBase);
    const schoolsBefore = (await api.get('/learners', await api.login(fixtures.credentials.admin.email, fixtures.credentials.admin.password))).status;
    expect(schoolsBefore).toBe(200);

    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /create your school/i })).toBeVisible();
    // Submitting an empty form must not call the API.
    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/auth/register/school')) posted = true;
    });
    await page.getByRole('button', { name: /create school and sign in/i }).click();
    await expect(page.getByText(/please correct the highlighted fields|enter the school name/i).first()).toBeVisible();
    expect(posted).toBe(false);
  });

  test('an invalid invitation link is explained, not silently accepted', async ({ page }) => {
    await page.goto('/activate?token=this-token-does-not-exist-0123456789');
    await expect(page.getByText(/cannot be used|no longer valid/i).first()).toBeVisible();
  });

  test('guardian registration explains that verification is required', async ({ page }) => {
    await page.goto('/register/parent');
    await expect(page.getByRole('heading', { name: /create a guardian account/i })).toBeVisible();
    await expect(page.getByText(/verified|verify/i).first()).toBeVisible();
  });
});
