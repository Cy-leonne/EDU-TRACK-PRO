/**
 * Jest configuration for the EduTrack Pro API.
 *
 * - `test/unit`        pure logic (no database, milliseconds)
 * - `test/integration` real HTTP + real PostgreSQL (edutrack_pro_test)
 * - `test/e2e`         end-to-end user journeys
 *
 * `--runInBand` is used by the npm scripts: the suites share one database, and
 * running them in parallel would make isolation assertions flaky.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/env.ts'],
  testTimeout: 60_000,
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
};
