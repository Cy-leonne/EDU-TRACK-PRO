/**
 * Test environment. Runs before every suite.
 *
 * The tests NEVER touch the development database: DATABASE_URL is forced to the
 * dedicated test database, and every secret here is a throwaway value.
 * Production deployments must supply real values through the environment.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://edutrack:edutrack_dev_password@localhost:5432/edutrack_pro_test?schema=public';
process.env.API_PREFIX = '/api/v1';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL = '30d';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-that-is-long-enough-00000';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.GLOBAL_RATE_LIMIT_MAX = '100000';
process.env.INITIAL_ADMIN_SETUP_TOKEN = 'test-setup-token-0123456789abcdef';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = './.test-storage';
process.env.EMAIL_PROVIDER = 'console';
process.env.COOKIE_SECURE = 'false';
// Onboarding switches under test: the suite proves both the open and the closed
// policy, so the defaults here mirror a self-service deployment.
process.env.ALLOW_SCHOOL_SELF_REGISTRATION = 'true';
process.env.ALLOW_PARENT_SELF_REGISTRATION = 'true';
process.env.PUBLIC_WEB_URL = 'http://localhost:3000';
process.env.DEFAULT_TIMEZONE = 'Africa/Nairobi';
