/** Scenarios (Plan §8.7). */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  createScenarioSchema,
  idParamSchema,
  listScenariosQuerySchema,
  updateScenarioSchema,
  type CreateScenarioInput,
  type UpdateScenarioInput,
} from '@iamscope/schemas';
import { requireAuth, requireOrg, requireRole } from '../auth/middleware';
import { data } from '../db/data';
import type { ScenarioDoc } from '../db/documents';
import { notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { buildSearchRegex } from '../lib/mongoQuery';
import { paginated, resolvePagination } from '../lib/pagination';
import { toScenarioWithResultDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import {
  rejectPayloadOrgId,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { enqueueEvaluation } from '../services/evaluationRunner';
import { invalidateTimelineCache } from '../services/timeline';

export const scenariosRouter = Router();
scenariosRouter.use(requireAuth, requireOrg, rejectPayloadOrgId());

async function loadScenario(orgId: ObjectId, id: string): Promise<ScenarioDoc> {
  const scenario = await data.scenarios().findOne({ _id: new ObjectId(id), orgId });
  if (scenario === null) throw notFound('Scenario not found');
  return scenario;
}

scenariosRouter.get(
  '/',
  validateQuery(listScenariosQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as {
      q?: string;
      tags?: string[];
      principalArn?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    };
    const args = resolvePagination(query);
    const filter: Record<string, unknown> = { orgId };
    if (query.principalArn !== undefined && query.principalArn !== '')
      filter.principalArn = query.principalArn;
    const rawTags = req.query.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map(String)
      : typeof rawTags === 'string' && rawTags !== ''
        ? [rawTags]
        : [];
    if (tags.length > 0) filter.tags = { $in: tags };
    if (query.q !== undefined && query.q.trim() !== '') {
      const regex = buildSearchRegex(query.q);
      filter.$or = [
        { name: regex },
        { action: regex },
        { principalArn: regex },
        { resourceArn: regex },
      ];
    }

    const [docs, total] = await Promise.all([
      data
        .scenarios()
        .find(filter)
        .sort({ updatedAt: (query.order ?? 'desc') === 'asc' ? 1 : -1 })
        .skip(args.skip)
        .limit(args.limit)
        .toArray(),
      data.scenarios().countDocuments(filter),
    ]);

    sendData(res, paginated(docs.map(toScenarioWithResultDTO), total, args));
  }),
);

scenariosRouter.post(
  '/',
  requireRole('member'),
  validateBody(createScenarioSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const payload = req.body as CreateScenarioInput & {
      name: string;
      principalArn: string;
      action: string;
      resourceArn: string;
      expectedResult: ScenarioDoc['expectedResult'];
      tags?: string[];
    };
    const now = new Date();
    const doc: Omit<ScenarioDoc, '_id'> = {
      orgId,
      name: payload.name,
      principalArn: payload.principalArn,
      action: payload.action,
      resourceArn: payload.resourceArn,
      expectedResult: payload.expectedResult,
      tags: payload.tags ?? [],
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      lastResult: null,
      lastRunAt: null,
    };

    const inserted = await data.scenarios().insertOne(doc as ScenarioDoc);

    const auditId = await auditMutation(req, {
      action: 'scenario.create',
      target: { type: 'scenario', id: oidRequired(inserted.insertedId), name: doc.name },
      after: { name: doc.name, action: doc.action, expectedResult: doc.expectedResult },
    });

    enqueueEvaluation({
      orgId,
      trigger: 'scenario.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });
    invalidateTimelineCache(orgId);

    sendData(res, toScenarioWithResultDTO({ ...doc, _id: inserted.insertedId }), 201);
  }),
);

scenariosRouter.put(
  '/:id',
  requireRole('member'),
  validateParams(idParamSchema),
  validateBody(updateScenarioSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const scenario = await loadScenario(orgId, req.params.id ?? '');
    const payload = req.body as UpdateScenarioInput;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (payload.name !== undefined) update.name = payload.name;
    if (payload.principalArn !== undefined) update.principalArn = payload.principalArn;
    if (payload.action !== undefined) update.action = payload.action;
    if (payload.resourceArn !== undefined) update.resourceArn = payload.resourceArn;
    if (payload.expectedResult !== undefined) update.expectedResult = payload.expectedResult;
    if (payload.tags !== undefined) update.tags = payload.tags;

    await data.scenarios().updateOne({ _id: scenario._id, orgId }, { $set: update });

    const auditId = await auditMutation(req, {
      action: 'scenario.update',
      target: {
        type: 'scenario',
        id: oidRequired(scenario._id),
        name: (update.name as string | undefined) ?? scenario.name,
      },
      before: {
        name: scenario.name,
        action: scenario.action,
        expectedResult: scenario.expectedResult,
      },
      after: update,
    });

    enqueueEvaluation({
      orgId,
      trigger: 'scenario.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });
    invalidateTimelineCache(orgId);

    sendData(res, toScenarioWithResultDTO(await loadScenario(orgId, req.params.id ?? '')));
  }),
);

scenariosRouter.delete(
  '/:id',
  requireRole('admin'),
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const scenario = await loadScenario(orgId, req.params.id ?? '');
    await data.scenarios().deleteOne({ _id: scenario._id, orgId });

    await auditMutation(req, {
      action: 'scenario.delete',
      target: { type: 'scenario', id: oidRequired(scenario._id), name: scenario.name },
      before: { name: scenario.name, action: scenario.action },
    });
    invalidateTimelineCache(orgId);

    sendData(res, { success: true });
  }),
);
