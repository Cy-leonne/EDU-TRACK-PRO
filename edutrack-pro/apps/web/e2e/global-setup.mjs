import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

/**
 * Global setup for the browser suite.
 *
 * 1. Refuses to run unless DATABASE_URL points at a *_test database — test data
 *    must never touch development or production.
 * 2. Applies migrations to that database (reproducible, non-destructive).
 * 3. Seeds the E2E fixtures through the real API.
 *
 * The production web build is NOT done here: the webServer entry runs
 * `npm run e2e:serve`, which builds before it serves, so the suite always
 * exercises a production build and this setup only prepares data.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const seedFile = join(here, '.seed.json');
const API_PORT = Number(process.env.E2E_API_PORT ?? 4101);

export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://edutrack:edutrack_dev_password@localhost:5432/edutrack_pro_test?schema=public';
  if (!/_test(\?|$)/.test(databaseUrl)) {
    throw new Error(`E2E refuses to run: E2E_DATABASE_URL must point at a dedicated *_test database (got ${databaseUrl}).`);
  }

  // Migrations first — the fixtures call the real endpoints, so the schema has
  // to exist exactly as a deployment would create it.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  if (existsSync(seedFile)) rmSync(seedFile);

  const api = `http://127.0.0.1:${API_PORT}`;
  // Wait for the API the config started.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${api}/health`);
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  execFileSync('node', [join(here, 'seed.mjs'), api, seedFile], { cwd: repoRoot, stdio: 'inherit' });
}
