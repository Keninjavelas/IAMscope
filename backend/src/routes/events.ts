/**
 * SSE endpoint (Plan §8.13, §13.2, §22.2).
 *
 * `X-Accel-Buffering: no` is mandatory: Render's proxy buffers responses by default, which would
 * hold events until the connection closes.
 */
import { Router } from 'express';
import { mintEventToken } from '../auth/eventTokens';
import { requireAuth, requireEventAuth, requireOrg } from '../auth/middleware';
import { env } from '../env';
import { forbidden } from '../lib/errors';
import { sendData } from '../middleware/errorHandler';
import { oidRequired } from '../lib/objectId';
import type { SseHelloEvent } from '@iamscope/types';
import {
  SSE_HEARTBEAT_SECONDS,
  SSE_RETRY_MS,
  formatSseFrame,
  registerClient,
  sendToClient,
  unregisterClient,
} from '../services/sse';

export const eventsRouter = Router();

/* ------------------------------------------------------------------ */
/* POST /events/token                                                  */
/* ------------------------------------------------------------------ */

/**
 * Mints a short-lived token so the stream can be opened directly against this origin when
 * the session cookie cannot be sent (Fallback B - see `eventTokens.ts`).
 *
 * Cookie-authenticated and reached through the same-origin rewrite, so minting still depends
 * on the normal session. The token stands in for the cookie on one connection only.
 */
eventsRouter.post('/token', requireAuth, requireOrg, (req, res) => {
  const auth = req.auth;
  if (auth?.session == null || auth.orgId == null) {
    throw forbidden('An interactive session is required to mint an event token');
  }

  const { token, expiresAt } = mintEventToken({
    userId: oidRequired(auth.session.userId),
    orgId: oidRequired(auth.orgId),
    sessionId: oidRequired(auth.session._id),
  });

  sendData(res, { token, expiresAt: expiresAt.toISOString() });
});

/* ------------------------------------------------------------------ */
/* GET /events                                                         */
/* ------------------------------------------------------------------ */

eventsRouter.get('/', requireEventAuth(), (req, res) => {
  const auth = req.auth;
  if (auth?.orgId == null) {
    throw forbidden('No active organization');
  }
  const orgId = oidRequired(auth.orgId);

  // A connection that arrived via `?token=` is cross-origin by definition - it bypassed the
  // same-origin rewrite - so it needs explicit CORS. The token *is* the credential here, so
  // credentials are deliberately withheld alongside it.
  if (typeof req.query.token === 'string') {
    const origin = req.headers.origin;
    if (origin !== undefined && env.CORS_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Content-Encoding', 'identity');
  res.status(200);
  res.flushHeaders();

  // Ask the browser to reconnect after 3s if the stream drops (Plan §13.3).
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);

  const client = registerClient({
    orgId,
    userId: oidRequired(auth.user?._id ?? auth.apiKey?.createdBy ?? orgId),
    response: res,
  });

  const hello: SseHelloEvent = {
    type: 'hello',
    orgId,
    clientId: client.id,
    heartbeatSeconds: SSE_HEARTBEAT_SECONDS,
  };
  sendToClient(client, { event: 'hello', data: hello });

  const cleanup = (): void => unregisterClient(client.id);
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('error', cleanup);
});

/** Exported for tests that assert the frame format. */
export { formatSseFrame };
