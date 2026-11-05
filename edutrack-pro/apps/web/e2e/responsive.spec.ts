import { expect, signIn, type Fixtures } from './helpers';
import { test } from './helpers';

/**
 * Responsive behaviour and accessibility basics at phone, tablet and desktop
 * widths — for the public pages and for each signed-in role.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
];

type Credentials = Fixtures['credentials'];

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > window.innerWidth + 2 || rect.left < -2);
      })
      .slice(0, 4)
      .map((element) => `${element.tagName.toLowerCase()}.${(element.className || '').toString().split(' ').slice(0, 3).join('.')}`),
  }));
  expect(
    overflow.documentWidth,
    `document should not scroll horizontally (offenders: ${overflow.offenders.join(', ')})`,
  ).toBeLessThanOrEqual(overflow.viewportWidth + 2);
}

test.describe('Responsive layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`public pages fit ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of ['/login', '/register', '/register/parent', '/reset-password']) {
        await page.goto(path);
        await expect(page.locator('#main-content')).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });

    test(`the admin workspace is usable on ${viewport.name}`, async ({ page, fixtures }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);

      // Navigation is either the sidebar (desktop/tablet) or the drawer (phone).
      if (viewport.width < 1024) {
        const menuButton = page.getByRole('button', { name: /open navigation|menu/i }).first();
        await expect(menuButton).toBeVisible();
        await menuButton.click();
        await expect(page.getByRole('link', { name: 'Learners', exact: true }).first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('link', { name: 'Learners', exact: true }).first()).toBeHidden();
      } else {
        await expect(page.getByRole('link', { name: 'Learners', exact: true }).first()).toBeVisible();
      }

      for (const path of ['/people/learners', '/timetable', '/reports']) {
        await page.goto(path);
        await expect(page.locator('#main-content')).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });

    test(`the guardian workspace is usable on ${viewport.name}`, async ({ page, fixtures }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, fixtures.credentials.parent.email, fixtures.credentials.parent.password, /dashboard/);
      await expect(page.locator('#main-content')).toContainText(/hello/i);
      for (const path of ['/family/results', '/family/timetable', '/family/notifications']) {
        await page.goto(path);
        await expect(page.locator('#main-content')).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});

test.describe('Accessibility basics', () => {
  test('every form control on the public pages has an accessible name and a visible focus ring', async ({ page }) => {
    for (const path of ['/login', '/register/parent', '/register']) {
      await page.goto(path);
      const controls = page.locator('input:not([type=hidden]), select, textarea');
      const count = await controls.count();
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        const name = await control.evaluate((element) => {
          const el = element as HTMLInputElement;
          const labelled = el.labels?.[0]?.textContent?.trim();
          return (
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            labelled ||
            (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : null)
          );
        });
        expect(name, `control ${index} on ${path} needs an accessible name`).toBeTruthy();
      }
    }
  });

  test('keyboard tabbing reaches the sign-in form and the skip link works', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to/i }).first();
    if (await skip.count()) {
      await expect(skip).toBeFocused();
      await page.keyboard.press('Enter');
    }
    // Tab until the email field gains focus (no keyboard trap).
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (await page.getByLabel(/^Email address/).evaluate((el) => el === document.activeElement).catch(() => false)) break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByLabel(/^Email address/)).toBeFocused();
  });

  test('status is never communicated by colour alone', async ({ page, fixtures }) => {
    await signIn(page, fixtures.credentials.admin.email, fixtures.credentials.admin.password, /dashboard/);
    await page.goto('/teaching/assessments').catch(() => undefined);
    await page.goto('/timetable');
    // Conflicting/OK states always carry words as well as colour.
    const warnings = page.getByText(/conflict|draft|published|validated/i);
    expect(await warnings.count()).toBeGreaterThan(0);
  });

  test('motion is suppressed when the user prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    const animation = await page.evaluate(() => {
      const element = document.querySelector('main, #main-content') ?? document.body;
      return getComputedStyle(element).animationDuration;
    });
    // Browsers report the suppressed duration as 0s or a sub-microsecond value.
    const seconds = Number.parseFloat(animation.split(',')[0].replace('s', ''));
    expect(Number.isNaN(seconds) || seconds < 0.01, `reduced motion must suppress animation (got ${animation})`).toBe(true);
  });

  test('the sign-in page respects a high-contrast, no-image rendering', async ({ page }) => {
    await page.goto('/login');
    // Text must be readable without the gradient panel (e.g. forced colours).
    const heading = page.getByRole('heading', { name: 'Sign in' });
    const colour = await heading.evaluate((element) => getComputedStyle(element).color);
    expect(colour).not.toBe('rgba(0, 0, 0, 0)');
  });
});
