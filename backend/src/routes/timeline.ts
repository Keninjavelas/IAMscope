/** Timeline lens (Plan §8.10, §12). */
import { Router } from 'express';
import {
  timelineDiffQuerySchema,
  timelineEventsQuerySchema,
  timelineStateQuerySchema,
} from '@iamscope/schemas';
import { requireAuth, requireOrg } from '../auth/middleware';
import { notFound } from '../lib/errors';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { validateQuery } from '../middleware/validate';
import { diffPreview, entityHistory, eventsInRange, reconstructState } from '../services/timeline';

export const timelineRouter = Router();
timelineRouter.use(requireAuth, requireOrg);

/* ------------------------------------------------------------------ */
/* GET /timeline/state?at=                                             */
/* ------------------------------------------------------------------ */

timelineRouter.get(
  '/state',
  validateQuery(timelineStateQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as { at: string };
    const state = await reconstructState(orgId, new Date(query.at));
    sendData(res, state);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /timeline/events?from=&to=                                      */
/* ------------------------------------------------------------------ */

timelineRouter.get(
  '/events',
  validateQuery(timelineEventsQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as {
      from?: string;
      to?: string;
      granularity?: 'hour' | 'day';
    };
    const payload = await eventsInRange(orgId, { from: query.from, to: query.to });
    sendData(res, { ...payload, granularity: query.granularity ?? 'day' });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /timeline/diff?at=&compareTo=                                   */
/* ------------------------------------------------------------------ */

timelineRouter.get(
  '/diff',
  validateQuery(timelineDiffQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as { at: string; compareTo?: string };
    const preview = await diffPreview(
      orgId,
      new Date(query.at),
      query.compareTo === undefined ? undefined : new Date(query.compareTo),
    );
    sendData(res, preview);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /timeline/history?targetId=                                     */
/* ------------------------------------------------------------------ */

timelineRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const targetId = typeof req.query.targetId === 'string' ? req.query.targetId : '';
    if (targetId === '') throw notFound('targetId is required');
    sendData(res, { events: await entityHistory(orgId, targetId) });
  }),
);
