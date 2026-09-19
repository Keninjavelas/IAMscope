/**
 * Express bootstrap (Plan §4, §18, §19, §22.2).
 *
 * `createApp()` is exported without side effects so integration tests can drive the API with
 * supertest. `bootstrap()` performs the side-effectful wiring (pool connect, indexes, watcher,
 * listen) and only runs when this file is the process entry point.
 */
import http from 'node:http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { HealthResponse } from '@iamscope/types';
import { CSRF_HEADER, readBearerToken } from './auth/cookies';
import { attachAuth } from './auth/middleware';
import { apiRelativePath, shouldSkipCsrf, verifyCsrf } from './auth/csrf';
import { connectData, closeData, pingData, isDataConnected } from './db/data';
import { connectIdentity, closeIdentity, pingIdentity, isIdentityConnected } from './db/identity';
import { createIndexes } from './db/indexes';
import { env } from './env';
import { logger } from './logger';
import { errorHandler, notFoundHandler, sendData } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { createApiRouter } from './routes';
import { cancelPendingEvaluations } from './services/evaluationRunner';
import { closeAllClients, clientCount } from './services/sse';
import { closeWatcher, startWatcher, watcherStatus } from './watcher';

const startedAt = Date.now();

/* ------------------------------------------------------------------ */
/* CSRF (Plan §9.3, §8.14)                                             */
/* ------------------------------------------------------------------ */

/**
 * Double-submit verification for every non-safe request that is *not* authenticated by an API
 * key. API keys are bearer credentials and are not vulnerable to CSRF, so they are exempt.
 */
function csrfMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (shouldSkipCsrf(req)) {
      next();
      return;
    }
    if (readBearerToken(req) !== undefined) {
      next();
      return;
    }
    try {
      verifyCsrf(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

async function healthHandler(req: Request, res: Response): Promise<void> {
  const [identity, data] = await Promise.all([pingIdentity(), pingData()]);
  const watchers = watcherStatus();

  const body: HealthResponse = {
    status: identity && data ? 'ok' : 'degraded',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
    version: env.APP_VERSION,
    database: {
      identity: identity ? 'up' : 'down',
      data: data ? 'up' : 'down',
    },
    watchers: {
      active: watchers.active,
      watchedCollections: watchers.watchedCollections,
    },
    sseClients: clientCount(),
    timestamp: new Date().toISOString(),
  };

  sendData(res, body, body.status === 'ok' ? 200 : 503);
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export function createApp(): Express {
  const app = express();

  // Render terminates TLS in front of the app.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'connect-src': ["'self'", ...env.CORS_ORIGINS],
          'font-src': ["'self'", 'https:', 'data:'],
          'frame-ancestors': ["'none'"],
          'img-src': ["'self'", 'data:', 'https:'],
          'object-src': ["'none'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
          : false,
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (origin === undefined || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        logger.warn({ origin }, 'CORS origin rejected');
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', CSRF_HEADER, 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(requestIdMiddleware());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  const api = createApiRouter();

  // Health is registered before auth/CSRF so the keep-warm cron never needs credentials.
  app.get('/api/health', (req, res, next) => {
    healthHandler(req, res).catch(next);
  });

  app.use('/api', attachAuth(), csrfMiddleware(), api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

let server: http.Server | null = null;

export async function bootstrap(): Promise<{ app: Express; server: http.Server }> {
  await connectIdentity();
  await connectData();

  const indexReport = await createIndexes();
  if (indexReport.failures.length > 0) {
    logger.warn({ failures: indexReport.failures }, 'some indexes could not be created');
  }

  const app = createApp();
  const created = http.createServer(app);
  server = created;

  await new Promise<void>((resolve) => {
    created.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'IAMScope API listening');
      resolve();
    });
  });

  await startWatcher().catch((error: unknown) => {
    logger.error({ err: error }, 'watcher failed to start');
  });

  logger.info(
    { identity: isIdentityConnected(), data: isDataConnected(), watchers: watcherStatus().active },
    'bootstrap complete',
  );

  return { app, server: created };
}

/* ------------------------------------------------------------------ */
/* Graceful shutdown                                                   */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

export async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  cancelPendingEvaluations();
  closeAllClients();

  await closeWatcher().catch(() => undefined);

  if (server !== null) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
      // Do not hang forever on keep-alive connections.
      setTimeout(resolve, 5_000).unref();
    });
  }

  await Promise.all([closeIdentity().catch(() => undefined), closeData().catch(() => undefined)]);
  logger.info({ signal }, 'shutdown complete');
}

function registerSignalHandlers(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException').then(() => process.exit(1));
  });
}

/** Only listen when this file is the process entry point (`node dist/index.js`). */
if (require.main === module) {
  registerSignalHandlers();
  bootstrap().catch((error: unknown) => {
    logger.fatal({ err: error }, 'failed to start');
    process.exit(1);
  });
}

/** Exported for tests. */
export { apiRelativePath };
