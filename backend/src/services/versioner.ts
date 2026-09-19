/**
 * `policy_versions` writer (Plan §5.1, §7.2, §25 phase 6). Versions are immutable: every policy
 * create/update/restore appends a new row and bumps `policies.currentVersion`.
 */
import type { ObjectId } from 'mongodb';
import type { Paginated, PolicyStatement, PolicyVersion } from '@iamscope/types';
import { data } from '../db/data';
import type { PolicyVersionDoc } from '../db/documents';
import { notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { paginated, resolvePagination } from '../lib/pagination';
import { toPolicyVersionDTO } from '../lib/serialize';

export interface RecordVersionInput {
  orgId: ObjectId;
  policyId: ObjectId;
  version: number;
  statements: PolicyStatement[];
  changedBy: ObjectId;
  changeReason: string;
  createdAt?: Date;
}

export async function recordVersion(input: RecordVersionInput): Promise<PolicyVersionDoc> {
  const doc: Omit<PolicyVersionDoc, '_id'> = {
    orgId: input.orgId,
    policyId: input.policyId,
    version: input.version,
    statements: input.statements,
    changedBy: input.changedBy,
    changeReason: input.changeReason,
    createdAt: input.createdAt ?? new Date(),
  };

  const result = await data.policyVersions().insertOne(doc as PolicyVersionDoc);
  return { ...doc, _id: result.insertedId };
}

/** Next version number for a policy; `1` for a brand-new policy. */
export async function nextVersionNumber(
  orgId: ObjectId,
  policyId: ObjectId,
  currentVersion: number,
): Promise<number> {
  const latest = await data
    .policyVersions()
    .find({ orgId, policyId })
    .sort({ version: -1 })
    .limit(1)
    .toArray();

  const highest = latest[0]?.version ?? 0;
  return Math.max(highest, currentVersion) + 1;
}

export interface ListVersionsArgs {
  page?: number | undefined;
  pageSize?: number | undefined;
}

export async function listPolicyVersions(
  orgId: ObjectId,
  policyId: ObjectId,
  args: ListVersionsArgs,
  names = new Map<string, string>(),
): Promise<Paginated<PolicyVersion>> {
  const pagination = resolvePagination(args);
  const filter = { orgId, policyId };
  const collection = data.policyVersions();

  const [docs, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ version: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return paginated(
    docs.map((doc) => toPolicyVersionDTO(doc, names.get(oidRequired(doc.changedBy)) ?? undefined)),
    total,
    pagination,
  );
}

export async function getPolicyVersion(
  orgId: ObjectId,
  policyId: ObjectId,
  version: number,
): Promise<PolicyVersionDoc> {
  const doc = await data.policyVersions().findOne({ orgId, policyId, version });
  if (doc === null) throw notFound(`Version ${version} not found for this policy`);
  return doc;
}

/** Latest version at or before `at` - the backbone of timeline reconstruction (Plan §12.1). */
export async function latestVersionAt(
  orgId: ObjectId,
  policyId: ObjectId,
  at: Date,
): Promise<PolicyVersionDoc | null> {
  const docs = await data
    .policyVersions()
    .find({ orgId, policyId, createdAt: { $lte: at } })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  return docs[0] ?? null;
}
