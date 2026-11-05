import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

/**
 * Browser end-to-end configuration.
 *
 * The suite owns both processes it talks to, and both are pointed at the
 * **dedicated test database** (`edutrack_pro_test`) — never the development or
 * production data:
 *
 *   API  : node apps/api/dist/main.js        on :4101   (DATABASE_URL → _test)
 *   WEB  : next start                        on :4100   (proxy → :4101)
 *
 * The fixtures in e2e/seed.mjs create a fresh tenant through the public API
 * before the specs run, and the specs assert persistence by re-reading the API
 * (no browser-only state is trusted).
 */
// Playwright loads this file through its own TypeScript loader (CommonJS), so
// `__dirname` is the portable choice here.
const here = __dirname;
const repoRoot = join(here, '..', '..', '..');

const API_PORT = Number(process.env.E2E_API_PORT ?? 4101);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4100);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
// A private build directory: the suite can run while a dev server is using .next.
const E2E_DIST_DIR = process.env.E2E_DIST_DIR ?? '.cache/next-e2e';

const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://edutrack:edutrack_dev_password@localhost:5432/edutrack_pro_test?schema=public';

const apiEnv = {
  NODE_ENV: 'production',
  PORT: String(API_PORT),
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_ACCESS_SECRET: 'e2e-access-secret-value-not-used-anywhere-else-0001',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-not-used-anywhere-else-0002',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: WEB_ORIGIN,
  PUBLIC_WEB_URL: WEB_ORIGIN,
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(repoRoot, 'storage-e2e'),
  EMAIL_PROVIDER: 'console',
  ALLOW_SCHOOL_SELF_REGISTRATION: 'true',
  ALLOW_PARENT_SELF_REGISTRATION: 'true',
  AUTH_RATE_LIMIT_MAX: process.env.E2E_AUTH_RATE_LIMIT_MAX ?? '1000',
  AUTH_RATE_LIMIT_WINDOW_MS: '60000',
  GLOBAL_RATE_LIMIT_MAX: process.env.E2E_GLOBAL_RATE_LIMIT_MAX ?? '100000',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: here,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: `node apps/api/dist/main.js`,
      cwd: repoRoot,
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: apiEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Builds into the suite's private output directory, then serves it — so
      // the browser tests always run against a production build of the app.
      command: 'npm run e2e:serve',
      cwd: join(repoRoot, 'apps', 'web'),
      url: `${WEB_ORIGIN}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { API_INTERNAL_URL: API_ORIGIN, NODE_ENV: 'production', PORT: String(WEB_PORT), NEXT_DIST_DIR: E2E_DIST_DIR },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  globalSetup: join(here, 'global-setup.mjs'),
});
