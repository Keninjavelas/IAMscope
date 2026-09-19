/**
 * Policies (Plan §8.4, §10, §25 phase 5/6).
 * Every mutation appends a `policy_versions` row, writes an audit event, invalidates the
 * escalation cache and enqueues a debounced evaluation run.
 */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import type { Policy } from '@iamscope/types';
import {
  createPolicySchema,
  idAndVersionParamSchema,
  idParamSchema,
  listPoliciesQuerySchema,
  restorePolicySchema,
  updatePolicySchema,
  type CreatePolicyOutput,
  type UpdatePolicyOutput,
} from '@iamscope/schemas';
import { requireAuth, requireOrg, requireRole } from '../auth/middleware';
import { data } from '../db/data';
import type { PolicyDoc, PolicyVersionDoc } from '../db/documents';
import { conflict, notFound } from '../lib/errors';
import { isDuplicateKeyError } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { resolvePagination, paginated } from '../lib/pagination';
import { toPolicyDTO, toPolicyVersionDTO } from '../lib/serialize';
import { buildSearchRegex } from '../lib/mongoQuery';
import { buildPolicyArn } from '../lib/arn';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import {
  rejectPayloadOrgId,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { enqueueEvaluation } from '../services/evaluationRunner';
import { invalidateForPolicy } from '../services/escalation';
import { invalidateTimelineCache } from '../services/timeline';
import {
  getPolicyVersion,
  listPolicyVersions,
  nextVersionNumber,
  recordVersion,
} from '../services/versioner';
import { identity } from '../db/identity';

export const policiesRouter = Router();

policiesRouter.use(requireAuth, requireOrg, rejectPayloadOrgId());

const SORTABLE = ['name', 'arn', 'currentVersion', 'createdAt', 'updatedAt'] as const;

/** Stable pseudo account id derived from the org, so policy ARNs are deterministic + unique. */
export function accountIdForOrg(orgId: ObjectId): string {
  const numeric = Number.parseInt(orgId.toHexString().slice(-8), 16) % 1_000_000_000_000;
  return numeric.toString().padStart(12, '0');
}

export function policyArnFor(orgId: ObjectId, name: string): string {
  return buildPolicyArn(accountIdForOrg(orgId), name);
}

async function loadPolicy(orgId: ObjectId, id: string): Promise<PolicyDoc> {
  const policy = await data.policies().findOne({ _id: new ObjectId(id), orgId });
  if (policy === null) throw notFound('Policy not found');
  return policy;
}

async function changedByNames(ids: readonly ObjectId[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(oidRequired))];
  if (unique.length === 0) return new Map();
  const users = await identity
    .users()
    .find({ _id: { $in: unique.map((id) => new ObjectId(id)) } })
    .toArray();
  return new Map(users.map((user) => [oidRequired(user._id), user.name]));
}

/* ------------------------------------------------------------------ */
/* List + detail                                                       */
/* ------------------------------------------------------------------ */

policiesRouter.get(
  '/',
  validateQuery(listPoliciesQuerySchema),
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
    };
    const args = resolvePagination(query);
    // `find` narrows the tuple member, so no cast or non-null assertion is needed to
    // prove the value is a legal sort field before it reaches the query.
    const sortField = SORTABLE.find((field) => field === query.sort) ?? 'updatedAt';
    const direction: 1 | -1 = (query.order ?? 'desc') === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = { orgId };
    if (query.includeDeleted !== true) filter.deleted = { $ne: true };
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
        .policies()
        .find(filter)
        .sort({ [sortField]: direction })
        .skip(args.skip)
        .limit(args.limit)
        .toArray(),
      data.policies().countDocuments(filter),
    ]);

    const page = paginated<Policy>(docs.map(toPolicyDTO), total, args);
    sendData(res, page);
  }),
);

policiesRouter.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');
    const policy = await loadPolicy(orgId, req.params.id ?? '');
    sendData(res, toPolicyDTO(policy));
  }),
);

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

policiesRouter.post(
  '/',
  requireRole('member'),
  validateBody(createPolicySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const payload = req.body as CreatePolicyOutput & { arn?: string };
    const now = new Date();

    const doc: Omit<PolicyDoc, '_id'> = {
      orgId,
      name: payload.name,
      arn: payload.arn ?? policyArnFor(orgId, payload.name),
      currentVersion: 1,
      statements: payload.statements,
      tags: payload.tags ?? {},
      deleted: false,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    let inserted;
    try {
      inserted = await data.policies().insertOne(doc as PolicyDoc);
    } catch (error) {
      if (isDuplicateKeyError(error))
        throw conflict('A policy with that name or ARN already exists');
      throw error;
    }

    await recordVersion({
      orgId,
      policyId: inserted.insertedId,
      version: 1,
      statements: payload.statements,
      changedBy: userId,
      changeReason: payload.changeReason,
      createdAt: now,
    });

    const auditId = await auditMutation(req, {
      action: 'policy.create',
      target: { type: 'policy', id: oidRequired(inserted.insertedId), name: doc.name },
      after: { name: doc.name, arn: doc.arn, statements: doc.statements.length, version: 1 },
    });

    void invalidateForPolicy(orgId);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'policy.create',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    sendData(res, toPolicyDTO({ ...doc, _id: inserted.insertedId }), 201);
  }),
);

/* ------------------------------------------------------------------ */
/* Update + restore + delete                                           */
/* ------------------------------------------------------------------ */

