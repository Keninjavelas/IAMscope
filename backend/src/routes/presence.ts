/** Presence (Plan §8.12, §14). */
import { Router } from 'express';
import { presenceHeartbeatSchema } from '@iamscope/schemas';
import { requireAuth, requireOrg } from '../auth/middleware';
import type { PresenceHeartbeatPayload } from '@iamscope/types';
import { forbidden, notFound } from '../lib/errors';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { validateBody } from '../middleware/validate';
import { heartbeat, listActive, removeForSession } from '../services/presence';
import { broadcast, toSseEvent } from '../services/sse';
import { oidRequired } from '../lib/objectId';

export const presenceRouter = Router();
presenceRouter.use(requireAuth, requireOrg);

presenceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');
    sendData(res, await listActive(orgId));
  }),
);

presenceRouter.post(
  '/heartbeat',
  validateBody(presenceHeartbeatSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.orgId == null || auth.session == null || auth.user == null) {
      throw forbidden('Presence requires an interactive session');
    }

    const payload = req.body as PresenceHeartbeatPayload;
    const doc = await heartbeat({
      orgId: auth.orgId,
      userId: auth.user._id,
      sessionId: auth.session._id,
      payload,
    });

    // Cursors are fanned out immediately so the graph updates without a refetch (Plan §14.3).
    broadcast(
      oidRequired(auth.orgId),
      toSseEvent('presence', 'update', oidRequired(auth.orgId), oidRequired(doc._id), {
        userId: oidRequired(doc.userId),
        sessionId: oidRequired(doc.sessionId),
        cursor: doc.cursor,
        location: doc.location,
        name: auth.user.name,
        color: null,
      }),
    );

    sendData(res, { ok: true });
  }),
);

presenceRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.session == null) throw forbidden('Presence requires an interactive session');
    const removed = await removeForSession(auth.session._id);
    sendData(res, { success: true, removed });
  }),
);
