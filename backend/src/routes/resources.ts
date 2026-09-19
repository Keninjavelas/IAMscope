/** Resources (Plan §8.6). */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  createResourceSchema,
  idParamSchema,
  listQuerySchema,
  updateResourceSchema,
  type CreateResourceInput,
  type UpdateResourceInput,
} from '@iamscope/schemas';
import { requireAuth, requireOrg, requireRole } from '../auth/middleware';
import { data } from '../db/data';
import type { ResourceDoc } from '../db/documents';
import { conflict, isDuplicateKeyError, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { buildSearchRegex } from '../lib/mongoQuery';
import { paginated, resolvePagination } from '../lib/pagination';
import { toResourceDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import {
  rejectPayloadOrgId,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { invalidateTimelineCache } from '../services/timeline';

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth, requireOrg, rejectPayloadOrgId());

async function loadResource(orgId: ObjectId, id: string): Promise<ResourceDoc> {
  const resource = await data.resources().findOne({ _id: new ObjectId(id), orgId });
  if (resource === null) throw notFound('Resource not found');
  return resource;
}

resourcesRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as {
      q?: string;
      tag?: string;
      type?: string;
      includeDeleted?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    };
    const args = resolvePagination(query);
    const filter: Record<string, unknown> = { orgId };
    if (query.includeDeleted !== true) filter.deleted = { $ne: true };
    if (query.type !== undefined && query.type !== '') filter.type = query.type;
    if (query.q !== undefined && query.q.trim() !== '') {
      const regex = buildSearchRegex(query.q);
      filter.$or = [{ arn: regex }, { type: regex }];
    }
    if (query.tag !== undefined && query.tag.trim() !== '') {
      const [key, value] = query.tag.split(':');
      if (key !== undefined && key !== '') {
        filter[`tags.${key}`] = value === undefined || value === '' ? { $exists: true } : value;
      }
    }

    const [docs, total] = await Promise.all([
      data
        .resources()
        .find(filter)
        .sort({ arn: (query.order ?? 'asc') === 'desc' ? -1 : 1 })
        .skip(args.skip)
        .limit(args.limit)
        .toArray(),
      data.resources().countDocuments(filter),
    ]);

    sendData(res, paginated(docs.map(toResourceDTO), total, args));
  }),
);

resourcesRouter.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');
    sendData(res, toResourceDTO(await loadResource(orgId, req.params.id ?? '')));
  }),
);

resourcesRouter.post(
  '/',
  requireRole('member'),
  validateBody(createResourceSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const payload = req.body as CreateResourceInput;
    const now = new Date();
    const doc: Omit<ResourceDoc, '_id'> = {
      orgId,
      arn: payload.arn,
      type: payload.type,
      tags: payload.tags ?? {},
      accountId: payload.accountId ?? null,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    let inserted;
    try {
      inserted = await data.resources().insertOne(doc as ResourceDoc);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('A resource with that ARN already exists');
      throw error;
    }

    await auditMutation(req, {
      action: 'resource.create',
      target: { type: 'resource', id: oidRequired(inserted.insertedId), name: doc.arn },
      after: { arn: doc.arn, type: doc.type },
    });
    invalidateTimelineCache(orgId);

    sendData(res, toResourceDTO({ ...doc, _id: inserted.insertedId }), 201);
  }),
);

resourcesRouter.put(
  '/:id',
  requireRole('member'),
  validateParams(idParamSchema),
  validateBody(updateResourceSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const resource = await loadResource(orgId, req.params.id ?? '');
    const payload = req.body as UpdateResourceInput;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (payload.arn !== undefined) update.arn = payload.arn;
    if (payload.type !== undefined) update.type = payload.type;
    if (payload.tags !== undefined) update.tags = payload.tags;
    if (payload.accountId !== undefined) update.accountId = payload.accountId;

    await data.resources().updateOne({ _id: resource._id, orgId }, { $set: update });
    await auditMutation(req, {
      action: 'resource.update',
      target: { type: 'resource', id: oidRequired(resource._id), name: resource.arn },
      before: { arn: resource.arn, type: resource.type, tags: resource.tags },
      after: update,
    });
    invalidateTimelineCache(orgId);

    sendData(res, toResourceDTO(await loadResource(orgId, req.params.id ?? '')));
  }),
);

resourcesRouter.delete(
  '/:id',
  requireRole('admin'),
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const resource = await loadResource(orgId, req.params.id ?? '');
    await data
      .resources()
      .updateOne({ _id: resource._id, orgId }, { $set: { deleted: true, updatedAt: new Date() } });

    await auditMutation(req, {
      action: 'resource.delete',
      target: { type: 'resource', id: oidRequired(resource._id), name: resource.arn },
      before: { deleted: false },
      after: { deleted: true },
    });
    invalidateTimelineCache(orgId);

    sendData(res, { success: true });
  }),
);
