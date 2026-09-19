import pino from 'pino';
import { env } from './env';

/**
 * Structured JSON logger (Plan §18). Plain pino output - no transport - so the compiled
 * `dist/` bundle never depends on a devDependency at runtime.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'iamscope-backend',
    version: env.APP_VERSION,
    env: env.NODE_ENV,
  },
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'secret',
      'passwordHash',
      'tokenHash',
      'keyHash',
      'mfaSecret',
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.passwordHash',
      '*.tokenHash',
      '*.keyHash',
    ],
    remove: true,
  },
});

export type Logger = pino.Logger;

/** Child logger carrying the request id so every line can be correlated (Plan §18). */
export function requestLogger(requestId: string, extra: Record<string, unknown> = {}): Logger {
  return logger.child({ requestId, ...extra });
}
