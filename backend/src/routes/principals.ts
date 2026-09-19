/** Principals (Plan §8.5): CRUD + attach/detach of policies. */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  createPrincipalSchema,
  idParamSchema,
  listQuerySchema,
  principalPolicyParamSchema,
  updatePrincipalSchema,
  type CreatePrincipalInput,
  type UpdatePrincipalInput,
} from '@iamscope/schemas';
import { requireAuth, requireOrg, requireRole } from '../auth/middleware';
import type { EscalationLink, EscalationSeverity, PrincipalDetail } from '@iamscope/types';
import { data } from '../db/data';
import type { PolicyDoc, PrincipalDoc } from '../db/documents';
import { conflict, isDuplicateKeyError, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { buildSearchRegex } from '../lib/mongoQuery';
import { paginated, resolvePagination } from '../lib/pagination';
import { toPrincipalDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import {
  rejectPayloadOrgId,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { enqueueEvaluation } from '../services/evaluationRunner';
import { invalidateForPrincipals } from '../services/escalation';
import { invalidateTimelineCache } from '../services/timeline';

export const principalsRouter = Router();
principalsRouter.use(requireAuth, requireOrg, rejectPayloadOrgId());

async function loadPrincipal(orgId: ObjectId, id: string): Promise<PrincipalDoc> {
  const principal = await data.principals().findOne({ _id: new ObjectId(id), orgId });
  if (principal === null) throw notFound('Principal not found');
  return principal;
}

const SORTABLE = ['name', 'arn', 'type', 'createdAt', 'updatedAt'] as const;

principalsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const query = req.query as unknown as {
      q?: string;
      tag?: string;
      includeDeleted?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
      order?: 'asc' | 'desc';
      type?: string;
    };
    const args = resolvePagination(query);
    const sortField = SORTABLE.find((field) => field === query.sort) ?? 'name';

    const filter: Record<string, unknown> = { orgId };
    if (query.includeDeleted !== true) filter.deleted = { $ne: true };
    if (query.type !== undefined && query.type !== '') filter.type = query.type;
    if (query.q !== undefined && query.q.trim() !== '') {
      const regex = buildSearchRegex(query.q);
      filter.$or = [{ name: regex }, { arn: regex }];
    }
    if (query.tag !== undefined && query.tag.trim() !== '') {
      const [key, value] = query.tag.split(':');
      if (key !== undefined && key !== '') {
        filter[`tags.${key}`] = value === undefined || value === '' ? { $exists: true } : value;
      }
    }

    const [docs, total] = await Promise.all([
      data
        .principals()
        .find(filter)
        .sort({ [sortField]: (query.order ?? 'asc') === 'desc' ? -1 : 1 })
        .skip(args.skip)
        .limit(args.limit)
        .toArray(),
      data.principals().countDocuments(filter),
    ]);

    sendData(res, paginated(docs.map(toPrincipalDTO), total, args));
  }),
);

principalsRouter.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const principal = await loadPrincipal(orgId, req.params.id ?? '');
    const policies: PolicyDoc[] =
      principal.attachedPolicies.length === 0
        ? []
        : await data
            .policies()
            .find({ orgId, _id: { $in: principal.attachedPolicies } })
            .toArray();

    const escalationPaths = await data
      .escalationPaths()
      .find({
        orgId,
        $or: [{ fromPrincipalArn: principal.arn }, { toPrincipalArn: principal.arn }],
      })
      .limit(50)
      .toArray();

    // Resolve display names for every principal on the other end of an edge, in one
    // round trip, so the detail view can link to them.
    const linkedArns = [
      ...new Set(
        escalationPaths.flatMap((path) =>
          path.fromPrincipalArn === principal.arn ? [path.toPrincipalArn] : [path.fromPrincipalArn],
        ),
      ),
    ];
    const linked =
      linkedArns.length === 0
        ? []
        : await data
            .principals()
            .find({ orgId, arn: { $in: linkedArns } })
            .toArray();
    const linkedByArn = new Map(linked.map((doc) => [doc.arn, doc]));

    const linkFor = (arn: string, severity: EscalationSeverity): EscalationLink => {
      const doc = linkedByArn.get(arn);
      return {
        principalId: doc === undefined ? '' : oidRequired(doc._id),
        principalArn: arn,
        principalName: doc?.name ?? arn,
        severity,
      };
    };

    const detail: PrincipalDetail = {
      ...toPrincipalDTO(principal),
      attachedPolicySummaries: policies.map((policy) => ({
        id: oidRequired(policy._id),
        name: policy.name,
        arn: policy.arn,
        currentVersion: policy.currentVersion,
      })),
      // Group memberships are stored as group names on the principal.
      memberNames: [...principal.groupMemberships],
      escalationIn: escalationPaths
        .filter((path) => path.toPrincipalArn === principal.arn)
        .map((path) => linkFor(path.fromPrincipalArn, path.severity)),
      escalationOut: escalationPaths
        .filter((path) => path.fromPrincipalArn === principal.arn)
        .map((path) => linkFor(path.toPrincipalArn, path.severity)),
    };

    sendData(res, detail);
  }),
);

