import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fixtures {
  schoolId: string;
  schoolName: string;
  academicYearId: string;
  termId: string;
  gradeId: string;
  classId: string;
  learningAreaId: string;
  teacherId: string;
  learnerIds: string[];
  assessmentId: string;
  parentProfileId: string;
  credentials: Record<'admin' | 'teacher' | 'parent' | 'stranger', { email: string; password: string }>;
  apiBase: string;
}

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(join(__dirname, '.seed.json'), 'utf8')) as Fixtures;
}

/** A direct API client so specs can verify what the database actually holds. */
export function apiClient(apiBase: string) {
  const request = async (method: string, path: string, options: { token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${apiBase}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: response.status, data: payload?.data ?? payload, raw: payload };
  };
  return {
    get: (path: string, token?: string) => request('GET', path, { token }),
    post: (path: string, body: unknown, token?: string) => request('POST', path, { token, body }),
    patch: (path: string, body: unknown, token?: string) => request('PATCH', path, { token, body }),
    del: (path: string, token?: string) => request('DELETE', path, { token }),
    async login(email: string, password: string) {
      const result = await request('POST', '/auth/login', { body: { email, password, clientType: 'WEB' } });
      if (result.status !== 201 && result.status !== 200) {
        throw new Error(`Login failed for ${email}: ${result.status} ${JSON.stringify(result.raw).slice(0, 200)}`);
      }
      return result.data.accessToken as string;
    },
  };
}

/** Signs in through the real form, so the session the UI uses is a real one. */
export async function signIn(page: Page, email: string, password: string, expectUrl: RegExp) {
  // Start every sign-in from a clean slate: a live session in local storage would
  // bounce the visitor straight back to their own dashboard.
  await page.goto('/login');
  await page.evaluate(() => window.localStorage.clear());
  await page.context().clearCookies();
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.getByLabel(/^Email address/).fill(email);
  // The field label carries a required marker, so match on the prefix.
  await page.getByLabel(/^Password/).fill(password);
  await Promise.all([page.waitForURL(expectUrl, { timeout: 30_000 }), page.getByRole('button', { name: 'Sign in' }).click()]);
}

export const test = base.extend<{ fixtures: Fixtures }>({
  fixtures: async ({}, use) => {
    await use(loadFixtures());
  },
});

export { expect };
