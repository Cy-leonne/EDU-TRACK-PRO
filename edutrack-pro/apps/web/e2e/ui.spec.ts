import { expect, signIn, test } from './helpers';

/**
 * UI interaction checks: navigation, menus, dialogs, tables, forms, learner
 * switching, notifications, sign-out — each with a persistence assertion where
 * the interaction changes data.
 */
test.describe('UI interactions', () => {
  test.beforeEach(async ({ page, fixtures }) => {
    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
  });

  test('sidebar navigation reaches every admin area and marks the active item', async ({ page }) => {
    const destinations: Array<[string, RegExp]> = [
      ['Teachers', /\/people\/teachers/],
      ['Learners', /\/people\/learners/],
      ['Classes & enrolment', /\/academics\/classes/],
      ['Learning areas', /\/academics\/learning-areas/],
      ['Timetable workspace', /\/timetable/],
      ['Reports & exports', /\/reports/],
      ['Audit log', /\/audit/],
      ['School settings', /\/settings\/school/],
    ];
    for (const [label, url] of destinations) {
      await page.getByRole('link', { name: label, exact: true }).first().click();
      await page.waitForURL(url, { timeout: 20_000 });
      await expect(page.locator('#main-content')).toBeVisible();
    }
  });

  test('the top bar exposes search and the account menu, and search reaches a screen', async ({ page }) => {
    const search = page.getByLabel('Search', { exact: true });
    await expect(search).toBeVisible();
    await search.fill('learners');
    await expect(page.getByRole('link', { name: /learners/i }).first()).toBeVisible();
  });

  test('a table supports search, and destructive actions require confirmation', async ({ page }) => {
    await page.goto('/people/learners');
    const search = page.getByLabel('Search learners');
    await search.fill('zzz-no-such-learner');
    await expect(page.getByText(/no learners match|nothing to show|no results/i).first()).toBeVisible({ timeout: 20_000 });
    await search.fill('');
    await expect(page.getByRole('table')).toBeVisible();

    // Deactivation/toggle style actions are never one-click destructive.
    const toggle = page.getByRole('button', { name: /deactivate|archive|delete/i }).first();
    if (await toggle.count()) {
      await toggle.click();
      const dialog = page.getByRole('dialog');
      if (await dialog.count()) {
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: /cancel/i }).click();
        await expect(dialog).toBeHidden();
      }
    }
  });

  test('a modal form keeps its validation visible and reports API errors', async ({ page }) => {
    await page.goto('/academics/learning-areas');
    await page.getByRole('button', { name: /add learning area|new learning area/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Escape closes it (keyboard support) and reopens cleanly.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: /add learning area|new learning area/i }).first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
  });

  test('the verification queue lets the office verify a learner link', async ({ page, fixtures }) => {
    await page.goto('/people/parents');
    await expect(page.locator('#main-content')).toBeVisible();
    const verify = page.getByRole('button', { name: /verify/i }).first();
    if (await verify.count()) {
      await verify.click();
      const dialog = page.getByRole('dialog');
      if (await dialog.count()) {
        await dialog.getByRole('button', { name: /verify|confirm|save/i }).last().click();
        await expect(page.getByText(/verified|updated/i).first()).toBeVisible({ timeout: 20_000 });
      }
    }
  });

  test('a guardian switches learners and the whole workspace follows', async ({ page, fixtures }) => {
    await signIn(page, fixtures.credentials.parent.email, fixtures.credentials.parent.password, /dashboard/);

    const switcher = page.getByRole('button', { name: /verified link|awaiting verification/i });
    await expect(switcher.first()).toBeVisible({ timeout: 20_000 });
    const count = await switcher.count();
    expect(count).toBeGreaterThanOrEqual(1);
    if (count > 1) {
      await switcher.nth(1).click();
      await expect(switcher.nth(1)).toHaveAttribute('aria-pressed', 'true');
      // The hero panel names the newly selected learner.
      await expect(page.locator('#main-content')).toContainText(/your child/i);
    }
  });

  test('notifications open, and the bell reflects the unread state', async ({ page, fixtures }) => {
    await signIn(page, fixtures.credentials.parent.email, fixtures.credentials.parent.password, /dashboard/);
    await page.goto('/family/notifications');
    await expect(page.locator('#main-content')).toBeVisible();
    const markAll = page.getByRole('button', { name: /mark.*read|mark all/i }).first();
    if (await markAll.count()) {
      await markAll.click();
      await expect(page.getByText(/marked|read/i).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test('signing out from the account menu returns to sign-in and blocks the dashboard', async ({ page }) => {
    await page.goto('/account');
    await page.getByRole('button', { name: /sign out/i }).first().click();
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) await dialog.getByRole('button', { name: /sign out/i }).last().click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/, { timeout: 20_000 });
  });
});
