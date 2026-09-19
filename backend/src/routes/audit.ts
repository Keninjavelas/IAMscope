/** Audit log + attribution (Plan §8.11, §12.4). */
import { Router } from 'express';
import { attributionQuerySchema, auditQuerySchema } from '@iamscope/schemas';
import { requireAuth, requireOrg } from '../auth/middleware';
import { notFound } from '../lib/errors';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { validateQuery } from '../middleware/validate';
import { attribute } from '../services/attribution';
import { listAuditEvents } from '../services/audit';

export const auditRouter = Router();
auditRouter.use(requireAuth, requireOrg);

/* ------------------------------------------------------------------ */
/* GET /audit/attribution?scenarioId=&before=&after=  (before /audit)   */
/* ------------------------------------------------------------------ */

auditRouter.get(
  '/attribution',
  validateQuery(attributionQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as { scenarioId: string; before?: string; after?: string };
    const attribution = await attribute(orgId, {
      scenarioId: query.scenarioId,
      before: query.before,
      after: query.after,
    });
    sendData(res, attribution);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /audit?targetType=&targetId=&actorId=&from=&to=                 */
/* ------------------------------------------------------------------ */

auditRouter.get(
  '/',
  validateQuery(auditQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as {
      page?: number;
      pageSize?: number;
      q?: string;
      targetType?: string;
      targetId?: string;
      actorId?: string;
      action?: string;
      from?: string;
      to?: string;
    };

    sendData(res, await listAuditEvents(orgId, query));
  }),
);
