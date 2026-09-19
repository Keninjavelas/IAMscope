/** Graph lens (Plan §8.9, §11.5, §15.5). */
import { Router } from 'express';
import { z } from 'zod';
import { graphPathsQuerySchema } from '@iamscope/schemas';
import { requireAuth, requireOrg } from '../auth/middleware';
import { notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { toEscalationPathDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  computeEscalationPaths,
  getEscalationGraph,
  listEscalationPaths,
} from '../services/escalation';

export const graphRouter = Router();
graphRouter.use(requireAuth, requireOrg);

const escalationBodySchema = z.object({
  fromPrincipalArn: z.string().trim().max(512).optional(),
  maxDepth: z.coerce.number().int().min(1).max(5).optional(),
  refresh: z.boolean().optional(),
});

/* ------------------------------------------------------------------ */
/* POST /graph/escalation                                              */
/* ------------------------------------------------------------------ */

graphRouter.post(
  '/escalation',
  validateBody(escalationBodySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const body = req.body as { fromPrincipalArn?: string; maxDepth?: number; refresh?: boolean };

    if (body.fromPrincipalArn === undefined) {
      const payload = await getEscalationGraph(orgId, {
        maxDepth: body.maxDepth,
        refresh: body.refresh,
      });
      sendData(res, payload);
      return;
    }

    const result = await computeEscalationPaths(orgId, {
      fromPrincipalArn: body.fromPrincipalArn,
      maxDepth: body.maxDepth,
    });

    await auditMutation(req, {
      action: 'graph.escalation.compute',
      target: { type: 'principal', id: body.fromPrincipalArn, name: body.fromPrincipalArn },
      metadata: { paths: result.paths.length, maxDepth: body.maxDepth ?? 5 },
    });

    const payload = await getEscalationGraph(orgId, {
      fromPrincipalArn: body.fromPrincipalArn,
      maxDepth: body.maxDepth,
      refresh: true,
    });
    sendData(res, payload);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /graph/paths                                                    */
/* ------------------------------------------------------------------ */

graphRouter.get(
  '/paths',
  validateQuery(graphPathsQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as { from?: string };
    const paths = await listEscalationPaths(orgId, query.from);
    // A bare array: the Graph lens builds the renderable node/edge payload client-side
    // from these paths (Plan §15.5).
    sendData(res, paths.map(toEscalationPathDTO));
  }),
);

/* ------------------------------------------------------------------ */
/* POST /graph/refresh                                                 */
/* ------------------------------------------------------------------ */

graphRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const result = await computeEscalationPaths(orgId);
    await auditMutation(req, {
      action: 'graph.escalation.compute',
      target: { type: 'org', id: oidRequired(orgId), name: 'escalation_paths' },
      metadata: { paths: result.paths.length },
    });

    sendData(res, result.paths.map(toEscalationPathDTO));
  }),
);
