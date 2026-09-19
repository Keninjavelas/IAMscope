import { z } from 'zod';

/**
 * `import.meta.env` is validated once at module load (Plan §6). Vite only exposes
 * `VITE_*` keys, so the schema is deliberately narrow.
 *
 * `VITE_API_URL` is intentionally allowed to be empty: an empty value means
 * "same origin", which is how dev (Vite proxy) and production (Vercel rewrite)
 * both work - see frontend/vite.config.ts and frontend/vercel.json.
 */
const rawSchema = z
  .object({
    VITE_API_URL: z.string().trim().default(''),
    VITE_SSE_MODE: z.enum(['cookie', 'token']).default('cookie'),
    VITE_RENDER_URL: z.string().trim().default(''),
    MODE: z.enum(['development', 'production', 'test']).default('development'),
    DEV: z.boolean().default(false),
    PROD: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    // Token mode reaches the API directly instead of through the same-origin rewrite, so it
    // needs an absolute origin. Checking it here turns a misconfigured deploy into a build
    // failure rather than a runtime `new EventSource('undefined/api/events')`.
    if (value.VITE_SSE_MODE === 'token' && value.VITE_RENDER_URL === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'VITE_RENDER_URL is required when VITE_SSE_MODE=token',
        path: ['VITE_RENDER_URL'],
      });
    }
  });

const raw: unknown = {
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_SSE_MODE: import.meta.env.VITE_SSE_MODE,
  VITE_RENDER_URL: import.meta.env.VITE_RENDER_URL,
  MODE: import.meta.env.MODE,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD,
};

const parsed = rawSchema.safeParse(raw);

if (!parsed.success) {
  // Fail loudly in dev, but never block the bundle in production.
  const detail = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid frontend environment configuration: ${detail}`);
}

function normaliseBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  // Allow a bare host in the env file and normalise it to an origin.
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const apiBaseUrl = normaliseBaseUrl(parsed.data.VITE_API_URL);

export const env = {
  /** Empty string means "call /api on the current origin". */
  apiBaseUrl,
  isSameOrigin: apiBaseUrl === '',
  /**
   * `cookie` (default) reaches the API through the same-origin rewrite, so the session
   * cookie applies. `token` mints a short-lived token and connects straight to the API
   * origin - see `useSSE` and DECISIONS D24.
   */
  sseMode: parsed.data.VITE_SSE_MODE,
  /** Origin to reach directly. Only meaningful when `sseMode` is `token`. */
  renderBaseUrl: normaliseBaseUrl(parsed.data.VITE_RENDER_URL),
  mode: parsed.data.MODE,
  isDev: parsed.data.DEV,
  isProd: parsed.data.PROD,
  isTest: parsed.data.MODE === 'test',
  appName: 'IAMScope',
} as const;

export type Env = typeof env;
