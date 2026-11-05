import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Applies migrations to the test database once per `jest` run, and clears the
 * local storage directory used by the file-upload tests.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://edutrack:edutrack_dev_password@localhost:5432/edutrack_pro_test?schema=public';
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../../../..'), // repository root (where prisma/schema.prisma lives)
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const storage = resolve(__dirname, '../../.test-storage');
  if (existsSync(storage)) rmSync(storage, { recursive: true, force: true });
}