policiesRouter.put(
  '/:id',
  requireRole('member'),
  validateParams(idParamSchema),
  validateBody(updatePolicySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const policy = await loadPolicy(orgId, req.params.id ?? '');
    const payload = req.body as UpdatePolicyOutput;

    const version = await nextVersionNumber(orgId, policy._id, policy.currentVersion);
    const now = new Date();

    await data.policies().updateOne(
      { _id: policy._id, orgId },
      {
        $set: {
          statements: payload.statements,
          tags: payload.tags ?? policy.tags,
          currentVersion: version,
          updatedBy: userId,
          updatedAt: now,
        },
      },
    );

    await recordVersion({
      orgId,
      policyId: policy._id,
      version,
      statements: payload.statements,
      changedBy: userId,
      changeReason: payload.changeReason,
      createdAt: now,
    });

    const auditId = await auditMutation(req, {
      action: 'policy.update',
      target: { type: 'policy', id: oidRequired(policy._id), name: policy.name },
      before: { version: policy.currentVersion, statements: policy.statements },
      after: { version, statements: payload.statements },
      metadata: { changeReason: payload.changeReason },
    });

    void invalidateForPolicy(orgId);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'policy.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    const updated = await loadPolicy(orgId, req.params.id ?? '');
    sendData(res, toPolicyDTO(updated));
  }),
);

policiesRouter.post(
  '/:id/restore',
  requireRole('admin'),
  validateParams(idParamSchema),
  validateBody(restorePolicySchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const policy = await loadPolicy(orgId, req.params.id ?? '');
    const { version: targetVersion, changeReason } = req.body as {
      version: number;
      changeReason?: string;
    };
    const versionDoc: PolicyVersionDoc = await getPolicyVersion(orgId, policy._id, targetVersion);

    const nextVersion = await nextVersionNumber(orgId, policy._id, policy.currentVersion);
    const now = new Date();

    await data.policies().updateOne(
      { _id: policy._id, orgId },
      {
        $set: {
          statements: versionDoc.statements,
          deleted: false,
          currentVersion: nextVersion,
          updatedBy: userId,
          updatedAt: now,
        },
      },
    );

    await recordVersion({
      orgId,
      policyId: policy._id,
      version: nextVersion,
      statements: versionDoc.statements,
      changedBy: userId,
      changeReason: changeReason ?? `Restored from v${targetVersion}`,
      createdAt: now,
    });

    const auditId = await auditMutation(req, {
      action: 'policy.restore',
      target: { type: 'policy', id: oidRequired(policy._id), name: policy.name },
      before: { version: policy.currentVersion, deleted: policy.deleted },
      after: { version: nextVersion, restoredFrom: targetVersion },
    });

    void invalidateForPolicy(orgId);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'policy.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    const restored = await loadPolicy(orgId, req.params.id ?? '');
    sendData(res, { ...toPolicyDTO(restored), restoredFrom: targetVersion });
  }),
);

policiesRouter.delete(
  '/:id',
  requireRole('admin'),
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    const userId = req.auth?.user?._id;
    if (orgId === null || orgId === undefined || userId === undefined)
      throw notFound('No active organization');

    const policy = await loadPolicy(orgId, req.params.id ?? '');
    if (policy.deleted) throw conflict('That policy is already deleted');

    const now = new Date();
    await data
      .policies()
      .updateOne(
        { _id: policy._id, orgId },
        { $set: { deleted: true, updatedBy: userId, updatedAt: now } },
      );

    // Detach from every principal so the evaluator never sees a dangling id.
    await data
      .principals()
      .updateMany(
        { orgId, attachedPolicies: policy._id },
        { $pull: { attachedPolicies: policy._id } },
      );

    const auditId = await auditMutation(req, {
      action: 'policy.delete',
      target: { type: 'policy', id: oidRequired(policy._id), name: policy.name },
      before: { deleted: false, version: policy.currentVersion },
      after: { deleted: true },
    });

    void invalidateForPolicy(orgId);
    invalidateTimelineCache(orgId);
    enqueueEvaluation({
      orgId,
      trigger: 'policy.update',
      triggeredByUserId: userId,
      causedByAuditEventId: auditId,
    });

    sendData(res, {
      success: true,
      policy: toPolicyDTO({ ...policy, deleted: true, updatedAt: now }),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

policiesRouter.get(
  '/:id/versions',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const policy = await loadPolicy(orgId, req.params.id ?? '');
    const all = await data.policyVersions().find({ orgId, policyId: policy._id }).toArray();
    const names = await changedByNames(all.map((version) => version.changedBy));
    // The version history view renders the whole list and sorts client-side, so this
    // endpoint returns a bare array (the envelope's `data` *is* the resource).
    const page = await listPolicyVersions(orgId, policy._id, req.query, names);
    sendData(res, page.items);
  }),
);

policiesRouter.get(
  '/:id/versions/:v',
  validateParams(idAndVersionParamSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.auth?.orgId;
    if (orgId === null || orgId === undefined) throw notFound('No active organization');

    const policy = await loadPolicy(orgId, req.params.id ?? '');
    const version = Number(req.params.v);
    const doc = await getPolicyVersion(orgId, policy._id, version);
    const names = await changedByNames([doc.changedBy]);
    sendData(res, toPolicyVersionDTO(doc, names.get(oidRequired(doc.changedBy))));
  }),
);
