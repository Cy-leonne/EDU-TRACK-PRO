/** Strongly typed configuration loaded from environment variables. */
export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  apiPublicUrl: string;
  corsOrigins: string[];
  /**
   * Extra origins allowed to embed the API's HTML pages (service banner and
   * Swagger UI) in an iframe. Empty by default = framing refused outright.
   * Only needed for hosted preview environments; leave empty in production.
   */
  embedAncestors: string[];
  database: { url: string };
  auth: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
    cookieSecure: boolean;
    cookieDomain?: string;
    rateLimitWindowMs: number;
    rateLimitMax: number;
    globalRateLimitMax: number;
  };
  initialAdminSetupToken?: string;
  /** Public base URL of the web app (used in invitation and reset links). */
  publicWebUrl?: string;
  /**
   * Who may create an account without an administrator invitation.
   *  - schoolSelfRegistration: expose "register a new school" publicly
   *  - parentSelfRegistration: let guardians register with the school's code
   * Teachers and additional administrators are ALWAYS invitation-only.
   */
  registration: { schoolSelfRegistration: boolean; parentSelfRegistration: boolean };
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    maxUploadMb: number;
    signedUrlTtlSeconds: number;
    s3: { endpoint?: string; region: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean };
  };
  email: { provider: 'console' | 'smtp'; from: string; smtp: { host?: string; port: number; user?: string; password?: string; secure: boolean } };
  queue: { enabled: boolean; redisUrl?: string };
  defaults: { timezone: string; schoolName: string };
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = (env.NODE_ENV ?? 'development') === 'production';
  const accessSecret = env.JWT_ACCESS_SECRET ?? '';
  const refreshSecret = env.JWT_REFRESH_SECRET ?? '';

  if (isProd) {
    const weakSecrets = [accessSecret, refreshSecret].some((s) => s.length < 32 || s.includes('CHANGE_ME'));
    if (weakSecrets) {
      throw new Error(
        'Refusing to start: JWT_ACCESS_SECRET / JWT_REFRESH_SECRET must be set to strong, unique values (>= 32 chars) in production.',
      );
    }
  }

  return {
    env: env.NODE_ENV ?? 'development',
    port: num(env.PORT, 4000),
    apiPrefix: env.API_PREFIX ?? '/api/v1',
    apiPublicUrl: env.API_PUBLIC_URL ?? `http://localhost:${num(env.PORT, 4000)}`,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    embedAncestors: (env.EMBED_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    database: { url: env.DATABASE_URL ?? '' },
    auth: {
      accessSecret: accessSecret || 'dev-only-access-secret-not-for-production-use-32',
      refreshSecret: refreshSecret || 'dev-only-refresh-secret-not-for-production-use-32',
      accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
      refreshTtl: env.REFRESH_TOKEN_TTL ?? '30d',
      cookieSecure: (env.COOKIE_SECURE ?? 'false') === 'true' || isProd,
      cookieDomain: env.COOKIE_DOMAIN || undefined,
      rateLimitWindowMs: num(env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      rateLimitMax: num(env.AUTH_RATE_LIMIT_MAX, 10),
      globalRateLimitMax: num(env.GLOBAL_RATE_LIMIT_MAX, 600),
    },
    initialAdminSetupToken: env.INITIAL_ADMIN_SETUP_TOKEN || undefined,
    publicWebUrl: env.PUBLIC_WEB_URL || (env.CORS_ORIGINS ?? '').split(',')[0]?.trim() || undefined,
    registration: {
      schoolSelfRegistration: (env.ALLOW_SCHOOL_SELF_REGISTRATION ?? 'false') === 'true',
      parentSelfRegistration: (env.ALLOW_PARENT_SELF_REGISTRATION ?? 'true') === 'true',
    },
    storage: {
      driver: (env.STORAGE_DRIVER as 'local' | 's3') ?? 'local',
      localDir: env.STORAGE_LOCAL_DIR ?? './storage',
      maxUploadMb: num(env.MAX_UPLOAD_MB, 15),
      signedUrlTtlSeconds: num(env.SIGNED_URL_TTL_SECONDS, 300),
      s3: {
        endpoint: env.S3_ENDPOINT || undefined,
        region: env.S3_REGION ?? 'af-south-1',
        bucket: env.S3_BUCKET || undefined,
        accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
        forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      },
    },
    email: {
      provider: (env.EMAIL_PROVIDER as 'console' | 'smtp') ?? 'console',
      from: env.EMAIL_FROM ?? 'EduTrack Pro <no-reply@example.ac.ke>',
      smtp: {
        host: env.SMTP_HOST || undefined,
        port: num(env.SMTP_PORT, 587),
        user: env.SMTP_USER || undefined,
        password: env.SMTP_PASSWORD || undefined,
        secure: (env.SMTP_SECURE ?? 'false') === 'true',
      },
    },
    queue: { enabled: (env.QUEUE_ENABLED ?? 'false') === 'true', redisUrl: env.REDIS_URL || undefined },
    defaults: { timezone: env.DEFAULT_TIMEZONE ?? 'Africa/Nairobi', schoolName: env.DEFAULT_SCHOOL_NAME ?? 'EduTrack Pro Demo Junior School' },
  };
}
