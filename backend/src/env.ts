import { z } from 'zod';
import pkg from '../../package.json';

/**
 * Environment configuration (Plan §19, §23).
 *
 * Validated by zod at boot and frozen. Secrets are **never** logged: only the names of the
 * variables that failed validation are printed.
 */

const DEV_SESSION_SECRET = 'dev-session-secret-change-me';
const DEV_CSRF_SECRET = 'dev-csrf-secret-change-me';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
    MONGO_IDENTITY_URL: z
      .string()
      .min(1, 'MONGO_IDENTITY_URL is required')
      .default('mongodb://localhost:27017/iamscope_identity'),
    MONGO_DATA_URL: z
      .string()
      .min(1, 'MONGO_DATA_URL is required')
      .default('mongodb://localhost:27017/iamscope_data'),
    /** Comma-separated list of allowed browser origins. */
    CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
    SESSION_SECRET: z
      .string()
      .min(16, 'SESSION_SECRET must be at least 16 chars')
      .default(DEV_SESSION_SECRET),
    CSRF_SECRET: z
      .string()
      .min(16, 'CSRF_SECRET must be at least 16 chars')
      .default(DEV_CSRF_SECRET),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_VERSION: z.string().min(1).default(pkg.version),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    /**
     * Comma-separated allowlist of platform-admin emails. Empty by default and
     * **fail-closed**: an empty list means nobody is an admin, so a missing config
     * cannot accidentally grant cross-tenant access.
     */
    PLATFORM_ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean),
      ),
    /** Minutes of inactivity before a session is treated as idle-expired. 0 disables the check. */
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(0).max(1_440).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;
    if (value.SESSION_SECRET === DEV_SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET must be set explicitly in production',
      });
    }
    if (value.CSRF_SECRET === DEV_CSRF_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CSRF_SECRET'],
        message: 'CSRF_SECRET must be set explicitly in production',
      });
    }
  });

export type RawEnv = z.infer<typeof envSchema>;

export interface Env extends Omit<RawEnv, 'CORS_ORIGIN'> {
  /** `CORS_ORIGIN` split into a list and trimmed of empty entries. */
  readonly CORS_ORIGINS: readonly string[];
}

function readEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // Intentionally `console.error`: the logger itself depends on this module.
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    throw new Error(`Invalid environment configuration (${parsed.error.issues.length} problem(s))`);
  }

  const { CORS_ORIGIN, ...rest } = parsed.data;
  const origins = CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return Object.freeze({
    ...rest,
    CORS_ORIGINS: Object.freeze(origins.length > 0 ? origins : ['http://localhost:3000']),
  });
}

export const env: Env = readEnv(process.env);

/** Milliseconds in 30 days - the session cookie/token lifetime (Plan §9.2). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1_000);

export const IS_PRODUCTION = env.NODE_ENV === 'production';

/** `Secure` cookies require HTTPS, so they are only enabled in production. */
export const COOKIE_SECURE = IS_PRODUCTION;
