import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3000';
const creds = {
  admin: ['admin@nhjs.demo', 'Admin-EduTrack-2026!demo'],
  teacher: ['teacher@nhjs.demo', 'Teacher-EduTrack-2026!demo'],
  parent: ['parent@nhjs.demo', 'Parent-EduTrack-2026!demo'],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 200)); });

await page.goto(`${BASE}/login`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: '/home/user/design-review/01-login.png', fullPage: false });
console.log('login body has "demo"?', (await page.content()).toLowerCase().includes('demo'));

for (const [role, [email, password]] of Object.entries(creds)) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([page.waitForURL(/dashboard|family/, { timeout: 20000 }), page.click('button[type=submit]')]);
  await page.waitForLoadState('networkidle');
  const url = page.url();
  await page.screenshot({ path: `/home/user/design-review/02-${role}-home.png` });
  console.log(role, '->', url);
}

// A couple of deep screens as admin
await page.goto(`${BASE}/login`);
await page.fill('input[type=email]', creds.admin[0]);
await page.fill('input[type=password]', creds.admin[1]);
await Promise.all([page.waitForURL(/dashboard/, { timeout: 20000 }), page.click('button[type=submit]')]);
for (const [name, path] of [['learners', '/people/learners'], ['timetable', '/timetable'], ['reports', '/reports'], ['account', '/account'], ['assessment-settings', '/settings/assessment']]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `/home/user/design-review/03-${name}.png` });
}
await page.goto(`${BASE}/register`); await page.waitForLoadState('networkidle');
await page.screenshot({ path: '/home/user/design-review/04-register.png' });
await page.goto(`${BASE}/register/parent`); await page.waitForLoadState('networkidle');
await page.screenshot({ path: '/home/user/design-review/05-register-parent.png' });
await page.goto(`${BASE}/activate?token=invalid-token-value-abcdefghijklmnop`); await page.waitForLoadState('networkidle');
await page.screenshot({ path: '/home/user/design-review/06-activate.png' });
await page.goto(`${BASE}/reset-password`); await page.waitForLoadState('networkidle');
await page.screenshot({ path: '/home/user/design-review/07-reset.png' });

// mobile view
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mpage = await mobile.newPage();
await mpage.goto(`${BASE}/login`);
await mpage.waitForLoadState('networkidle');
await mpage.screenshot({ path: '/home/user/design-review/08-login-mobile.png' });
await mpage.fill('input[type=email]', creds.admin[0]);
await mpage.fill('input[type=password]', creds.admin[1]);
await Promise.all([mpage.waitForURL(/dashboard/, { timeout: 20000 }), mpage.click('button[type=submit]')]);
await mpage.waitForLoadState('networkidle');
await mpage.screenshot({ path: '/home/user/design-review/09-admin-mobile.png' });
console.log('mobile dashboard ok');
await browser.close();