principalsRouter.post(
  '/',
  requireRole('member'),
  validateBody(createPrincipalSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const payload = req.body as CreatePrincipalInput & {
      type: PrincipalDoc['type'];
      name: string;
      arn: string;
      attachedPolicies?: string[];
      groupMemberships?: string[];
      assumeRoleTargets?: string[];
      boundaryPolicyId?: string | null;
      tags?: Record<string, string>;
    };

    const now = new Date();
    const doc: Omit<PrincipalDoc, '_id'> = {
      orgId,
      type: payload.type,
      name: payload.name,
      arn: payload.arn,
      attachedPolicies: (payload.attachedPolicies ?? []).map((id) => new ObjectId(id)),
      groupMemberships: payload.groupMemberships ?? [],
      assumeRoleTargets: payload.assumeRoleTargets ?? [],
      boundaryPolicyId:
        payload.boundaryPolicyId === undefined || payload.boundaryPolicyId === null
          ? null
          : new ObjectId(payload.boundaryPolicyId),
      tags: payload.tags ?? {},
      deleted: false,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    let inserted;
    try {
      inserted = await data.principals().insertOne(doc as PrincipalDoc);
    } catch (error) {
      if (isDuplicateKeyError(error))
        throw conflict('A principal with that name or ARN already exists');
      throw error;
    }

    const auditId = await auditMutation(req, {
      action: 'principal.create',
      target: { type: 'principal', id: oidRequired(inserted.insertedId), name: doc.name },
      after: { name: doc.name, arn: doc.arn, type: doc.type },
    });

    await invalidateForPrincipals(orgId, [doc.arn]);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'principal.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    sendData(res, toPrincipalDTO({ ...doc, _id: inserted.insertedId }), 201);
  }),
);

principalsRouter.put(
  '/:id',
  requireRole('member'),
  validateParams(idParamSchema),
  validateBody(updatePrincipalSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const principal = await loadPrincipal(orgId, req.params.id ?? '');
    const payload = req.body as UpdatePrincipalInput;

    const update: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() };
    if (payload.type !== undefined) update.type = payload.type;
    if (payload.name !== undefined) update.name = payload.name;
    if (payload.arn !== undefined) update.arn = payload.arn;
    if (payload.attachedPolicies !== undefined)
      update.attachedPolicies = payload.attachedPolicies.map((id) => new ObjectId(id));
    if (payload.groupMemberships !== undefined) update.groupMemberships = payload.groupMemberships;
    if (payload.assumeRoleTargets !== undefined)
      update.assumeRoleTargets = payload.assumeRoleTargets;
    if (payload.boundaryPolicyId !== undefined) {
      update.boundaryPolicyId =
        payload.boundaryPolicyId === null ? null : new ObjectId(payload.boundaryPolicyId);
    }
    if (payload.tags !== undefined) update.tags = payload.tags;

    await data.principals().updateOne({ _id: principal._id, orgId }, { $set: update });

    const auditId = await auditMutation(req, {
      action: 'principal.update',
      target: { type: 'principal', id: oidRequired(principal._id), name: principal.name },
      before: toPrincipalDTO(principal) as unknown as Record<string, unknown>,
      after: update,
    });

    await invalidateForPrincipals(orgId, [
      principal.arn,
      (update.arn as string | undefined) ?? principal.arn,
    ]);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'principal.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    const updated = await loadPrincipal(orgId, req.params.id ?? '');
    sendData(res, toPrincipalDTO(updated));
  }),
);

principalsRouter.delete(
  '/:id',
  requireRole('admin'),
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const principal = await loadPrincipal(orgId, req.params.id ?? '');
    const now = new Date();
    await data
      .principals()
      .updateOne(
        { _id: principal._id, orgId },
        { $set: { deleted: true, updatedBy: userId, updatedAt: now } },
      );

    const auditId = await auditMutation(req, {
      action: 'principal.delete',
      target: { type: 'principal', id: oidRequired(principal._id), name: principal.name },
      before: { deleted: false, arn: principal.arn },
      after: { deleted: true },
    });

    await invalidateForPrincipals(orgId, [principal.arn]);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'principal.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    sendData(res, { success: true });
  }),
);

principalsRouter.post(
  '/:id/policies/:policyId',
  requireRole('member'),
  validateParams(principalPolicyParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const principal = await loadPrincipal(orgId, req.params.id ?? '');
    const policyId = new ObjectId(req.params.policyId ?? '');
    const policy = await data.policies().findOne({ _id: policyId, orgId, deleted: { $ne: true } });
    if (policy === null) throw notFound('Policy not found');

    await data.principals().updateOne(
      { _id: principal._id, orgId },
      {
        $addToSet: { attachedPolicies: policyId },
        $set: { updatedBy: userId, updatedAt: new Date() },
      },
    );

    const auditId = await auditMutation(req, {
      action: 'principal.attach',
      target: { type: 'principal', id: oidRequired(principal._id), name: principal.name },
      after: { policyId: oidRequired(policy._id), policyName: policy.name },
    });

    await invalidateForPrincipals(orgId, [principal.arn]);
    enqueueEvaluation({
      orgId,
      trigger: 'principal.attach',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    const updated = await loadPrincipal(orgId, req.params.id ?? '');
    sendData(res, toPrincipalDTO(updated));
  }),
);

principalsRouter.delete(
  '/:id/policies/:policyId',
  requireRole('member'),
  validateParams(principalPolicyParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const principal = await loadPrincipal(orgId, req.params.id ?? '');
    const policyId = new ObjectId(req.params.policyId ?? '');

    await data.principals().updateOne(
      { _id: principal._id, orgId },
      {
        $pull: { attachedPolicies: policyId },
        $set: { updatedBy: userId, updatedAt: new Date() },
      },
    );

    const auditId = await auditMutation(req, {
      action: 'principal.detach',
      target: { type: 'principal', id: oidRequired(principal._id), name: principal.name },
      before: { policyId: oidRequired(policyId) },
    });

    await invalidateForPrincipals(orgId, [principal.arn]);
    enqueueEvaluation({
      orgId,
      trigger: 'principal.detach',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    const updated = await loadPrincipal(orgId, req.params.id ?? '');
    sendData(res, toPrincipalDTO(updated));
  }),
);
