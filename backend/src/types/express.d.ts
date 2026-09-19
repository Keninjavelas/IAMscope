/**
 * Declaration merging for Express (Plan §6 `src/types/express.d.ts`).
 * Adds the request id, the child logger and the typed `AuthContext`.
 */
import type { Logger } from 'pino';
import type { AuthContext } from '../auth/context';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed back as `X-Request-Id` (Plan §18). */
      requestId: string;
      /** Child logger carrying `requestId`. */
      log: Logger;
      /** Set by `attachAuth`; `undefined` for anonymous requests. */
      auth: AuthContext | undefined;
    }
  }
}

export {};
