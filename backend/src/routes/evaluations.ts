/**
 * Evaluation + Impact lens (Plan §8.8, §10.7, §12.4).
 * `POST /api/evaluate` is available to every role including `viewer`.
 * `/evaluations/diff` is registered **before** `/evaluations/:id`.
 */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import type { EvaluationOutcome } from '@iamscope/types';
import {
  evaluateSchema,
  evaluationDiffQuerySchema,
  evaluationIdParamSchema,
  listEvaluationsQuerySchema,
  type EvaluateOutput,
} from '@iamscope/schemas';
import { requireAuth, requireOrg, requireRole } from '../auth/middleware';
import { data } from '../db/data';
import { notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { paginated, resolvePagination } from '../lib/pagination';
import { toEvaluationRunDTO, toEvaluationRunSummaryDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import {
  rejectPayloadOrgId,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { diffEvaluations } from '../services/evaluationDiff';
import { evaluateForOrg } from '../services/evaluator';
import { runEvaluationNow } from '../services/evaluationRunner';
import { attribute } from '../services/attribution';
import { identity } from '../db/identity';

export const evaluationsRouter = Router();
export const evaluateRouter = Router();

evaluationsRouter.use(requireAuth, requireOrg, rejectPayloadOrgId());
evaluateRouter.use(requireAuth, requireOrg, rejectPayloadOrgId());

async function triggeredByNames(ids: readonly (ObjectId | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is ObjectId => id !== null).map(oidRequired))];
  if (unique.length === 0) return new Map();
  const users = await identity
    .users()
    .find({ _id: { $in: unique.map((id) => new ObjectId(id)) } })
    .toArray();
  return new Map(users.map((user) => [oidRequired(user._id), user.name]));
}

/* ------------------------------------------------------------------ */
/* POST /api/evaluate                                                  */
/* ------------------------------------------------------------------ */

evaluateRouter.post(
  '/',
  validateBody(evaluateSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const payload = req.body as EvaluateOutput;
    const persist = payload.persist !== false;

    const outcome: EvaluationOutcome = await evaluateForOrg(orgId, {
      principalArn: payload.principalArn,
      action: payload.action,
      resourceArn: payload.resourceArn,
    });

    // The envelope's `data` is the outcome itself; `run` rides along when one was
    // persisted so the caller can deep-link into the run history.
    if (!persist) {
      sendData(res, { ...outcome, run: null });
      return;
    }

    const label = payload.label ?? `manual: ${payload.action}`;
    const { run } = await runEvaluationNow({
      orgId,
      trigger: 'manual',
      triggeredByUserId: req.auth?.user?._id ?? null,
      label,
    });

    await auditMutation(req, {
      action: 'evaluation.run',
      target: { type: 'evaluation_run', id: oidRequired(run._id), name: label },
      after: {
        label,
        summary: run.summary,
        principalArn: payload.principalArn,
        action: payload.action,
      },
    });

    sendData(res, { ...outcome, run: toEvaluationRunDTO(run) });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /evaluations/diff  (must precede /:id)                          */
/* ------------------------------------------------------------------ */

evaluationsRouter.get(
  '/diff',
  validateQuery(evaluationDiffQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as { before?: string; after?: string };
    const collection = data.evaluationRuns();

    const after =
      query.after === undefined
        ? (await collection.find({ orgId }).sort({ snapshotAt: -1 }).limit(1).toArray())[0]
        : await collection.findOne({ orgId, _id: new ObjectId(query.after) });
    if (after === undefined || after === null) throw notFound('Evaluation run not found');

    let before = null;
    if (query.before !== undefined) {
      before = await collection.findOne({ orgId, _id: new ObjectId(query.before) });
    } else {
      before =
        (
          await collection
            .find({ orgId, snapshotAt: { $lt: after.snapshotAt } })
            .sort({ snapshotAt: -1 })
            .limit(1)
            .toArray()
        )[0] ?? null;
    }

    const names = await triggeredByNames([
      after.triggeredByUserId,
      before?.triggeredByUserId ?? null,
    ]);
    const diff = diffEvaluations(before, after, {
      afterName:
        after.triggeredByUserId === null
          ? null
          : (names.get(oidRequired(after.triggeredByUserId)) ?? null),
      beforeName:
        before?.triggeredByUserId == null
          ? null
          : (names.get(oidRequired(before.triggeredByUserId)) ?? null),
    });

    sendData(res, diff);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /evaluations                                                    */
/* ------------------------------------------------------------------ */

evaluationsRouter.get(
  '/',
  validateQuery(listEvaluationsQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const args = resolvePagination(req.query);
    const collection = data.evaluationRuns();
    const [docs, total] = await Promise.all([
      collection
        .find({ orgId })
        .sort({ snapshotAt: -1 })
        .skip(args.skip)
        .limit(args.limit)
        .toArray(),
      collection.countDocuments({ orgId }),
    ]);

    const names = await triggeredByNames(docs.map((doc) => doc.triggeredByUserId));
    sendData(
      res,
      paginated(
        docs.map((doc) =>
          toEvaluationRunSummaryDTO(
            doc,
            doc.triggeredByUserId === null
              ? null
              : (names.get(oidRequired(doc.triggeredByUserId)) ?? null),
          ),
        ),
        total,
        args,
      ),
    );
  }),
);

/* ------------------------------------------------------------------ */
/* GET /evaluations/:id                                                */
/* ------------------------------------------------------------------ */

evaluationsRouter.get(
  '/:id',
  validateParams(evaluationIdParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const doc = await data
      .evaluationRuns()
      .findOne({ orgId, _id: new ObjectId(req.params.id ?? '') });
    if (doc === null) throw notFound('Evaluation run not found');

    const names = await triggeredByNames([doc.triggeredByUserId]);
    sendData(
      res,
      toEvaluationRunDTO(
        doc,
        doc.triggeredByUserId === null
          ? null
          : (names.get(oidRequired(doc.triggeredByUserId)) ?? null),
      ),
    );
  }),
);

/* ------------------------------------------------------------------ */
/* GET /evaluations/:id/attribution                                    */
/* ------------------------------------------------------------------ */

evaluationsRouter.get(
  '/:id/attribution',
  validateParams(evaluationIdParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const run = await data
      .evaluationRuns()
      .findOne({ orgId, _id: new ObjectId(req.params.id ?? '') });
    if (run === null) throw notFound('Evaluation run not found');
    const first = run.results[0];
    if (first === undefined) throw notFound('That run has no scenario results to attribute');

    const result = await attribute(orgId, {
      scenarioId: first.scenarioId,
      after: req.params.id ?? '',
    });
    sendData(res, result);
  }),
);

/* ------------------------------------------------------------------ */
/* DELETE /evaluations  (admin+)                                       */
/* ------------------------------------------------------------------ */

evaluationsRouter.delete(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const result = await data.evaluationRuns().deleteMany({ orgId });
    await auditMutation(req, {
      action: 'evaluation.clear',
      target: { type: 'org', id: oidRequired(orgId), name: 'evaluation_runs' },
      metadata: { deleted: result.deletedCount },
    });

    sendData(res, { success: true, deleted: result.deletedCount });
  }),
);
